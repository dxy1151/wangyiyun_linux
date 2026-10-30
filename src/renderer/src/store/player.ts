/**
 * 播放引擎（zustand store + HTMLAudioElement 单实例）
 *
 * UI 用法：
 *   const { current, isPlaying, progress, lyrics, lyricIndex, networkBanner } = usePlayer()
 *   usePlayerStore.getState().playQueue(songs, 0)
 *
 * 设计要点：
 *  - audio 元素懒创建（`ensureAudio()`），在浏览器 / SSR / 测试环境下 import 本文件不会崩溃。
 *  - 所有 window.nt / navigator / IndexedDB 访问都做存在性判断，与 Electron 解耦。
 *  - 无可用音源时进入「演示模式」：不抛错、不弹窗，`networkBanner` 给出提示，UI 照常显示。
 *  - 队列/收藏/最近播放/音量/模式持久化在 localStorage；音频 blob 缓存在 IndexedDB。
 */

import { create } from 'zustand'
import { findLyricIndex, num, parseLrc } from '../api/netease'
import { getAudioUrl, hasWorkingSource, probeProviders } from '../api/mirror'
import { getLyrics } from '../api'
import type { LyricLine, Lyrics, PlayMode, Song } from '../api/types'

/* ------------------------------ 类型 ------------------------------ */

export type { PlayMode }

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  order: '顺序播放',
  'repeat-one': '单曲循环',
  shuffle: '随机播放',
  loop: '列表循环'
}

export type BannerLevel = 'info' | 'warn' | 'error'

export interface PlayerState {
  /* —— 当前播放 —— */
  current: Song | null
  currentIndex: number
  queue: Song[]
  /** 原始队列顺序（队列会被 shuffle 打乱） */
  order: number[]
  isPlaying: boolean
  /** 已缓冲/可播（用于 UI 显示 loading） */
  isBuffering: boolean
  /** 进度（毫秒） */
  progress: number
  /** 时长（毫秒），优先用 audio.duration，其次 Song.duration */
  duration: number
  /** 0 ~ 1 */
  volume: number
  muted: boolean
  mode: PlayMode

  /* —— 歌词 —— */
  /** 逐行歌词（含译文），无歌词为 [] */
  lyrics: LyricLine[]
  /** 原始 LRC 文本（UI 若想自己解析可用） */
  lyricsRaw: string
  lyricIndex: number

  /* —— 个人库 —— */
  favorites: Song[]
  recent: Song[]

  /* —— 网络/降级 —— */
  /** UI 顶部横幅文案；null 表示正常。string，不是对象。 */
  networkBanner: string | null
  bannerLevel: BannerLevel
  /** 是否处于演示模式（取不到音频直链） */
  demoMode: boolean
  /** 当前播放直链来源，如 'gdstudio' */
  audioSource: string
}

export interface PlayerActions {
  /* 播放控制 */
  playQueue: (list: Song[], index?: number) => void
  playTrack: (song: Song, queue?: Song[]) => void
  toggle: () => void
  play: () => void
  pause: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (ms: number) => void
  seekBy: (deltaMs: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setMode: (m: PlayMode) => void
  cycleMode: () => void

  /* 队列管理 */
  addNext: (song: Song) => void
  addToQueue: (song: Song) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  setQueue: (list: Song[]) => void

  /* 个人库 */
  toggleFavorite: (song: Song) => void
  isFavorite: (id: number) => boolean
  addRecent: (song: Song) => void

  /* 内部/杂项 */
  dismissBanner: () => void
  setNetworkBanner: (msg: string | null, level?: BannerLevel) => void
  setQuality: (br: 128 | 192 | 320) => void
  quality: () => number
  /** 重新探测音源并重试当前曲目 */
  retryCurrent: () => Promise<void>
  /** 订阅进度（用于主进程托盘进度），返回取消函数 */
  /** 销毁引擎（测试/热重载用） */
  dispose: () => void
}

export type PlayerStore = PlayerState & PlayerActions

/* ------------------------------ 常量 ------------------------------ */

const LS_KEY = 'nt.player'
const LS_FAV = 'nt.favorites'
const LS_RECENT = 'nt.recent'
const RECENT_MAX = 100
const FAV_MAX = 2000
const PROGRESS_HZ = 4
/** 播放失败自动跳过次数上限（避免整队列空转） */
const AUTO_SKIP_LIMIT = 8
/** 随机模式下回退历史长度 */
const SHUFFLE_HISTORY_MAX = 200

const DEFAULT_VOLUME = 0.8

/* ------------------------------ 工具 ------------------------------ */

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* 配额/隐私模式忽略 */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = safeGet(key)
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw) as T
    return v ?? fallback
  } catch {
    return fallback
  }
}

/** 歌曲去重/持久化用的精简副本（避免 localStorage 体积膨胀） */
function slimSong(s: Song): Song {
  return {
    id: s.id,
    name: s.name,
    artists: (s.artists ?? []).map(a => ({ id: a.id, name: a.name })),
    album: { id: s.album?.id ?? 0, name: s.album?.name ?? '', picUrl: s.album?.picUrl ?? '' },
    duration: s.duration ?? 0,
    fee: s.fee ?? 0,
    picUrl: s.picUrl ?? s.album?.picUrl ?? '',
    artistText: s.artistText,
    albumName: s.albumName ?? s.album?.name
  }
}

function songKey(s: Song | null | undefined): string {
  return s ? String(s.id) : ''
}

/* ------------------------------ IndexedDB 音频缓存 ------------------------------ */

