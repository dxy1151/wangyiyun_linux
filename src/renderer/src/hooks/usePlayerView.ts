/**
 * 播放引擎契约适配层（UI 侧）
 *
 * 唯一事实来源：src/renderer/src/store/player.ts（dataplayer 维护）。
 *
 * 真实契约（已核对 player.ts）：
 *   usePlayer(): PlayerState —— 含 current/queue/isPlaying/isBuffering/progress(ms)/duration(ms)/
 *     volume/muted/mode/lyrics(LyricLine[])/lyricIndex/favorites/recent/networkBanner(string|null)/
 *     bannerLevel/demoMode/audioSource/quality...
 *   usePlayerSelector(selector) —— 精细订阅
 *   usePlayerStore.getState()  —— 含全部 actions（playQueue/playTrack/toggle/play/pause/next/prev/
 *     seek/seekBy/setVolume/toggleMute/setMode/cycleMode/addNext/addToQueue/removeFromQueue/
 *     clearQueue/setQueue/toggleFavorite/isFavorite/addRecent/dismissBanner/retryCurrent...）
 *
 * UI 一律通过本文件访问，好处：字段兜底、动作缺省不崩、进度类高频更新可单独订阅。
 */
import type { PlayMode, Song } from '@/api/types'
import type { PlayerState, PlayerStore } from '@/store/player'
import { usePlayerSelector, usePlayerStore } from '@/store/player'
import type { LyricLine } from '@/utils/format'
import { parseLrc } from '@/utils/format'

export type BannerLevel = 'info' | 'warn' | 'error'

/** UI 播放视图（在 PlayerState 基础上补齐兜底字段） */
export interface PlayerView {
  current: Song | null
  queue: Song[]
  currentIndex: number
  isPlaying: boolean
  isBuffering: boolean
  /** 毫秒 */
  progress: number
  /** 毫秒 */
  duration: number
  /** 0 ~ 1 */
  volume: number
  muted: boolean
  mode: PlayMode
  /** 已保证为数组 */
  lyrics: LyricLine[]
  lyricIndex: number
  favorites: Song[]
  recent: Song[]
  /** 顶部网络提示（null 表示正常） */
  networkBanner: string | null
  bannerLevel: BannerLevel
  demoMode: boolean
  audioSource: string
}

export const EMPTY_VIEW: PlayerView = {
  current: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  isBuffering: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  mode: 'loop',
  lyrics: [],
  lyricIndex: -1,
  favorites: [],
  recent: [],
  networkBanner: null,
  bannerLevel: 'info',
  demoMode: false,
  audioSource: ''
}

const MODE_SET: readonly PlayMode[] = ['order', 'repeat-one', 'shuffle', 'loop']

function toLines(raw: unknown): LyricLine[] {
  if (Array.isArray(raw)) {
    return (raw as Array<{ time?: unknown; text?: unknown; translation?: unknown }>)
      .map(l => ({
        time: Number(l?.time) || 0,
        text: String(l?.text ?? ''),
        translation: l?.translation ? String(l.translation) : undefined
      }))
      .filter(l => l.text.trim().length > 0)
      .sort((a, b) => a.time - b.time)
  }
  if (typeof raw === 'string') return parseLrc(raw)
  return []
}

