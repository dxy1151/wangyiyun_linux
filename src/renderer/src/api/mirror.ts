/**
 * 第三方镜像适配层（目前唯一实测可用：music-api.gdstudio.xyz）
 *
 * 实测（见 docs/api-notes.md）：
 *  - types=url   → {url, br, size}，带 br=128|192|320 返回 mp3，不带 br 常返回 flac。
 *  - types=search→ [{id,name,artist[],album,pic_id,url_id,lyric_id,source}]
 *  - types=lyric → {lyric: LRC}
 *  - types=playlist / album / artist 不稳定（曾返回 400 或 20s 超时），只作为兜底。
 *  - api.injahow.cn/meting 音源为 302 跳转直链（可作备用播放源）；歌单返回 meting 结构。
 *  - api.vkeys.cn / api.kxzjoker.cn 不可用。
 *
 * 本模块职责：
 *  1) 维护"音源候选列表"，逐个探测并按可用性排序（探测结果缓存 10 分钟）。
 *  2) 故障转移：当前源失败自动切下一个，并把成功源提升为优先。
 *  3) 向 netease.ts 提供同一套归一化类型（Song / Playlist / ...）。
 */

import { getJson } from './client'
import { OFFICIAL_HEADERS, normalizeSong, parseLrc, str, num } from './netease'
import type { AudioUrl, DataSource, Lyrics, Playlist, Song } from './types'

/* ------------------------------ 配置 ------------------------------ */

const GD_BASE = 'https://music-api.gdstudio.xyz/api.php'
const METING_BASE = 'https://api.injahow.cn/meting/'

/** 探测结果缓存时长：10 分钟 */
const PROBE_TTL = 10 * 60_000

/** 默认音质：320kbps mp3（体积/质量折中，且实测稳定返回 mp3） */
export type MirrorBitrate = 128 | 192 | 320 | 740 | 999
export const DEFAULT_BITRATE: MirrorBitrate = 320

export type UrlProviderId = 'gdstudio' | 'meting'

interface UrlProvider {
  id: UrlProviderId
  label: string
  /** 构造播放直链 URL（gdstudio 返回 JSON，meting 返回 302） */
  build: (songId: number, br: MirrorBitrate) => string
  /** 解析响应：返回直链（未命中返回空串） */
  parse: (data: unknown) => { url: string; br: number; size: number } | null
}

const PROVIDERS: UrlProvider[] = [
  {
    id: 'gdstudio',
    label: 'gdstudio',
    build: (id, br) => `${GD_BASE}?types=url&id=${id}&source=netease&br=${br}`,
    parse: data => {
      const d = data as { url?: unknown; br?: unknown; size?: unknown } | null
      if (!d || typeof d.url !== 'string' || !d.url) return null
      return { url: d.url, br: num(d.br), size: num(d.size) }
    }
  },
  {
    id: 'meting',
    label: 'injahow-meting',
    build: (id, br) => `${METING_BASE}?type=url&id=${id}&server=netease&br=${br}`,
    // meting 返回 302，request() 只认 2xx/JSON，因此这里解析不到就交给 resolveViaRedirect 处理
    parse: data => {
      if (typeof data === 'string' && /^https?:\/\//.test(data.trim())) {
        return { url: data.trim(), br: 0, size: 0 }
      }
      return null
    }
  }
]

/** 探测用歌曲 id（Beyond《海阔天空》，实测 gdstudio 可返回 mp3） */
const PROBE_SONG_ID = 347230

/* ------------------------------ 探测状态 ------------------------------ */

export interface ProviderStatus {
  id: UrlProviderId
  label: string
  /** 最近一次探测是否可用 */
  ok: boolean
  /** 探测耗时 */
  latency: number
  /** 探测时间戳 */
  at: number
  /** 失败原因 */
  error?: string
}

let statuses: ProviderStatus[] = []
let probing: Promise<ProviderStatus[]> | null = null