const IDB_NAME = 'nt-audio-cache'
const IDB_STORE = 'audio'
const IDB_META = 'meta'

interface CacheMeta {
  id: number
  size: number
  at: number
  duration: number
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
        if (!db.objectStoreNames.contains(IDB_META)) db.createObjectStore(IDB_META)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function idbTx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise<T | null>(resolve => {
    try {
      const tx = db.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function cacheGet(id: number): Promise<Blob | null> {
  const blob = await idbTx<Blob>(IDB_STORE, 'readonly', s => s.get(String(id)) as IDBRequest<Blob>)
  return blob instanceof Blob ? blob : null
}

async function cachePut(id: number, blob: Blob, duration: number, limitMB: number): Promise<void> {
  try {
    await idbTx<IDBValidKey>(IDB_STORE, 'readwrite', s => s.put(blob, String(id)))
    const meta: CacheMeta = { id, size: blob.size, at: Date.now(), duration }
    await idbTx<IDBValidKey>(IDB_META, 'readwrite', s => s.put(meta, String(id)))
    await enforceCacheLimit(limitMB)
  } catch {
    /* 缓存失败不影响播放 */
  }
}

let cacheLimitMB = 512

/** 设置音频缓存上限（MB），超出后按最久未访问淘汰 */
export function setCacheLimitMB(mb: number): void {
  cacheLimitMB = Math.max(64, Math.min(8192, num(mb, 512)))
}

async function enforceCacheLimit(limitMBValue = cacheLimitMB): Promise<void> {
  const metas = (await idbTx<CacheMeta[]>(IDB_META, 'readonly', s => s.getAll() as IDBRequest<CacheMeta[]>)) ?? []
  if (!metas.length) return
  const limitBytes = limitMBValue * 1024 * 1024
  let total = metas.reduce((sum, m) => sum + (m.size || 0), 0)
  if (total <= limitBytes) return
  metas.sort((a, b) => a.at - b.at)
  for (const m of metas) {
    if (total <= limitBytes) break
    await idbTx(IDB_STORE, 'readwrite', s => s.delete(String(m.id)))
    await idbTx(IDB_META, 'readwrite', s => s.delete(String(m.id)))
    total -= m.size || 0
  }
}

/** 查询已缓存曲目数 / 总大小（设置页展示） */
export async function audioCacheStats(): Promise<{ count: number; bytes: number }> {
  const metas = (await idbTx<CacheMeta[]>(IDB_META, 'readonly', s => s.getAll() as IDBRequest<CacheMeta[]>)) ?? []
  return { count: metas.length, bytes: metas.reduce((n, m) => n + (m.size || 0), 0) }
}

/** 清空音频缓存 */
export async function clearAudioCache(): Promise<void> {
  await idbTx(IDB_STORE, 'readwrite', s => s.clear())
  await idbTx(IDB_META, 'readwrite', s => s.clear())
}

/* ------------------------------ 音频元素 ------------------------------ */

let audio: HTMLAudioElement | null = null
let progressTimer: number | null = null
let currentObjectUrl: string | null = null
/** 每次切歌递增，用于丢弃过期的异步结果 */
let loadToken = 0
let autoSkipCount = 0
/** 随机播放回退历史（队列下标） */
const shuffleHistory: number[] = []
let mediaKeyBound = false
let started = false

function ensureAudio(): HTMLAudioElement | null {
  if (audio) return audio
  if (typeof Audio === 'undefined') return null
  try {
    const el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.volume = clampVolume(usePlayerStore.getState().volume)
    el.muted = usePlayerStore.getState().muted

    el.addEventListener('timeupdate', () => {
      // timeupdate 频率不稳定，进度主要由定时器驱动，这里做兜底
      syncProgress()
    })
    el.addEventListener('durationchange', () => {
      const d = Number.isFinite(el.duration) ? el.duration * 1000 : 0
      if (d > 0) usePlayerStore.setState({ duration: Math.round(d) })
    })
    el.addEventListener('loadedmetadata', () => {
      const d = Number.isFinite(el.duration) ? el.duration * 1000 : 0
      usePlayerStore.setState({ duration: Math.round(d) || usePlayerStore.getState().duration, isBuffering: false })
    })
    el.addEventListener('waiting', () => usePlayerStore.setState({ isBuffering: true }))
    el.addEventListener('playing', () => {
      usePlayerStore.setState({ isBuffering: false, isPlaying: true })
      pushMpris()
    })
    el.addEventListener('pause', () => {
      usePlayerStore.setState({ isPlaying: false })
      pushMpris()
    })
    el.addEventListener('ended', () => {
      // 单曲循环由 mode 控制；其他模式统一走 next(auto=true)
      usePlayerStore.getState().next(true)
    })
    el.addEventListener('error', () => {
      // 直链失效/解码失败：重新取直链重试一次，仍失败则跳下一首
      handleAudioError()
    })
    el.addEventListener('volumechange', () => {
      usePlayerStore.setState({ volume: el.volume, muted: el.muted })
      pushMpris()
    })

    audio = el
    bindMediaSession()
    bindMediaKeys()
    startProgressTimer()
    return el
  } catch {
    return null
  }
}

function clampVolume(v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_VOLUME
  return Math.max(0, Math.min(1, n))
}

function startProgressTimer(): void {
  if (progressTimer !== null || typeof window === 'undefined') return
  progressTimer = window.setInterval(syncProgress, 1000 / PROGRESS_HZ)
}

function stopProgressTimer(): void {
  if (progressTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(progressTimer)
    progressTimer = null
  }
}

/** 4Hz 同步进度 → store（同时计算当前歌词行） */
function syncProgress(): void {
  if (!audio) return
  const st = usePlayerStore.getState()
  const rawMs = Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0
  const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : st.duration
  const idx = st.lyrics.length ? findLyricIndex(st.lyrics, rawMs) : -1
  if (rawMs !== st.progress || dur !== st.duration || idx !== st.lyricIndex) {
    usePlayerStore.setState({ progress: rawMs, duration: dur, lyricIndex: idx })
  }
  pushTrayProgress()
}

let lastTrayPush = 0
function pushTrayProgress(): void {
  const now = Date.now()
  if (now - lastTrayPush < 1000) return // 托盘不需要 4Hz
  lastTrayPush = now
  const st = usePlayerStore.getState()
  pushBridge('trayProgress', st.duration > 0 ? st.progress / st.duration : null)
}

let lastMprisPush = 0
/** 向主进程推送 MPRIS 状态（window.nt 不存在时静默跳过） */
function pushMpris(force = false): void {
  const now = Date.now()
  if (!force && now - lastMprisPush < 900) return
  lastMprisPush = now
  const st = usePlayerStore.getState()
  const cur = st.current
  pushBridge('mprisUpdate', {
    playbackStatus: st.isPlaying ? 'Playing' : cur ? 'Paused' : 'Stopped',
    title: cur?.name ?? '',
    artist: cur?.artistText ?? (cur?.artists ?? []).map(a => a.name).join(' / '),
    album: cur?.album?.name ?? '',
    artUrl: cur?.picUrl ?? '',
    position: Math.round(st.progress / 1000),
    duration: Math.round(st.duration / 1000),
    volume: st.muted ? 0 : st.volume,
    canGoNext: st.queue.length > 1,
    canGoPrevious: st.queue.length > 1,
    canPlay: !!cur,
    canPause: st.isPlaying
  })
}

/** 安全调用 window.nt 上的方法（兼容多种命名，preload 未暴露则跳过） */
function pushBridge(method: string, payload: unknown): void {
  try {
    if (typeof window === 'undefined') return
    const nt = (window as unknown as { nt?: Record<string, unknown> }).nt
    if (!nt) return
    const fn = nt[method]
    if (typeof fn === 'function') {
      ;(fn as (p: unknown) => unknown).call(nt, payload)
    }
  } catch {
    /* 桥接失败不影响播放 */
  }
}

/* ------------------------------ 媒体键 / mediaSession ------------------------------ */

function bindMediaSession(): void {
  try {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const st = () => usePlayerStore.getState()
    ms.setActionHandler('play', () => st().play())
    ms.setActionHandler('pause', () => st().pause())
    ms.setActionHandler('previoustrack', () => st().prev())
    ms.setActionHandler('nexttrack', () => st().next())
    try {
      ms.setActionHandler('seekto', d => {
        if (typeof d.seekTime === 'number') st().seek(d.seekTime * 1000)
      })
      ms.setActionHandler('seekbackward', d => st().seekBy(-(d.seekOffset ?? 10) * 1000))
      ms.setActionHandler('seekforward', d => st().seekBy((d.seekOffset ?? 10) * 1000))
    } catch {
      /* 部分环境不支持 seekto */
    }
  } catch {
    /* ignore */
  }
}

function updateMediaSessionMetadata(song: Song | null): void {
  try {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    if (!song) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artistText ?? (song.artists ?? []).map(a => a.name).join(' / '),
      album: song.album?.name ?? '',
      artwork: song.picUrl
        ? [
            { src: song.picUrl, sizes: '96x96', type: 'image/jpeg' },
            { src: song.picUrl, sizes: '512x512', type: 'image/jpeg' }
          ]
        : []
    })
  } catch {
    /* ignore */
  }
}

/** 监听主进程推送的媒体键（window.nt.onMediaKey），只绑定一次 */
function bindMediaKeys(): void {
  if (mediaKeyBound || typeof window === 'undefined') return
  mediaKeyBound = true
  try {
    const nt = (window as unknown as { nt?: { onMediaKey?: (cb: (a: string) => void) => unknown } }).nt
    if (nt && typeof nt.onMediaKey === 'function') {
      nt.onMediaKey(action => handleMediaKey(action))
    }
    window.addEventListener('nt:mediakey', (e: Event) => {
      const detail = (e as CustomEvent<{ action?: string }>).detail
      if (detail?.action) handleMediaKey(detail.action)
    })
  } catch {
    /* ignore */
  }
}

function handleMediaKey(action: string): void {
  const st = usePlayerStore.getState()
  switch (action) {
    case 'play-pause':
      st.toggle()
      break
    case 'next':
      st.next()
      break
    case 'prev':
      st.prev()
      break
    case 'stop':
      st.pause()
      st.seek(0)
      break
    default:
      break
  }
}

/* ------------------------------ 音源解析与播放 ------------------------------ */

let qualityBr: 128 | 192 | 320 = 320

interface LoadOptions {
  /** 自动播放（切歌=true、恢复=false） */
  autoplay?: boolean
  /** 指定播放位置（毫秒） */
  startAt?: number
  /** 是否跳过 IndexedDB 缓存读取 */
  skipCache?: boolean
}

/**
 * 加载并播放队列下标 index 的曲目。
 * 失败（无直链 / 网络错误）时：进入演示模式 + 自动跳下一首，**绝不抛异常**。
 */
async function loadIndex(index: number, opts: LoadOptions = {}): Promise<void> {
  const st = usePlayerStore.getState()
  const list = st.queue
  if (!list.length || index < 0 || index >= list.length) return
  const song = list[index]
  const token = ++loadToken
  const el = ensureAudio()
  // 连续快速点歌：立刻停掉正在播放的旧音轨，并清掉尚未 resolve 的旧直链请求
  abortPendingResolve()
  if (el) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
    stopProgressTimer()
    startProgressTimer()
  }

  usePlayerStore.setState({
    current: song,
    currentIndex: index,
    progress: 0,
    duration: song.duration || 0,
    lyrics: [],
    lyricsRaw: '',
    lyricIndex: -1,
    isBuffering: true
  })
  updateMediaSessionMetadata(song)
  addRecentInternal(song)
  pushMpris(true)
  void loadLyricsFor(song, token)

  if (!el) {
    // 没有 Audio（测试/SSR）：仅更新状态
    usePlayerStore.setState({ isPlaying: false, isBuffering: false })
    return
  }

  // 1) 先查 IndexedDB 缓存（二次播放走本地 blob）
  if (!opts.skipCache) {
    try {
      const blob = await cacheGet(song.id)
      if (token !== loadToken) return
      if (blob) {
        attachBlob(el, blob)
        await tryPlay(el, opts)
        markCached(song.id, true)
        return
      }
    } catch {
      /* 缓存读失败 → 走网络 */
    }
  }

  // 2) 解析直链（gdstudio / meting 多源故障转移）；可被下一次切歌取消
  const ctrl = new AbortController()
  pendingResolve = ctrl
  const info = await getAudioUrl(song.id, { br: qualityBr, signal: ctrl.signal })
  pendingResolve = null
  if (token !== loadToken) return

  if (!info.url) {
    // 无直链 → 演示模式 + 自动跳下一首。
    // 注意：这里必须"稍后"再跳，否则会与调用方（playQueue/removeFromQueue 之后）的状态更新交错，
    // 出现 current 与 currentIndex 不一致的中间态。
    enterDemoMode()
    scheduleAutoSkip()
    return
  }

  usePlayerStore.setState({ audioSource: info.source, demoMode: false })
  el.src = info.url
  el.load()
  await tryPlay(el, opts)

  // 3) 后台把音频缓存到 IndexedDB（仅 mp3、且体积合理时，避免 flac 撑爆配额）
  if (info.format === 'mp3' && info.size > 0 && info.size < 40 * 1024 * 1024) {
    void cacheFromUrl(song, info.url, song.duration)
  }
}

function markCached(id: number, cached: boolean): void {
  const st = usePlayerStore.getState()
  if (st.current && st.current.id === id) {
    usePlayerStore.setState({ current: { ...st.current, cached } })
  }
}

function attachBlob(el: HTMLAudioElement, blob: Blob): void {
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl)
    } catch {
      /* ignore */
    }
  }
  currentObjectUrl = URL.createObjectURL(blob)
  el.src = currentObjectUrl
  el.load()
}