/** 归一化（字段缺失时兜底） */
export function toPlayerView(raw: PlayerState | undefined | null): PlayerView {
  if (!raw) return EMPTY_VIEW
  const current = raw.current ?? null
  const duration = typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : (current?.duration ?? 0)
  return {
    current,
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    currentIndex: typeof raw.currentIndex === 'number' ? raw.currentIndex : -1,
    isPlaying: !!raw.isPlaying,
    isBuffering: !!raw.isBuffering,
    progress: typeof raw.progress === 'number' && raw.progress > 0 ? raw.progress : 0,
    duration,
    volume: typeof raw.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : 0.8,
    muted: !!raw.muted,
    mode: (MODE_SET as readonly string[]).includes(String(raw.mode)) ? (raw.mode as PlayMode) : 'loop',
    lyrics: toLines(raw.lyrics),
    lyricIndex: typeof raw.lyricIndex === 'number' ? raw.lyricIndex : -1,
    favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
    recent: Array.isArray(raw.recent) ? raw.recent : [],
    networkBanner: raw.networkBanner ?? null,
    bannerLevel: raw.bannerLevel ?? 'info',
    demoMode: !!raw.demoMode,
    audioSource: raw.audioSource ?? ''
  }
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

/**
 * 整份播放状态（4Hz progress 更新会重渲染订阅者）。
 * 适合：播放栏以外的页面（它们只需 current/queue 等低频字段）。
 */
export function usePlayerView(): PlayerView {
  const state = usePlayerSelector(s => s, Object.is) as PlayerState
  return toPlayerView(state)
}

/** 逐字段订阅：只在选中的值变化时重渲染（推荐用于高频组件） */
export function usePlayerField<T>(selector: (view: PlayerView) => T, equals: (a: T, b: T) => boolean = Object.is): T {
  return usePlayerSelector(s => selector(toPlayerView(s)), equals)
}

/** 只订阅"歌曲身份 + 播放态"（不含 progress），供列表高亮使用 */
export function useNowPlaying(): { id: number | null; isPlaying: boolean } {
  return usePlayerSelector(
    s => ({ id: s.current?.id ?? null, isPlaying: s.isPlaying }),
    (a, b) => a.id === b.id && a.isPlaying === b.isPlaying
  )
}

/** 只订阅收藏 id 集合（列表红心状态用，避免 progress 触发重渲染） */
export function useFavoriteIds(): Set<number> {
  return usePlayerSelector(
    s => new Set(s.favorites.map(f => f.id)),
    (a, b) => a.size === b.size && [...a].every(id => b.has(id))
  )
}

/* ------------------------------------------------------------------ */
/* 动作（组件外可用的命令式 API）                                        */
/* ------------------------------------------------------------------ */

function actions(): PlayerStore {
  return usePlayerStore.getState()
}

function invoke<K extends keyof PlayerStore>(name: K, ...args: unknown[]): unknown {
  const state = actions()
  const fn = state[name]
  if (typeof fn !== 'function') {
    console.warn(`[player] action ${String(name)}() 不可用`)
    return undefined
  }
  try {
    return (fn as (...a: unknown[]) => unknown).apply(state, args)
  } catch (err) {
    console.warn(`[player] action ${String(name)} failed`, err)
    return undefined
  }
}

/** 命令式动作集合（可在任意位置调用，无需 hook） */
export const player = {
  playQueue: (list: Song[], index = 0): void => void invoke('playQueue', list, index),
  playTrack: (song: Song, queue?: Song[]): void => void invoke('playTrack', song, queue),
  toggle: (): void => void invoke('toggle'),
  play: (): void => void invoke('play'),
  pause: (): void => void invoke('pause'),
  next: (): void => void invoke('next'),
  prev: (): void => void invoke('prev'),
  seek: (ms: number): void => void invoke('seek', Math.max(0, Math.round(ms))),
  seekBy: (deltaMs: number): void => void invoke('seekBy', deltaMs),
  setVolume: (v: number): void => void invoke('setVolume', Math.min(1, Math.max(0, v))),
  toggleMute: (): void => void invoke('toggleMute'),
  setMode: (m: PlayMode): void => void invoke('setMode', m),
  cycleMode: (): void => void invoke('cycleMode'),
  addNext: (song: Song): void => void invoke('addNext', song),
  addToQueue: (song: Song): void => void invoke('addToQueue', song),
  removeFromQueue: (index: number): void => void invoke('removeFromQueue', index),
  clearQueue: (): void => void invoke('clearQueue'),
  setQueue: (list: Song[]): void => void invoke('setQueue', list),
  toggleFavorite: (song: Song): void => void invoke('toggleFavorite', song),
  isFavorite: (id: number): boolean => {
    const state = actions()
    try {
      return !!state.isFavorite(id)
    } catch {
      return (state.favorites ?? []).some(f => f.id === id)
    }
  },
  dismissBanner: (): void => void invoke('dismissBanner'),
  retryCurrent: (): void => void invoke('retryCurrent'),
  addRecent: (song: Song): void => void invoke('addRecent', song)
}

/** 根据 id 判断是否已收藏（读视图，供不需要订阅的地方使用） */
export function isFavoriteById(view: PlayerView, id: number | undefined): boolean {
  if (!id) return false
  return (view.favorites ?? []).some(f => f?.id === id)
}

/** 读取当前快照（组件外逻辑用） */
export function getPlayerState(): PlayerView {
  return toPlayerView(usePlayerStore.getState())
}

/** 订阅播放状态变化（组件外，如全局快捷键） */
export function subscribePlayer(listener: () => void): () => void {
  return usePlayerStore.subscribe(listener)
}

export { MODE_SET }
