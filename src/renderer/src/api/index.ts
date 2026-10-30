/**
 * API 聚合入口（`import * as api from '@/api'`）
 *
 * 职责：
 *  1. 汇总 netease.ts / mirror.ts / client.ts 的导出，让 UI 只需要一个入口。
 *  2. 提供 **UI 约定的稳定别名**（searchMulti / searchSongs / getPlaylist ...），
 *     底层实现来自官方接口，取播放地址时再交给 mirror 层。
 *  3. 所有函数都保证不抛出：失败时返回空数组 / null，并记录 warn。
 */

import * as netease from './netease'
import * as mirror from './mirror'
import * as client from './client'
import type {
  Album,
  Artist,
  ChartSummary,
  Lyrics,
  Playlist,
  RecommendPlaylist,
  SearchResult,
  Song
} from './types'

export * from './types'
export * from './netease'
export { clearApiCache, cacheStats } from './client'

/* ---------------------------------- 工具 ---------------------------------- */

function safe<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  return fn().catch(err => {
    console.warn(`[api] ${label} 失败：`, err instanceof Error ? err.message : err)
    return fallback
  })
}

/* ------------------------------- UI 稳定别名 ------------------------------- */

/**
 * 搜索单曲。
 * 官方接口只返回 album.picId（没有 picUrl），这里用 mirror 的 picId → meting pic 链接补封面，
 * 保证搜索结果页 100% 有图可显示（补齐失败则保持空串，由 UI 渲染占位）。
 */
export async function searchSongs(kw: string, limit = 30, offset = 0): Promise<Song[]> {
  const songs = await safe('searchSongs', [], () => netease.officialSearchSongs(kw, limit, offset))
  if (!songs.length || songs.every(s => s.picUrl)) return songs
  try {
    const filled = await mirror.fillSearchPics(kw, songs)
    if (filled) return filled
  } catch {
    /* 补图失败不影响搜索 */
  }
  return songs
}

/** 搜索歌手 */
export function searchArtists(kw: string, limit = 20): Promise<Artist[]> {
  return safe('searchArtists', [], () => netease.officialSearchArtists(kw, limit))
}

/** 搜索专辑 */
export function searchAlbums(kw: string, limit = 20): Promise<Album[]> {
  return safe('searchAlbums', [], () => netease.officialSearchAlbums(kw, limit))
}

/** 搜索歌单 */
export function searchPlaylists(kw: string, limit = 20): Promise<Playlist[]> {
  return safe('searchPlaylists', [], () => netease.officialSearchPlaylists(kw, limit))
}

/**
 * 聚合搜索：一次拿齐四类结果（UI 的搜索页使用）。
 * 单曲结果若缺少封面，会用 mirror 层补齐（mirror 不可用时保持空，不影响展示）。
 */
export async function searchMulti(kw: string, limit = 30): Promise<SearchResult> {
  const keyword = kw.trim()
  if (!keyword) {
    return { keyword, songs: [], artists: [], albums: [], playlists: [] }
  }
  const [songs, artists, albums, playlists] = await Promise.all([
    searchSongs(keyword, limit),
    searchArtists(keyword, 12),
    searchAlbums(keyword, 12),
    searchPlaylists(keyword, 12)
  ])
  // 官方搜索接口不返回 picUrl，只有 picId；尝试用 mirror 搜索补齐封面（尽力而为）
  if (songs.length && songs.some(s => !s.picUrl)) {
    try {
      const filled = await mirror.fillSearchPics(keyword, songs)
      if (filled) return { keyword, songs: filled, artists, albums, playlists }
    } catch {
      /* 忽略 */
    }
  }
  return { keyword, songs, artists, albums, playlists }
}

/** 歌单详情 */
export function getPlaylist(id: number): Promise<Playlist | null> {
  return safe('getPlaylist', null, () => netease.officialPlaylist(id))
}

/** 专辑详情 */
export function getAlbum(id: number): Promise<Album | null> {
  return safe('getAlbum', null, () => netease.officialAlbum(id))
}

/** 歌手详情 */
export function getArtist(id: number): Promise<Artist | null> {
  return safe('getArtist', null, () => netease.officialArtist(id))
}

/** 歌词 */
export function getLyrics(id: number): Promise<Lyrics | null> {
  return safe('getLyrics', null, () => netease.officialLyrics(id))
}

/** 榜单列表 */
export function getHotCharts(): Promise<ChartSummary[]> {
  return safe('getHotCharts', [], () => netease.officialToplist())
}

/** 推荐歌单 */
export function getRecommend(limit = 12): Promise<RecommendPlaylist[]> {
  return safe('getRecommend', [], () => netease.officialRecommend(limit))
}

/** 最新音乐 */
export function getNewSongs(limit = 20): Promise<Song[]> {
  return safe('getNewSongs', [], () => netease.officialNewSongs(limit))
}

/** 榜单（其实就是歌单详情） */
export function getToplist(id: number): Promise<Playlist | null> {
  return getPlaylist(id)
}

/**
 * 获取歌曲播放地址（多源、带缓存）。
 * 返回 null 表示当前网络环境下拿不到音频流，播放引擎进入"演示模式"。
 */
export function getSongUrl(id: number, br = 320): Promise<string | null> {
  return safe('getSongUrl', null, () => mirror.getSongUrl(id, br))
}

/** 播放地址探测（App 启动时调用一次，结果缓存 10 分钟） */
export function probeAudioSource(): Promise<boolean> {
  return safe('probeAudioSource', false, () => mirror.probe())
}

/* --------------------------------- 其它补充 --------------------------------- */

/** 网易云网页版链接（右键"在浏览器打开"用） */
export function songPageUrl(id: number): string {
  return `https://music.163.com/#/song?id=${id}`
}

export function playlistPageUrl(id: number): string {
  return `https://music.163.com/#/playlist?id=${id}`
}

export function albumPageUrl(id: number): string {
  return `https://music.163.com/#/album?id=${id}`
}

export function artistPageUrl(id: number): string {
  return `https://music.163.com/#/artist?id=${id}`
}

/** 原始模块（调试用） */
export const raw = { netease, mirror, client }