async function tryPlay(el: HTMLAudioElement, opts: LoadOptions): Promise<void> {
  if (opts.startAt && opts.startAt > 0) {
    try {
      el.currentTime = opts.startAt / 1000
    } catch {
      /* ignore */
    }
  }
  if (opts.autoplay === false) {
    usePlayerStore.setState({ isPlaying: false, isBuffering: false })
    return
  }
  try {
    await el.play()
    usePlayerStore.setState({ isPlaying: true, isBuffering: false })
    autoSkipCount = 0
    pushMpris(true)
  } catch {
    // 自动播放被浏览器策略拦截 / 网络中断：保持暂停态，UI 不会崩
    usePlayerStore.setState({ isPlaying: false, isBuffering: false })
  }
}

/** 当前正在进行的直链解析请求（切歌时取消，避免串音） */
let pendingResolve: AbortController | null = null

function abortPendingResolve(): void {
  if (!pendingResolve) return
  try {
    pendingResolve.abort()
  } catch {
    /* ignore */
  }
  pendingResolve = null
}

let errorRetried = new Map<number, number>()
let handlingError = false

/** audio 元素 error 事件：清直链缓存重试一次，再失败跳下一首 */
function handleAudioError(): void {
  if (handlingError) return
  handlingError = true
  try {
    const st = usePlayerStore.getState()
    const song = st.current
    if (!song) return
    const tries = errorRetried.get(song.id) ?? 0
    if (tries >= 1) {
      errorRetried.delete(song.id)
      setBanner('当前歌曲无法播放，已自动切换下一首', 'warn')
      autoSkip()
      return
    }
    errorRetried.set(song.id, tries + 1)
    usePlayerStore.setState({ isBuffering: true })
    void (async () => {
      const el = ensureAudio()
      if (!el) return
      const info = await getAudioUrl(song.id, { br: qualityBr, force: true })
      if (!info.url) {
        enterDemoMode()
        autoSkip()
        return
      }
      el.src = info.url
      el.load()
      await tryPlay(el, { autoplay: st.isPlaying })
    })()
  } finally {
    handlingError = false
  }
}

