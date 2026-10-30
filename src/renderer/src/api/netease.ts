/**
 * 网易云官方老接口适配层（music.163.com/api/...）
 *
 * 实测结论（见 docs/api-notes.md）：
 *  - 需要 User-Agent；Referer 实测非必需但仍携带（更稳）。
 *  - 可用：search/get/web、playlist/detail、toplist/detail、song/lyric、artist/<id>、
 *          artist/albums/<id>、v1/album/<id>、personalized/playlist、personalized/newsong。
 *  - 不可用：/api/album/<id>（-462 风控）、/api/song/detail（空）、song/enhance/player/url（受限）。
 *
 * 本模块只负责"取原始 JSON + 归一化"，**不做多源故障转移**（那是 mirror.ts 的职责）。
 * 所有函数永不抛异常，失败返回空数组 / null 由上层决定降级策略。
 */

import { getJson } from './client'
import type { Album, AlbumRef, Artist, ArtistRef, ChartSummary, Lyrics, LyricLine, Playlist, RecommendPlaylist, Song } from './types'

const BASE = 'https://music.163.com'

/** 官方接口统一 header（Electron 渲染进程允许设置，浏览器会忽略但通常不报错） */
export const OFFICIAL_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com'
}

/* ------------------------------ 原始结构类型（按需裁剪） ------------------------------ */

interface RawArtist {
  id?: number
  name?: string
  picUrl?: string
  img1v1Url?: string
  briefDesc?: string
  albumSize?: number
  musicSize?: number
  alias?: string[]
}

interface RawAlbum {
  id?: number
  name?: string
  picUrl?: string
  blurPicUrl?: string
  picId?: number
  /** 新版接口里 picId 的别名 */
  pic?: number
  size?: number
  publishTime?: number
  description?: string
  company?: string
  artists?: RawArtist[]
  artist?: RawArtist
}

/** 老结构歌曲（search/playlist/artist/album v1 混用，字段二选一） */
interface RawSong {
  id?: number
  name?: string
  /** 老结构时长 */
  duration?: number
  /** 新结构时长 */
  dt?: number
  fee?: number
  alias?: string[]
  alia?: string[]
  artists?: RawArtist[]
  /** 新结构歌手 */
  ar?: RawArtist[]
  album?: RawAlbum
  /** 新结构专辑 */
  al?: RawAlbum
}

interface RawPlaylist {
  id?: number
  name?: string
  coverImgUrl?: string
  description?: string
  creator?: { userId?: number; nickname?: string; avatarUrl?: string }
  trackCount?: number
  playCount?: number
  updateTime?: number
  createTime?: number
  tags?: string[]
  ToplistType?: string | null
  updateFrequency?: string
  tracks?: RawSong[]
}

/* ------------------------------ 归一化工具 ------------------------------ */

const EMPTY_ALBUM: AlbumRef = { id: 0, name: '', picUrl: '' }

/** 数字兜底 */
export function num(v: unknown, def = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : def
}

/** 字符串兜底 */
export function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : def
}

/** 封面 URL 统一补 `?param=`（仅对 music.126.net 生效，已是 param 形式则替换） */
export function withPicSize(url: string, size = 300): string {
  const u = str(url)
  if (!u) return ''
  if (!/music\.126\.net/.test(u)) return u
  const cleaned = u.split('?')[0]
  return `${cleaned}?param=${size}y${size}`
}

/** 统一为 https（网易云大量返回 http://p1.music.126.net/...） */
function httpsUrl(url: string): string {
  const u = str(url)
  if (!u) return ''
  if (u.startsWith('http://')) return 'https://' + u.slice(7)
  if (u.startsWith('//')) return 'https:' + u
  return u
}

function normArtist(a: RawArtist | undefined): ArtistRef {
  return { id: num(a?.id), name: str(a?.name) }
}

function normAlbum(a: RawAlbum | undefined): AlbumRef {
  const url = httpsUrl(str(a?.picUrl) || str(a?.blurPicUrl))
  const picId = num(a?.picId) || num(a?.pic)
  return {
    id: num(a?.id),
    name: str(a?.name),
    picUrl: url,
    picId: picId || undefined
  }
}

