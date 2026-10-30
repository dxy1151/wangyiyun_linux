/**
 * 数据层访问封装（UI 侧）
 *
 * api 层（src/renderer/src/api，dataplayer 维护）已导出：
 *   searchMulti/searchSongs/searchArtists/searchAlbums/searchPlaylists
 *   getPlaylist/getArtist/getAlbum/getLyrics/getHotCharts/getRecommend/getNewSongs/getToplist
 * 这里只做「调用 + 空值兜底 + 归一」，不重复实现数据逻辑。
 */
import {
  getAlbum,
  getArtist,
  getHotCharts,
  getLyrics,
  getNewSongs,
  getPlaylist,
  getRecommend,
  getToplist,
  searchMulti
} from '@/api'
import type {
  Album,
  Artist,
  ChartSummary,
  Playlist,
  RecommendPlaylist,
  SearchResult,
  Song
} from '@/api/types'
import { parseLrc } from '@/utils/format'
import type { LyricLine } from '@/utils/format'

export interface NormalizedLyrics {
  lines: LyricLine[]
  lrc: string
  instrumental: boolean
}

/* ============================== 发现页 ============================== */

/** 推荐歌单（首页网格） */
export async function fetchRecommendPlaylists(limit = 18): Promise<RecommendPlaylist[]> {
  const list = await getRecommend(limit)
  return Array.isArray(list) ? list : []
}

/** 最新音乐 */
export async function fetchNewSongs(limit = 12): Promise<Song[]> {
  const list = await getNewSongs(limit)
  return Array.isArray(list) ? list.filter(Boolean) : []
}

/** 排行榜概览 */
export async function fetchHotCharts(): Promise<ChartSummary[]> {
  const list = await getHotCharts()
  return Array.isArray(list) ? list : []
}

/** 榜单详情（榜单 id → Playlist，含 tracks） */
export async function fetchToplist(id: number | string): Promise<Playlist> {
  const pl = await getToplist(Number(id))
  if (!pl) throw new Error('榜单不存在')
  return { ...pl, tracks: Array.isArray(pl.tracks) ? pl.tracks : [] }
}

/* ============================== 详情 ============================== */

export async function fetchPlaylist(id: number | string): Promise<Playlist> {
  const pl = await getPlaylist(Number(id))
  if (!pl) throw new Error('歌单不存在或已下架')
  return {
    ...pl,
    tracks: Array.isArray(pl.tracks) ? pl.tracks.filter(Boolean) : []
  }
}

export async function fetchAlbum(id: number | string): Promise<Album> {
  const album = await getAlbum(Number(id))
  if (!album) throw new Error('专辑不存在')
  return { ...album, songs: Array.isArray(album.songs) ? album.songs.filter(Boolean) : [] }
}

export async function fetchArtist(id: number | string): Promise<Artist> {
  const artist = await getArtist(Number(id))
  if (!artist) throw new Error('歌手不存在')
  return {
    ...artist,
    hotSongs: Array.isArray(artist.hotSongs) ? artist.hotSongs.filter(Boolean) : [],
    albums: Array.isArray(artist.albums) ? artist.albums.filter(Boolean) : []
  }
}

/* ============================== 搜索 ============================== */

const EMPTY_SEARCH: SearchResult = { songs: [], artists: [], albums: [], playlists: [], keyword: '' }

export async function fetchSearchAll(keyword: string): Promise<SearchResult> {
  const kw = keyword.trim()
  if (!kw) return { ...EMPTY_SEARCH }
  const res = await searchMulti(kw, 30)
  if (!res) return { ...EMPTY_SEARCH, keyword: kw }
  return {
    songs: Array.isArray(res.songs) ? res.songs.filter(Boolean) : [],
    artists: Array.isArray(res.artists) ? res.artists.filter(Boolean) : [],
    albums: Array.isArray(res.albums) ? res.albums.filter(Boolean) : [],
    playlists: Array.isArray(res.playlists) ? res.playlists.filter(Boolean) : [],
    keyword: res.keyword || kw,
    counts: res.counts
  }
}

/* ============================== 歌词 ============================== */

/** 统一歌词结构（api 失败/无歌词返回空 lines） */
export async function fetchLyrics(id: number): Promise<NormalizedLyrics> {
  const lyrics = await getLyrics(id)
  if (!lyrics) return { lines: [], lrc: '', instrumental: true }

  const lines: LyricLine[] =
    Array.isArray(lyrics.lines) && lyrics.lines.length > 0
      ? lyrics.lines
          .map(l => ({
            time: Number(l.time) || 0,
            text: String(l.text ?? ''),
            translation: l.translation || undefined
          }))
          .filter(l => l.text.trim().length > 0)
      : parseLrc(lyrics.lrc ?? '')

  return {
    lines,
    lrc: lyrics.lrc ?? '',
    instrumental: !!lyrics.instrumental || lines.length === 0
  }
}