let skipTimer: number | null = null

/** 延迟到当前同步栈结束后再自动跳过（避免与调用方的 setState 交错） */
function scheduleAutoSkip(): void {
  if (typeof window === 'undefined') return
  if (skipTimer !== null) return
  skipTimer = window.setTimeout(() => {
    skipTimer = null
    autoSkip()
  }, 0)
}

/** 自动跳过下一首（最多连续 AUTO_SKIP_LIMIT 次，防止全队列失败死循环） */
function autoSkip(): void {
  autoSkipCount++
  if (autoSkipCount > AUTO_SKIP_LIMIT) {
    setBanner('当前网络无法获取音频流，已进入演示模式', 'warn')
    usePlayerStore.setState({ isPlaying: false, isBuffering: false })
    autoSkipCount = 0
    return
  }
  usePlayerStore.getState().next(true)
}

function enterDemoMode(): void {
  if (!hasWorkingSource()) {
    setBanner('当前网络无法获取音频流，已进入演示模式', 'warn')
  } else {
    setBanner('该曲目暂无可用音源，已跳过', 'info')
  }
  usePlayerStore.setState({ demoMode: true, isBuffering: false })
}

function setBanner(msg: string | null, level: BannerLevel = 'info'): void {
  usePlayerStore.setState({ networkBanner: msg, bannerLevel: level })
}