/**
 * picId → 封面 URL 的最后手段。
 * 网易云图片 CDN 的 URL 形如 https://p1.music.126.net/<hash>/<picId>.jpg，
 * 其中 hash 无法从 picId 反推，这里返回一个约定占位（不保证 200），
 * 真正的封面优先来自 playlist/album 的 picUrl 或 mirror 搜索接口。
 */
export function picIdToPicUrl(picId: number): string {
  if (!picId) return ''
  return `https://p1.music.126.net/${picId}-nt.jpg?param=300y300`
}

/** 网易云原始歌曲 → 统一 Song */
export function normalizeSong(s: RawSong | null | undefined): Song | null {
  if (!s || s.id === undefined) return null
  const artistsRaw = (Array.isArray(s.artists) ? s.artists : s.ar) ?? []
  const artists = artistsRaw.map(normArtist).filter(a => a.name || a.id)
  const albumRaw = s.album ?? s.al
  const album = normAlbum(albumRaw)
  const duration = num(s.duration) || num(s.dt)
  const alia = Array.isArray(s.alias) ? s.alias : Array.isArray(s.alia) ? s.alia : []
  const artistText = artists.map(a => a.name).filter(Boolean).join(' / ')
  return {
    id: num(s.id),
    name: str(s.name, '未知歌曲'),
    artists: artists.length ? artists : [{ id: 0, name: '未知歌手' }],
    album,
    duration,
    fee: num(s.fee),
    picUrl: album.picUrl,
    alia,
    albumName: album.name,
    artistText: artistText || '未知歌手'
  }
}

function normalizeSongs(list: unknown): Song[] {
  if (!Array.isArray(list)) return []
  const out: Song[] = []
  for (const raw of list) {
    const s = normalizeSong(raw as RawSong)
    if (s) out.push(s)
  }
  return out
}

function normalizeArtistFull(a: RawArtist | null | undefined): Artist | null {
  if (!a || a.id === undefined) return null
  return {
    id: num(a.id),
    name: str(a.name, '未知歌手'),
    picUrl: httpsUrl(str(a.picUrl) || str(a.img1v1Url)),
    briefDesc: str(a.briefDesc),
    albumSize: num(a.albumSize),
    musicSize: num(a.musicSize),
    alias: Array.isArray(a.alias) ? a.alias : [],
    source: 'official'
  }
}

function normalizeAlbumFull(a: RawAlbum | null | undefined, songs?: unknown): Album | null {
  if (!a || a.id === undefined) return null
  const artist = (Array.isArray(a.artists) ? a.artists[0] : a.artist) as RawArtist | undefined
  return {
    id: num(a.id),
    name: str(a.name, '未知专辑'),
    picUrl: httpsUrl(str(a.picUrl) || str(a.blurPicUrl)),
    artist: normArtist(artist),
    publishTime: num(a.publishTime),
    description: str(a.description),
    size: num(a.size),
    company: str(a.company),
    songs: songs === undefined ? undefined : normalizeSongs(songs),
    source: 'official'
  }
}

function normalizePlaylist(p: RawPlaylist | null | undefined): Playlist | null {
  if (!p || p.id === undefined) return null
  return {
    id: num(p.id),
    name: str(p.name, '未命名歌单'),
    coverImgUrl: httpsUrl(str(p.coverImgUrl)),
    description: str(p.description),
    creator: {
      id: num(p.creator?.userId),
      nickname: str(p.creator?.nickname, '网易云音乐'),
      avatarUrl: httpsUrl(str(p.creator?.avatarUrl))
    },
    trackCount: num(p.trackCount) || (Array.isArray(p.tracks) ? p.tracks.length : 0),
    playCount: num(p.playCount),
    updateTime: num(p.updateTime),
    createTime: num(p.createTime),
    tracks: normalizeSongs(p.tracks),
    tags: Array.isArray(p.tags) ? p.tags : [],
    isToplist: !!p.ToplistType,
    updateFrequency: str(p.updateFrequency),
    source: 'official'
  }
}

/* ------------------------------ 原始请求（官方） ------------------------------ */