/** 探测单个 provider 是否可获取播放直链 */
async function probeProvider(p: UrlProvider, br: MirrorBitrate = 128): Promise<ProviderStatus> {
  const started = Date.now()
  try {
    const res = await getJson<unknown>(p.build(PROBE_SONG_ID, br), { timeout: 6000, retries: 0, noCache: true })
    const parsed = p.parse(res)
    if (parsed?.url) {
      return { id: p.id, label: p.label, ok: true, latency: Date.now() - started, at: Date.now() }
    }
    if (p.id === 'meting') {
      // 302 跳转型：用 HEAD 验证 Location
      const loc = await headRedirectLocation(p.build(PROBE_SONG_ID, br))
      if (loc) return { id: p.id, label: p.label, ok: true, latency: Date.now() - started, at: Date.now() }
    }
    return {
      id: p.id,
      label: p.label,
      ok: false,
      latency: Date.now() - started,
      at: Date.now(),
      error: parsed ? 'empty url' : 'no url in response'
    }
  } catch (err) {
    return {
      id: p.id,
      label: p.label,
      ok: false,
      latency: Date.now() - started,
      at: Date.now(),
      error: String((err as Error)?.message ?? err)
    }
  }
}

/** 读取 302 的 Location（不跟随跳转；同样用 AbortSignal.timeout 避免超时异常冒泡） */
async function headRedirectLocation(url: string): Promise<string | null> {
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(6000) : undefined
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { ...OFFICIAL_HEADERS },
      signal,
      credentials: 'omit'
    })
    const loc = res.headers.get('location') ?? ''
    if (loc && /^https?:\/\//.test(loc)) return loc
    if (res.type === 'opaqueredirect') return 'redirect'
    if (res.status >= 300 && res.status < 400) return 'redirect'
    return null
  } catch {
    return null
  }
}

/**
 * 探测全部音源（结果缓存 10 分钟；并发调用共享同一次探测）。
 * 永不抛异常。
 */
export async function probeProviders(force = false): Promise<ProviderStatus[]> {
  const fresh = statuses.length > 0 && Date.now() - Math.max(...statuses.map(s => s.at)) < PROBE_TTL
  if (!force && fresh) return statuses
  if (probing) return probing
  probing = (async () => {
    try {
      // 探测最多等 8s，超时的源视为不可用（避免拖住首曲播放）
      const results = await Promise.race([
        Promise.all(PROVIDERS.map(p => probeProvider(p))),
        new Promise<ProviderStatus[]>(resolve =>
          setTimeout(
            () =>
              resolve(
                PROVIDERS.map(p => ({
                  id: p.id,
                  label: p.label,
                  ok: false,
                  latency: 8000,
                  at: Date.now(),
                  error: 'probe timeout'
                }))
              ),
            8000
          )
        )
      ])
      results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.latency - b.latency)
      statuses = results
    } catch {
      statuses = PROVIDERS.map(p => ({ id: p.id, label: p.label, ok: false, latency: 0, at: Date.now() }))
    } finally {
      probing = null
    }
    return statuses
  })()
  return probing
}

/** 当前探测状态（不触发探测，供 UI 显示"音源：gdstudio"等） */
export function providerStatus(): ProviderStatus[] {
  return statuses.slice()
}

/** 是否有任何可用音源（未探测时返回 true，避免误报演示模式） */
export function hasWorkingSource(): boolean {
  if (!statuses.length) return true
  return statuses.some(s => s.ok)
}

/** 可用音源的展示名（UI 顶部提示/设置页用） */
export function workingSourceLabel(): string {
  const hit = statuses.find(s => s.ok)
  return hit ? hit.label : ''
}

/* ------------------------------ 播放直链 ------------------------------ */

function guessFormat(url: string): 'mp3' | 'flac' | 'unknown' {
  const u = url.toLowerCase()
  if (u.includes('.flac')) return 'flac'
  if (u.includes('.mp3') || u.includes('.m4a')) return 'mp3'
  return 'unknown'
}

/**
 * 解析单个源：返回 AudioUrl（失败返回 null）。
 * meting 的 302 在浏览器 fetch(manual) 下无法读取 Location，
 * 因此直接返回该 URL 本身（<audio> 可以自行跟随 302）。
 */