/** 拉取歌词（官方 → 镜像兜底），带 token 防止串歌 */
async function loadLyricsFor(song: Song, token: number): Promise<void> {
  try {
    const lyrics: Lyrics | null = await getLyrics(song.id)
    if (token !== loadToken) return
    const lines = lyrics?.lines?.length ? lyrics.lines : lyrics?.lrc ? parseLrc(lyrics.lrc, lyrics.tlyric) : []
    usePlayerStore.setState({ lyrics: lines, lyricsRaw: lyrics?.lrc ?? '', lyricIndex: -1 })
  } catch {
    if (token !== loadToken) return
    usePlayerStore.setState({ lyrics: [], lyricsRaw: '', lyricIndex: -1 })
  }
}

/** 下载并缓存音频（IndexedDB），失败静默 */
async function cacheFromUrl(song: Song, url: string, duration: number): Promise<void> {
  try {
    const existing = await cacheGet(song.id)
    if (existing) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 60_000)
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' })
    clearTimeout(timer)
    if (!res.ok) return
    const blob = await res.blob()
    if (!blob.size) return
    await cachePut(song.id, blob, duration, cacheLimitMB)
    markCached(song.id, true)
  } catch {
    /* 缓存失败无所谓 */
  }
}

/* ------------------------------ 最近播放 ------------------------------ */

function addRecentInternal(song: Song): void {
  const st = usePlayerStore.getState()
  const next = [slimSong(song), ...st.recent.filter(s => s.id !== song.id)].slice(0, RECENT_MAX)
  usePlayerStore.setState({ recent: next })
  safeSet(LS_RECENT, JSON.stringify(next))
}

/* ------------------------------ 持久化 ------------------------------ */

interface PersistedPlayer {
  volume: number
  muted: boolean
  mode: PlayMode
  queue: Song[]
  currentIndex: number
}

function loadPersisted(): PersistedPlayer {
  const p = readJson<Partial<PersistedPlayer>>(LS_KEY, {})
  const modes: PlayMode[] = ['order', 'repeat-one', 'shuffle', 'loop']
  return {
    volume: typeof p.volume === 'number' ? clampVolume(p.volume) : DEFAULT_VOLUME,
    muted: !!p.muted,
    mode: modes.includes(p.mode as PlayMode) ? (p.mode as PlayMode) : 'loop',
    queue: Array.isArray(p.queue) ? p.queue.filter(s => s && typeof s.id === 'number') : [],
    currentIndex: typeof p.currentIndex === 'number' ? p.currentIndex : 0
  }
}

function persistPlayer(): void {
  const st = usePlayerStore.getState()
  safeSet(
    LS_KEY,
    JSON.stringify({
      volume: st.volume,
      muted: st.muted,
      mode: st.mode,
      queue: st.queue.slice(0, 200),
      currentIndex: st.currentIndex
    })
  )
}

/* ------------------------------ Store ------------------------------ */

const persisted = loadPersisted()
const persistedFav = readJson<Song[]>(LS_FAV, []).filter(s => s && typeof s.id === 'number')
const persistedRecent = readJson<Song[]>(LS_RECENT, []).filter(s => s && typeof s.id === 'number')