/** 搜索原始 JSON：type 1=单曲 100=歌手 10=专辑 1000=歌单 */
export async function rawSearch(kw: string, type: 1 | 10 | 100 | 1000, limit = 30, offset = 0): Promise<unknown> {
  const url =
    `${BASE}/api/search/get/web?s=${encodeURIComponent(kw)}` +
    `&type=${type}&limit=${Math.max(1, Math.min(limit, 100))}&offset=${Math.max(0, offset)}`
  return getJson(url, { headers: OFFICIAL_HEADERS, timeout: 8000, retries: 1, ttl: 30 * 60_000, persist: true })
}

/** 歌单详情原始 JSON（老接口，返回 result.tracks） */
export async function rawPlaylistDetail(id: number): Promise<unknown> {
  return getJson(`${BASE}/api/playlist/detail?id=${id}`, {
    headers: OFFICIAL_HEADERS,
    timeout: 12_000,
    retries: 0,
    ttl: 10 * 60_000,
    persist: false // 200 首歌曲体积较大，只放内存 LRU
  })
}

/** 榜单列表原始 JSON */
export async function rawToplist(): Promise<unknown> {
  return getJson(`${BASE}/api/toplist/detail`, {
    headers: OFFICIAL_HEADERS,
    timeout: 10_000,
    ttl: 10 * 60_000,
    persist: true
  })
}

/** 歌手详情原始 JSON（artist + hotSongs） */
export async function rawArtist(id: number): Promise<unknown> {
  return getJson(`${BASE}/api/artist/${id}`, {
    headers: OFFICIAL_HEADERS,
    timeout: 10_000,
    ttl: 10 * 60_000,
    persist: false
  })
}

/** 歌手专辑原始 JSON */
export async function rawArtistAlbums(id: number, limit = 24, offset = 0): Promise<unknown> {
  return getJson(`${BASE}/api/artist/albums/${id}?limit=${limit}&offset=${offset}`, {
    headers: OFFICIAL_HEADERS,
    timeout: 10_000,
    ttl: 10 * 60_000,
    persist: true
  })
}

/** 专辑详情原始 JSON（v1 接口可用） */
export async function rawAlbumV1(id: number): Promise<unknown> {
  return getJson(`${BASE}/api/v1/album/${id}`, {
    headers: OFFICIAL_HEADERS,
    timeout: 10_000,
    ttl: 10 * 60_000,
    persist: false
  })
}

/** 推荐歌单原始 JSON */
export async function rawPersonalized(limit = 12): Promise<unknown> {
  return getJson(`${BASE}/api/personalized/playlist?limit=${Math.max(1, Math.min(limit, 50))}`, {
    headers: OFFICIAL_HEADERS,
    timeout: 8000,
    ttl: 10 * 60_000,
    persist: true
  })
}

/** 推荐新歌原始 JSON */
export async function rawNewSong(limit = 20): Promise<unknown> {
  return getJson(`${BASE}/api/personalized/newsong?limit=${Math.max(1, Math.min(limit, 50))}&type=recommend`, {
    headers: OFFICIAL_HEADERS,
    timeout: 8000,
    ttl: 10 * 60_000,
    persist: true
  })
}

/** 歌词原始 JSON */
export async function rawLyric(id: number): Promise<unknown> {
  return getJson(`${BASE}/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`, {
    headers: OFFICIAL_HEADERS,
    timeout: 8000,
    ttl: 60 * 60_000,
    persist: true
  })
}

/* ------------------------------ 归一化后的对外函数（官方单源） ------------------------------ */

export async function officialSearchSongs(kw: string, limit = 30, offset = 0): Promise<Song[]> {
  const raw = (await rawSearch(kw, 1, limit, offset)) as { result?: { songs?: unknown } } | null
  return normalizeSongs(raw?.result?.songs)
}

export async function officialSearchArtists(kw: string, limit = 20): Promise<Artist[]> {
  const raw = (await rawSearch(kw, 100, limit)) as { result?: { artists?: unknown } } | null
  const list = Array.isArray(raw?.result?.artists) ? raw.result.artists : []
  return list.map(a => normalizeArtistFull(a as RawArtist)).filter((a): a is Artist => !!a)
}