async function resolveVia(
  provider: UrlProvider,
  songId: number,
  br: MirrorBitrate,
  signal?: AbortSignal
): Promise<AudioUrl | null> {
  const url = provider.build(songId, br)
  // 注意：真实直链带签名且 ~20s 后失效，不能长期缓存（只缓存很短时间避免同一次切歌重复请求）
  const data = await getJson<unknown>(url, { timeout: 8000, retries: 0, ttl: 20_000, noCache: false, signal })
  const parsed = provider.parse(data)
  if (!parsed?.url) {
    if (provider.id === 'meting') {
      const loc = await headRedirectLocation(url)
      if (loc && loc !== 'redirect') {
        return { url: loc, br: br * 1000, size: 0, source: 'meting', format: guessFormat(loc) }
      }
      if (loc === 'redirect') {
        return { url, br: br * 1000, size: 0, source: 'meting', format: 'mp3' }
      }
    }
    return null
  }
  return {
    url: parsed.url,
    br: parsed.br ? Math.round(parsed.br * 1000) : br * 1000,
    size: parsed.size,
    source: provider.id as DataSource,
    format: guessFormat(parsed.url)
  }
}

const urlMemo = new Map<string, { value: AudioUrl | null; at: number }>()
/** 直链很短命（签名 ~20s 后失效）：缓存仅用于"同一次切歌/重试"内去重，不跨歌缓存失败 */
const URL_MEMO_TTL = 4000

/**
 * 获取歌曲播放直链：多源 + 多码率故障转移。
 *
 * 顺序：探测可用源优先 → 默认码率 → 降码率重试（320→192→128）。
 * 全部失败返回 { url:'', unavailable:true }（调用方进入演示模式），永不抛异常。
 */
export async function getAudioUrl(
  songId: number,
  opts: { br?: MirrorBitrate; force?: boolean; signal?: AbortSignal } = {}
): Promise<AudioUrl> {
  const aborted = (): boolean => !!opts.signal?.aborted
  const memoKey = `${songId}@${opts.br ?? DEFAULT_BITRATE}`
  if (!opts.force) {
    const hit = urlMemo.get(memoKey)
    if (hit && hit.value && Date.now() - hit.at < URL_MEMO_TTL) return hit.value
    if (hit && !hit.value) urlMemo.delete(memoKey)
  }
  const fail = (): AudioUrl => ({
    url: '',
    br: 0,
    size: 0,
    source: 'fallback',
    format: 'unknown',
    unavailable: true,
    expiresAt: Date.now() + 60_000
  })

  const id = num(songId)
  if (!id) return fail()

  const preferred = opts.br ?? DEFAULT_BITRATE
  const ladder: MirrorBitrate[] = Array.from(new Set<MirrorBitrate>([preferred, 320, 192, 128]))

  // 探测结果决定顺序（未探测过也允许直接尝试，探测是优化不是前提）
  if (!statuses.length) {
    probeProviders().catch(() => undefined)
  }
  const ordered = statuses.length
    ? [
        ...statuses.filter(s => s.ok).map(s => PROVIDERS.find(p => p.id === s.id)!),
        ...statuses.filter(s => !s.ok).map(s => PROVIDERS.find(p => p.id === s.id)!).filter(Boolean)
      ]
    : PROVIDERS.slice()

  for (const provider of ordered) {
    for (const br of ladder) {
      if (aborted()) return fail()
      let result: AudioUrl | null = null
      try {
        result = await resolveVia(provider, id, br, opts.signal)
      } catch {
        result = null
      }
      if (result?.url) {
        urlMemo.set(memoKey, { value: result, at: Date.now() })
        // 成功的源提升为首选
        if (statuses.length) {
          statuses = statuses.map(s => (s.id === provider.id ? { ...s, ok: true, at: Date.now() } : s))
          statuses.sort((a, b) => Number(b.ok) - Number(a.ok) || a.latency - b.latency)
        }
        return result
      }
    }
  }

  urlMemo.set(memoKey, { value: null, at: Date.now() })
  return fail()
}

/** 清空直链缓存（切换网络/强制刷新时用） */
export function clearAudioUrlCache(): void {
  urlMemo.clear()
}

/** 重置全部镜像状态：直链缓存 + 探测结果（断网重连、设置页"重新检测音源"时用） */
export function resetMirrorState(): void {
  urlMemo.clear()
  statuses = []
}

/* ------------------------------ 搜索兜底 ------------------------------ */

interface GdSearchItem {
  id?: string | number
  name?: string
  artist?: string | string[]
  album?: string
  pic_id?: string | number
  url_id?: string | number
  lyric_id?: string | number
}