export const usePlayerStore = create<PlayerStore>()((set, get) => ({
  /* —— 初始状态 —— */
  current: null,
  currentIndex: -1,
  queue: [],
  order: [],
  isPlaying: false,
  isBuffering: false,
  progress: 0,
  duration: 0,
  volume: persisted.volume,
  muted: persisted.muted,
  mode: persisted.mode,
  lyrics: [],
  lyricsRaw: '',
  lyricIndex: -1,
  favorites: persistedFav,
  recent: persistedRecent,
  networkBanner: null,
  bannerLevel: 'info',
  demoMode: false,
  audioSource: '',

  /* —— 播放控制 —— */

  playQueue: (list, index = 0) => {
    const clean = (Array.isArray(list) ? list : []).filter((s): s is Song => !!s && typeof s.id === 'number')
    if (!clean.length) {
      get().clearQueue()
      return
    }
    const start = Math.max(0, Math.min(clean.length - 1, Math.floor(index) || 0))
    autoSkipCount = 0
    shuffleHistory.length = 0
    set({
      queue: clean,
      order: get().mode === 'shuffle' ? buildShuffleOrder(clean.length, start) : clean.map((_, i) => i),
      currentIndex: start,
      current: clean[start],
      progress: 0,
      duration: clean[start]?.duration ?? 0,
      lyrics: [],
      lyricsRaw: '',
      lyricIndex: -1
    })
    persistPlayer()
    pushMpris(true)
    ensureAudio()
    void loadIndex(start, { autoplay: true })
  },

  playTrack: (song, queue) => {
    if (!song) return
    if (Array.isArray(queue) && queue.length) {
      const idx = queue.findIndex(s => s && s.id === song.id)
      get().playQueue(queue, idx >= 0 ? idx : 0)
      return
    }
    const st = get()
    const existIdx = st.queue.findIndex(s => s.id === song.id)
    if (existIdx >= 0) {
      set({ currentIndex: existIdx, current: st.queue[existIdx] })
      persistPlayer()
      void loadIndex(existIdx, { autoplay: true })
      return
    }
    // 单曲播放：替换整个队列
    get().playQueue([song], 0)
  },

  toggle: () => {
    const st = get()
    if (st.isPlaying) st.pause()
    else st.play()
  },

  play: () => {
    const st = get()
    const el = ensureAudio()
    if (!st.current && st.queue.length) {
      void loadIndex(Math.max(0, st.currentIndex), { autoplay: true })
      return
    }
    if (!el || !st.current) return
    if (!el.src) {
      void loadIndex(Math.max(0, st.currentIndex), { autoplay: true, startAt: st.progress })
      return
    }
    el.play()
      .then(() => set({ isPlaying: true }))
      .catch(() => set({ isPlaying: false }))
    pushMpris(true)
  },

  pause: () => {
    const el = ensureAudio()
    try {
      el?.pause()
    } catch {
      /* ignore */
    }
    set({ isPlaying: false })
    pushMpris(true)
  },

  next: auto => {
    const st = get()
    const { queue, currentIndex, mode } = st
    if (!queue.length) return

    // 单曲循环：自动播放时重播当前曲；手动点"下一首"仍切换
    if (auto && mode === 'repeat-one') {
      const el = ensureAudio()
      if (el) {
        try {
          el.currentTime = 0
        } catch {
          /* ignore */
        }
        void el.play().catch(() => set({ isPlaying: false }))
        set({ progress: 0, lyricIndex: -1 })
        return
      }
      void loadIndex(currentIndex, { autoplay: true })
      return
    }

    let nextIdx: number
    if (mode === 'shuffle') {
      if (shuffleHistory[shuffleHistory.length - 1] !== currentIndex) shuffleHistory.push(currentIndex)
      if (shuffleHistory.length > SHUFFLE_HISTORY_MAX) shuffleHistory.shift()
      nextIdx = randomOtherIndex(queue.length, currentIndex)
      if (nextIdx === currentIndex && queue.length > 1) nextIdx = (currentIndex + 1) % queue.length
      void loadIndex(nextIdx, { autoplay: true })
      return
    }

    nextIdx = currentIndex + 1
    if (nextIdx >= queue.length) {
      if (auto && mode === 'order') {
        // 顺序播放：播到最后一首停止
        set({ isPlaying: false, progress: st.duration })
        pushMpris(true)
        return
      }
      nextIdx = 0
    }
    void loadIndex(nextIdx, { autoplay: true })
  },

  prev: () => {
    const st = get()
    const { queue, currentIndex, mode } = st
    if (!queue.length) return

    // 播放超过 3 秒：回到本曲开头（常见播放器行为）
    if (st.progress > 3000) {
      get().seek(0)
      return
    }

    let prevIdx: number
    if (mode === 'shuffle') {
      const back = shuffleHistory.pop()
      prevIdx = back !== undefined && back >= 0 && back < queue.length ? back : randomOtherIndex(queue.length, currentIndex)
    } else {
      prevIdx = currentIndex - 1
      if (prevIdx < 0) prevIdx = queue.length - 1
    }
    void loadIndex(prevIdx, { autoplay: true })
  },

  seek: ms => {
    const el = ensureAudio()
    const st = get()
    const target = Math.max(0, Math.min(ms, st.duration || ms))
    if (el && Number.isFinite(el.duration)) {
      try {
        el.currentTime = Math.min(target, el.duration * 1000) / 1000
      } catch {
        /* ignore */
      }
    }
    const idx = st.lyrics.length ? findLyricIndex(st.lyrics, target) : -1
    set({ progress: Math.round(target), lyricIndex: idx })
    pushMpris(true)
  },

  seekBy: delta => {
    const st = get()
    st.seek(st.progress + delta)
  },

  setVolume: v => {
    const vol = clampVolume(v)
    const el = ensureAudio()
    if (el) {
      el.volume = vol
      if (vol > 0) el.muted = false
    }
    set({ volume: vol, muted: vol > 0 ? false : get().muted })
    persistPlayer()
    pushMpris(true)
  },

  toggleMute: () => {
    const el = ensureAudio()
    const muted = !get().muted
    if (el) el.muted = muted
    set({ muted })
    persistPlayer()
    pushMpris(true)
  },

  setMode: m => {
    const modes: PlayMode[] = ['order', 'repeat-one', 'shuffle', 'loop']
    if (!modes.includes(m)) return
    const st = get()
    set({ mode: m })
    if (m !== 'shuffle') {
      shuffleHistory.length = 0
    } else if (st.current) {
      void loadIndex(st.currentIndex, { autoplay: false })
    }
    persistPlayer()
  },

  cycleMode: () => {
    const modes: PlayMode[] = ['loop', 'repeat-one', 'shuffle', 'order']
    const cur = get().mode
    get().setMode(modes[(modes.indexOf(cur) + 1) % modes.length])
  },

  /* —— 队列管理 —— */

  addNext: song => {
    if (!song) return
    const st = get()
    if (!st.queue.length) {
      get().playQueue([song], 0)
      return
    }
    const queue = st.queue.slice()
    queue.splice(st.currentIndex + 1, 0, song)
    set({ queue })
    persistPlayer()
    setBanner(`已将《${song.name}》加入下一首播放`, 'info')
  },

  addToQueue: song => {
    if (!song) return
    const st = get()
    if (!st.queue.length) {
      get().playQueue([song], 0)
      return
    }
    set({ queue: [...st.queue, song] })
    persistPlayer()
  },

  removeFromQueue: index => {
    const st = get()
    if (index < 0 || index >= st.queue.length) return
    const queue = st.queue.slice()
    queue.splice(index, 1)
    if (!queue.length) {
      get().clearQueue()
      return
    }
    if (index < st.currentIndex) {
      set({ queue, currentIndex: st.currentIndex - 1 })
      persistPlayer()
      return
    }
    if (index === st.currentIndex) {
      // 移除的是当前曲：播放同位置的下一个
      const nextIdx = Math.min(index, queue.length - 1)
      set({ queue })
      persistPlayer()
      void loadIndex(nextIdx, { autoplay: st.isPlaying })
      return
    }
    set({ queue })
    persistPlayer()
  },

  clearQueue: () => {
    const el = ensureAudio()
    loadToken++
    abortPendingResolve()
    try {
      el?.pause()
      if (el) el.removeAttribute('src')
      el?.load()
    } catch {
      /* ignore */
    }
    if (currentObjectUrl) {
      try {
        URL.revokeObjectURL(currentObjectUrl)
      } catch {
        /* ignore */
      }
      currentObjectUrl = null
    }
    shuffleHistory.length = 0
    set({
      queue: [],
      order: [],
      current: null,
      currentIndex: -1,
      isPlaying: false,
      isBuffering: false,
      progress: 0,
      duration: 0,
      lyrics: [],
      lyricsRaw: '',
      lyricIndex: -1
    })
    updateMediaSessionMetadata(null)
    persistPlayer()
    pushMpris(true)
  },

  setQueue: list => {
    const clean = (Array.isArray(list) ? list : []).filter((s): s is Song => !!s && typeof s.id === 'number')
    set({ queue: clean, order: clean.map((_, i) => i) })
    persistPlayer()
  },

  /* —— 个人库 —— */

  toggleFavorite: song => {
    if (!song) return
    const st = get()
    const exists = st.favorites.some(s => s.id === song.id)
    const favorites = exists
      ? st.favorites.filter(s => s.id !== song.id)
      : [slimSong(song), ...st.favorites].slice(0, FAV_MAX)
    set({ favorites })
    safeSet(LS_FAV, JSON.stringify(favorites))
    setBanner(exists ? '已取消收藏' : `已添加到我喜欢《${song.name}》`, 'info')
  },

  isFavorite: id => get().favorites.some(s => s.id === id),

  addRecent: song => {
    if (!song || typeof song.id !== 'number') return
    addRecentInternal(song)
  },

  /* —— 杂项 —— */

  dismissBanner: () => set({ networkBanner: null }),
  setNetworkBanner: (msg, level = 'info') => set({ networkBanner: msg, bannerLevel: level }),

  setQuality: br => {
    const allowed = [128, 192, 320]
    if (!allowed.includes(br)) return
    qualityBr = br
    const st = get()
    if (st.current) void loadIndex(st.currentIndex, { autoplay: st.isPlaying, startAt: st.progress, skipCache: true })
  },

  quality: () => qualityBr,

  retryCurrent: async () => {
    const st = get()
    if (!st.current) return
    set({ networkBanner: null, demoMode: false })
    await probeProviders(true)
    autoSkipCount = 0
    await loadIndex(st.currentIndex, { autoplay: true })
    if (get().demoMode) setBanner('当前网络无法获取音频流，已进入演示模式', 'warn')
  },

  dispose: () => {
    loadToken++
    stopProgressTimer()
    try {
      audio?.pause()
    } catch {
      /* ignore */
    }
    audio = null
  }
}))