export async function officialSearchAlbums(kw: string, limit = 20): Promise<Album[]> {
  const raw = (await rawSearch(kw, 10, limit)) as { result?: { albums?: unknown } } | null
  const list = Array.isArray(raw?.result?.albums) ? raw.result.albums : []
  return list
    .map(a => {
      const album = normalizeAlbumFull(a as RawAlbum)
      if (album && !album.picUrl) {
        const r = a as RawAlbum
        album.picUrl = httpsUrl(str(r.blurPicUrl) || str(r.picUrl))
      }
      return album
    })
    .filter((a): a is Album => !!a)
}

export async function officialSearchPlaylists(kw: string, limit = 20): Promise<Playlist[]> {
  const raw = (await rawSearch(kw, 1000, limit)) as { result?: { playlists?: unknown } } | null
  const list = Array.isArray(raw?.result?.playlists) ? raw.result.playlists : []
  return list
    .map(p => {
      const pl = normalizePlaylist(p as RawPlaylist)
      if (pl && !pl.coverImgUrl) pl.coverImgUrl = httpsUrl(str((p as { coverImgUrl?: string }).coverImgUrl))
      return pl
    })
    .filter((p): p is Playlist => !!p)
}

/** 歌单详情（官方老接口） */
export async function officialPlaylist(id: number): Promise<Playlist | null> {
  const raw = (await rawPlaylistDetail(id)) as { result?: RawPlaylist } | null
  if (!raw?.result) return null
  return normalizePlaylist(raw.result)
}

/** 榜单列表（官方 /api/toplist/detail） */
export async function officialToplist(): Promise<ChartSummary[]> {
  const raw = (await rawToplist()) as { list?: unknown } | null
  const list = Array.isArray(raw?.list) ? (raw!.list as RawPlaylist[]) : []
  return list.map(p => ({
    id: num(p.id),
    name: str(p.name),
    coverImgUrl: httpsUrl(str(p.coverImgUrl)),
    updateFrequency: str(p.updateFrequency),
    trackCount: num(p.trackCount),
    playCount: num(p.playCount)
  }))
}

/** 歌手详情（官方 /api/artist/<id>） */
export async function officialArtist(id: number): Promise<Artist | null> {
  const raw = (await rawArtist(id)) as { artist?: RawArtist; hotSongs?: unknown } | null
  const artist = normalizeArtistFull(raw?.artist)
  if (!artist) return null
  artist.hotSongs = normalizeSongs(raw?.hotSongs)
  const albums = await officialArtistAlbums(id, 12)
  if (albums.length) artist.albums = albums
  return artist
}

/** 歌手专辑列表 */
export async function officialArtistAlbums(id: number, limit = 24): Promise<Album[]> {
  const raw = (await rawArtistAlbums(id, limit)) as { hotAlbums?: unknown } | null
  const list = Array.isArray(raw?.hotAlbums) ? raw.hotAlbums : []
  return list.map(a => normalizeAlbumFull(a as RawAlbum)).filter((a): a is Album => !!a)
}

/** 专辑详情（官方 v1 接口） */
export async function officialAlbum(id: number): Promise<Album | null> {
  const raw = (await rawAlbumV1(id)) as { album?: RawAlbum; songs?: unknown } | null
  if (!raw) return null
  const album = normalizeAlbumFull(raw.album, raw.songs)
  if (!album) return null
  if (raw.songs && (!album.size || album.size === 0)) album.size = (album.songs ?? []).length
  return album
}

/** 推荐歌单（官方 personalized） */
export async function officialRecommend(limit = 12): Promise<RecommendPlaylist[]> {
  const raw = (await rawPersonalized(limit)) as { result?: unknown } | null
  const list = Array.isArray(raw?.result) ? raw.result : []
  return list.map(r => {
    const p = r as {
      id?: number
      name?: string
      picUrl?: string
      coverImgUrl?: string
      copywriter?: string
      playCount?: number
      trackCount?: number
    }
    const pl: RecommendPlaylist = {
      id: num(p.id),
      name: str(p.name),
      coverImgUrl: httpsUrl(str(p.picUrl) || str(p.coverImgUrl)),
      description: str(p.copywriter),
      creator: { id: 0, nickname: '网易云音乐', avatarUrl: '' },
      trackCount: num(p.trackCount),
      playCount: num(p.playCount),
      updateTime: 0,
      tracks: [],
      copywriter: str(p.copywriter),
      source: 'official'
    }
    return pl
  })
}