/** gdstudio 搜索（带封面 pic_id 与可用 url_id），永��抛异常 */
export async function mirrorSearchSongs(kw: string, limit = 30, page = 1): Promise<Song[]> {
  const url =
    `${GD_BASE}?types=search&name=${encodeURIComponent(kw)}&source=netease` +
    `&pages=${Math.max(1, page)}&count=${Math.max(1, Math.min(limit, 50))}`
  const data = await getJson<GdSearchItem[] | { data?: GdSearchItem[] }>(url, {
    timeout: 10_000,
    retries: 1,
    ttl: 30 * 60_000,
    persist: true
  })
  const list: GdSearchItem[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data!.data! : []
  return list
    .map(item => {
      const artists = Array.isArray(item.artist)
        ? item.artist
        : typeof item.artist === 'string'
          ? item.artist.split(/[/、,&]/).map(s => s.trim()).filter(Boolean)
          : []
      const picId = num(item.pic_id)
      const song = normalizeSong({
        id: num(item.url_id ?? item.id),
        name: str(item.name),
        duration: 0,
        artists: artists.map(name => ({ name })),
        album: { name: str(item.album) }
      } as Parameters<typeof normalizeSong>[0])
      if (!song) return null
      // gdstudio 的 pic_id 缺 CDN hash，无法直接拼成网易云封面 URL，
      // 但 meting 提供了按 picId 取图的接口（实测 302 到真实图片），这里用它当封面。
      song.picUrl = picId ? `${METING_BASE}?type=pic&server=netease&id=${picId}` : ''
      song.picId = picId
      song.album.picUrl = song.picUrl
      return song
    })
    .filter((s): s is Song => !!s)
}

/** meting 搜索（备用，返回 meting 结构） */
export async function metingSearchSongs(kw: string, limit = 30): Promise<Song[]> {
  const url = `${METING_BASE}?type=search&id=${encodeURIComponent(kw)}&server=netease`
  const data = await getJson<unknown>(url, { timeout: 10_000, retries: 0, ttl: 30 * 60_000 })
  const list = Array.isArray(data) ? data : []
  return list.slice(0, limit).map((item, i) => {
    const it = item as { name?: string; artist?: string; url?: string; pic?: string; lrc?: string }
    // meting 的 url 形如 .../meting/?server=netease&type=url&id=287398，从中取 id
    const m = String(it.url ?? '').match(/[?&]id=(\d+)/)
    const id = m ? num(m[1]) : 0
    const pic = str(it.pic)
    return {
      id,
      name: str(it.name, '未知歌曲'),
      artists: [{ id: 0, name: str(it.artist, '未知歌手') }],
      album: { id: 0, name: '', picUrl: pic },
      duration: 0,
      fee: 0,
      picUrl: pic,
      artistText: str(it.artist),
      // 记录序号用于去重键唯一
      ...(id ? {} : { _fallbackIndex: i })
    } as Song
  })
}

/* ------------------------------ 歌单/歌词兜底 ------------------------------ */

/** gdstudio 歌单（不稳定，20s 超时，失败返回 null） */
export async function mirrorPlaylist(id: number): Promise<Playlist | null> {
  const url = `${GD_BASE}?types=playlist&id=${id}&source=netease`
  const data = await getJson<{
    playlist?: Record<string, unknown>
    tracks?: unknown[]
    songList?: unknown[]
    id?: number
    name?: string
  }>(url, { timeout: 20_000, retries: 0, ttl: 10 * 60_000 })
  if (!data) return null
  const p = (data.playlist ?? data) as {
    id?: number
    name?: string
    coverImgUrl?: string
    description?: string
    trackCount?: number
    playCount?: number
    updateTime?: number
    creator?: { userId?: number; nickname?: string; avatarUrl?: string }
    tracks?: unknown[]
    songList?: unknown[]
  }
  const rawTracks = p.tracks ?? p.songList ?? (data.tracks as unknown[]) ?? (data.songList as unknown[]) ?? []
  const tracks = (rawTracks as Parameters<typeof normalizeSong>[0][]).map(s => normalizeSong(s)).filter((s): s is Song => !!s)
  return {
    id: num(p.id ?? id),
    name: str(p.name, '未命名歌单'),
    coverImgUrl: str(p.coverImgUrl),
    description: str(p.description),
    creator: {
      id: num(p.creator?.userId),
      nickname: str(p.creator?.nickname, '网易云音乐'),
      avatarUrl: str(p.creator?.avatarUrl)
    },
    trackCount: num(p.trackCount) || tracks.length,
    playCount: num(p.playCount),
    updateTime: num(p.updateTime),
    tracks,
    source: 'gdstudio'
  }
}

/** gdstudio 歌词（备用），无译文 */
export async function mirrorLyric(id: number): Promise<Lyrics | null> {
  const url = `${GD_BASE}?types=lyric&id=${id}&source=netease`
  const data = await getJson<{ lyric?: string } | string>(url, { timeout: 8000, retries: 0, ttl: 60 * 60_000 })
  const lrc = typeof data === 'string' ? data : str(data?.lyric)
  if (!lrc) return null
  return { id, lrc, tlyric: '', lines: parseLrc(lrc), instrumental: false }
}

/* ------------------------------ UI 稳定契约（lead 约定，勿改名） ------------------------------ */

/**
 * 获取歌曲播放直链（gdstudio → meting 故障转移，320→192→128 降码率）。
 * 返回 null 表示当前网络拿不到音频流（播放引擎据此进入演示模式）。永不抛异常。
 */
export async function getSongUrl(id: number, br: number = DEFAULT_BITRATE): Promise<string | null> {
  try {
    const allowed: MirrorBitrate[] = [128, 192, 320, 740, 999]
    const b = (allowed.includes(br as MirrorBitrate) ? br : DEFAULT_BITRATE) as MirrorBitrate
    const info = await getAudioUrl(id, { br: b })
    return info.url || null
  } catch {
    return null
  }
}

/** 探测音源可用性（结果缓存 10 分钟），返回是否至少有一个可用源。永不抛异常。 */
export async function probe(): Promise<boolean> {
  try {
    const statuses = await probeProviders(false)
    return statuses.some(s => s.ok)
  } catch {
    return false
  }
}

/** 用 meting 的 pic 接口把 picId 转成可直接给 <img> 用的真实封面 URL */
export function picUrlFromPicId(picId: number | string | undefined | null): string {
  const id = num(picId)
  if (!id) return ''
  return `${METING_BASE}?type=pic&server=netease&id=${id}`
}

/** 歌曲名归一化（去括号内容/大小写/空白），用于模糊匹配 */
function normName(name: string): string {
  return String(name ?? '')
    .replace(/[(（\[【].*?[)）\]】]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * 用镜像搜索补齐单曲封面。
 *
 * 官方搜索只返回 album.picId（无 picUrl，且 picId 无法反推 CDN hash），
 * 这里做两件事：
 *   1. 本地 picId → meting pic 链接（零额外请求，命中率极高）；
 *   2. 仍缺封面的曲目，用 gdstudio `types=search` 按「歌名 + 歌手」匹配同 id 后取 pic_id 再转 link。
 * 全部失败返回 null（调用方保持原数组）。永不抛异常。
 */
export async function fillSearchPics(keyword: string, songs: Song[]): Promise<Song[] | null> {
  try {
    if (!Array.isArray(songs) || !songs.length) return null

    // 1) 先用 picId 直接构造（大多数官方搜索结果都带 album.picId）
    let changed = false
    const withPic = songs.map(s => {
      if (s.picUrl) return s
      const picId = s.picId ?? s.album?.picId
      const url = picUrlFromPicId(picId)
      if (!url) return s
      changed = true
      return { ...s, picUrl: url, picId: num(picId), album: { ...s.album, picUrl: url } }
    })

    // 2) 剩下的（没有 picId 的）走镜像搜索匹配
    const missing = withPic.filter(s => !s.picUrl).slice(0, 12)
    if (!missing.length) return changed ? withPic : null

    const list = await mirrorSearchSongs(keyword, 50)
    if (!list.length) return changed ? withPic : null

    const byId = new Map<number, Song>()
    for (const x of list) if (x.id) byId.set(x.id, x)
    const byName = new Map<string, Song>()
    for (const x of list) if (!byName.has(normName(x.name))) byName.set(normName(x.name), x)

    const result = withPic.map(s => {
      if (s.picUrl) return s
      const hit = byId.get(s.id) ?? byName.get(normName(s.name))
      const picId = hit?.picId
      const url = picUrlFromPicId(picId)
      if (!url) return s
      changed = true
      return { ...s, picUrl: url, picId, album: { ...s.album, picUrl: url } }
    })
    return changed ? result : null
  } catch {
    return null
  }
}