/* ------------------------------ 辅助函数 ------------------------------ */

function randomOtherIndex(length: number, exclude: number): number {
  if (length <= 1) return 0
  let idx = exclude
  let guard = 0
  while (idx === exclude && guard++ < 20) idx = Math.floor(Math.random() * length)
  return idx === exclude ? (exclude + 1) % length : idx
}

function buildShuffleOrder(length: number, firstIndex = 0): number[] {
  const arr = Array.from({ length }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  // 让当前曲排到随机序列首位
  const pos = arr.indexOf(firstIndex)
  if (pos > 0) {
    ;[arr[0], arr[pos]] = [arr[pos], arr[0]]
  }
  return arr
}

/* ------------------------------ 对外 hook ------------------------------ */

/**
 * UI 主入口：返回当前播放状态（不含 actions，actions 用 usePlayerStore.getState()）。
 *
 * 注意：这里返回的是 store 的 live state 对象（zustand 保证引用变化即状态变化），
 * 组件里 `const p = usePlayer()` 后直接读 p.current / p.progress 即可。
 * 若需要精细订阅（避免高频 progress 触发重渲染），请用 `usePlayerSelector`。
 */
export function usePlayer(): PlayerState {
  return usePlayerStore(s => s)
}

/** 精细订阅：只订阅需要的字段（减少 progress 4Hz 带来的重渲染） */
export function usePlayerSelector<T>(
  selector: (s: PlayerStore) => T,
  equals: (a: T, b: T) => boolean = Object.is
): T {
  return usePlayerStore(s => selector(s), equals)
}

export const usePlayerActions = (): PlayerActions => ACTIONS_CACHE

const ACTION_KEYS: (keyof PlayerActions)[] = [
  'playQueue',
  'playTrack',
  'toggle',
  'play',
  'pause',
  'next',
  'prev',
  'seek',
  'seekBy',
  'setVolume',
  'toggleMute',
  'setMode',
  'cycleMode',
  'addNext',
  'addToQueue',
  'removeFromQueue',
  'clearQueue',
  'setQueue',
  'toggleFavorite',
  'isFavorite',
  'addRecent',
  'dismissBanner',
  'setNetworkBanner',
  'setQuality',
  'quality',
  'retryCurrent',
  'dispose'
]

/** 组件外直接调用：usePlayerStore.getState().playQueue(...) */
const ACTIONS_CACHE = ((): PlayerActions => {
  const proxy = {} as PlayerActions
  for (const k of ACTION_KEYS) {
    // 运行期委托给最新 state，避免闭包捕获旧 state
    Object.defineProperty(proxy, k, {
      get: () => usePlayerStore.getState()[k],
      enumerable: true
    })
  }
  return proxy
})()

/** 便捷选择器（UI 常用） */
export const useCurrentSong = (): Song | null => usePlayerStore(s => s.current)
export const useIsPlaying = (): boolean => usePlayerStore(s => s.isPlaying)
export const useProgress = (): number => usePlayerStore(s => s.progress)
export const useLyrics = (): LyricLine[] => usePlayerStore(s => s.lyrics)
export const useLyricIndex = (): number => usePlayerStore(s => s.lyricIndex)
export const useNetworkBanner = (): string | null => usePlayerStore(s => s.networkBanner)
export const usePlayMode = (): PlayMode => usePlayerStore(s => s.mode)
export const useVolume = (): number => usePlayerStore(s => s.volume)
export const useQueue = (): Song[] => usePlayerStore(s => s.queue)
export const useFavorites = (): Song[] => usePlayerStore(s => s.favorites)
export const useRecent = (): Song[] => usePlayerStore(s => s.recent)

/* ------------------------------ 启动逻辑 ------------------------------ */

/**
 * 初始化播放引擎（在 App 挂载时调用一次，可重复调用）。
 *  - 恢复上次队列（不自动播放，避免启动即出声）
 *  - 后台探测音源可用性，全部失败时设置 networkBanner
 */
export function initPlayer(): void {
  if (started) return
  started = true
  ensureAudio()

  const st = usePlayerStore.getState()
  if (!st.queue.length && persisted.queue.length) {
    const idx = Math.max(0, Math.min(persisted.queue.length - 1, persisted.currentIndex))
    usePlayerStore.setState({
      queue: persisted.queue,
      order: persisted.queue.map((_, i) => i),
      currentIndex: idx,
      current: persisted.queue[idx],
      duration: persisted.queue[idx]?.duration ?? 0
    })
    updateMediaSessionMetadata(persisted.queue[idx])
  }

  // 懒加载歌词（恢复的曲目）
  const cur = usePlayerStore.getState().current
  if (cur) void loadLyricsFor(cur, ++loadToken)

  void (async () => {
    try {
      const statuses = await probeProviders()
      const anyOk = statuses.some(s => s.ok)
      if (!anyOk) {
        setBanner('当前网络无法获取音频流，已进入演示模式', 'warn')
        usePlayerStore.setState({ demoMode: true })
      } else {
        usePlayerStore.setState({ demoMode: false, audioSource: statuses.find(s => s.ok)?.label ?? '' })
      }
    } catch {
      /* 探测失败不影响 UI */
    }
  })()

  bindMainProcessCommands()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      setBanner('网络已恢复', 'info')
      void probeProviders(true)
    })
    window.addEventListener('offline', () => {
      setBanner('网络已断开，播放可能中断', 'error')
    })
  }
}