/** 推荐新歌（官方 personalized/newsong） */
export async function officialNewSongs(limit = 20): Promise<Song[]> {
  const raw = (await rawNewSong(limit)) as { result?: unknown } | null
  const list = Array.isArray(raw?.result) ? raw.result : []
  const songs: Song[] = []
  for (const r of list) {
    const item = r as { song?: RawSong; picUrl?: string; id?: number; name?: string; type?: number }
    // type 4 为歌曲；其它（如电台节目）跳过
    if (item.type !== undefined && item.type !== 4) continue
    const song = normalizeSong(item.song)
    if (song) {
      if (!song.picUrl && item.picUrl) {
        song.picUrl = httpsUrl(item.picUrl)
        song.album.picUrl = song.picUrl
      }
      songs.push(song)
    }
  }
  return songs
}

/* ------------------------------ LRC 解析 ------------------------------ */

const LRC_LINE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** 解析单行时间标签，返回毫秒 */
function tagToMs(min: string, sec: string, frac?: string): number {
  const m = num(min)
  const s = num(sec)
  let ms = 0
  if (frac) {
    // "5" → 500ms, "05" → 50ms... 按小数位补齐到毫秒
    ms = num(frac) * Math.pow(10, 3 - frac.length)
  }
  return m * 60_000 + s * 1000 + Math.round(ms)
}

/**
 * 解析 LRC 文本为行数组（支持一行多时间标签、[offset:±ms] 偏移）。
 * 传 translation 时按时间就近合并为双语。
 */
export function parseLrc(lrcText: string, translationText = ''): LyricLine[] {
  const lines: LyricLine[] = []
  const text = str(lrcText)
  if (!text) return lines

  let offset = 0
  const offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i)
  if (offsetMatch) offset = num(offsetMatch[1])

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('[offset:') || line.startsWith('[ti:') || line.startsWith('[ar:') || line.startsWith('[al:') || line.startsWith('[by:')) {
      continue
    }
    LRC_LINE.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    while ((m = LRC_LINE.exec(line)) !== null) {
      stamps.push(tagToMs(m[1], m[2], m[3]))
    }
    if (!stamps.length) continue
    const content = line.replace(LRC_LINE, '').trim()
    if (!content) continue
    for (const t of stamps) lines.push({ time: Math.max(0, t + offset), text: content })
  }

  lines.sort((a, b) => a.time - b.time)

  if (translationText) {
    const trs = new Map<number, string>()
    for (const line of parseLrc(translationText)) {
      // 译文时间可能略有偏差，统一用 key（大多数情况完全一致）
      trs.set(line.time, line.text)
    }
    if (trs.size) {
      for (const line of lines) {
        const tr = trs.get(line.time)
        if (tr && tr !== line.text) line.translation = tr
      }
    }
  }
  return lines
}

/** 歌词（官方）；纯音乐返回 instrumental=true、空 lines */
export async function officialLyrics(id: number): Promise<Lyrics | null> {
  const raw = (await rawLyric(id)) as {
    lrc?: { lyric?: string }
    tlyric?: { lyric?: string }
    nolyric?: boolean
    uncollected?: boolean
  } | null
  if (!raw) return null
  const lrc = str(raw.lrc?.lyric)
  const tlyric = str(raw.tlyric?.lyric)
  if (!lrc) {
    return { id, lrc: '', tlyric, lines: [], instrumental: !!(raw.nolyric || raw.uncollected) }
  }
  return { id, lrc, tlyric, lines: parseLrc(lrc, tlyric), instrumental: false }
}

/** 按时间（毫秒）查找当前歌词行下标，找不到返回 -1 */
export function findLyricIndex(lines: LyricLine[], timeMs: number): number {
  if (!lines.length) return -1
  if (timeMs < lines[0].time) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= timeMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