/**
 * 监听主进程反向命令（托盘 / MPRIS / 媒体键），preload 未暴露时静默跳过：
 *   nt.onMediaKey(k) / nt.onMprisCmd({action,value}) / nt.onTrayAction(a)
 */
export function bindMainProcessCommands(): void {
  try {
    const nt = (window as unknown as {
      nt?: {
        onMediaKey?: (cb: (k: string) => void) => unknown
        onMprisCmd?: (cb: (c: { action: string; value?: number }) => void) => unknown
        onTrayAction?: (cb: (a: string) => void) => unknown
      }
    }).nt
    if (!nt) return
    if (typeof nt.onMprisCmd === 'function') {
      nt.onMprisCmd(c => {
        const st = usePlayerStore.getState()
        switch (c?.action) {
          case 'play-pause':
            st.toggle()
            break
          case 'next':
            st.next()
            break
          case 'prev':
            st.prev()
            break
          case 'seek-to':
            if (typeof c.value === 'number') st.seek(c.value * (c.value < 1000 ? 1000 : 1))
            break
          case 'volume':
            if (typeof c.value === 'number') st.setVolume(c.value)
            break
          default:
            break
        }
      })
    }
    if (typeof nt.onTrayAction === 'function') {
      nt.onTrayAction(a => {
        const st = usePlayerStore.getState()
        if (a === 'play-pause') st.toggle()
        else if (a === 'next') st.next()
        else if (a === 'prev') st.prev()
      })
    }
  } catch {
    /* ignore */
  }
}

/** 记住上次停止位置（供下次恢复）：节流写 localStorage */
export function savePlaybackPosition(): void {
  persistPlayer()
}

/* 模块加载即创建 audio（幂等），保证 UI 首次点击即可发声 */
if (typeof window !== 'undefined') {
  ensureAudio()
  startProgressTimer()
}
