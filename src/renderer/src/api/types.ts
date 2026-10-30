/**
 * 统一数据模型（UI 消费的唯一类型定义）
 *
 * 设计原则：
 *  - 所有字段都来自"归一化"后的对象，UI 不需要再判断网易云原始结构（songs/ar/al vs artists/album）。
 *  - 可选字段一律带兜底（音源缺失时 duration/picUrl 可能为空字符串），UI 用可选链读取即可。
 *  - 时间单位统一用 **毫秒**（duration / progress / seek）。
 */

/** 歌手精简信息 */
export interface ArtistRef {
  id: number
  name: string
}

/** 专辑精简信息 */
export interface AlbumRef {
  id: number
  name: string
  /** 封面原图 URL（可能为空串，UI 负责渲染占位） */
  picUrl: string
  /** 原始 picId（官方搜索只给这个；可用 meting pic 接口转成真实图片） */
  picId?: number
}

/**
 * 歌曲（UI / 播放队列元素）
 * 兼容任务描述中的 Song{id,name,artists,album.pic,duration,fee}，
 * 额外保留 picUrl / picId / alia / lyrics 等便利字段。
 */
export interface Song {
  id: number
  name: string
  artists: ArtistRef[]
  album: AlbumRef
  /** 时长，毫秒 */
  duration: number
  /** 网易云计费位：0 免费 / 1 VIP / 4 付费专辑 / 8 低音质免费 等 */
  fee: number
  /** 封面（等价于 album.picUrl，便于列表直接用） */
  picUrl: string
  /** 原始 picId（无 picUrl 时可用于尝试拼装） */
  picId?: number
  /** 副标题/别名 */
  alia?: string[]
  /** 专辑名冗余，方便列表直接渲染 */
  albumName?: string
  /** 歌手名拼接（'A / B'） */
  artistText?: string
  /** 是否已缓存音频（播放引擎回填，UI 可显示"已缓存"） */
  cached?: boolean
}

/** 歌单/榜单详情 */
export interface Playlist {
  id: number
  name: string
  coverImgUrl: string
  description: string
  creator: {
    id: number
    nickname: string
    avatarUrl: string
  }
  trackCount: number
  playCount: number
  /** 更新时间，毫秒时间戳 */
  updateTime: number
  /** 创建时间，毫秒 */
  createTime?: number
  tracks: Song[]
  /** 标签 */
  tags?: string[]
  /** 是否榜单（ToplistType 非空） */
  isToplist?: boolean
  /** 榜单更新频率描述，如"刚刚更新" */
  updateFrequency?: string
  /** 推荐文案（推荐歌单用，UI 卡片副标题） */
  copywriter?: string
  /** 数据来源（诊断用） */
  source?: DataSource
}

export interface Artist {
  id: number
  name: string
  /** 头像 */
  picUrl: string
  briefDesc: string
  albumSize: number
  musicSize?: number
  alias?: string[]
  /** 热门歌曲 */
  hotSongs?: Song[]
  /** 部分专辑 */
  albums?: Album[]
  /** 数据来源 */
  source?: DataSource
}

export interface Album {
  id: number
  name: string
  picUrl: string
  artist: ArtistRef
  /** 发行时间，毫秒 */
  publishTime: number
  description: string
  /** 收录曲目数 */
  size: number
  songs?: Song[]
  company?: string
  source?: DataSource
}

/** 一行歌词 */
export interface LyricLine {
  /** 行起始时间，毫秒 */
  time: number
  /** 原文 */
  text: string
  /** 译文（tlyric），没有则空串 */
  translation?: string
}

export interface Lyrics {
  /** 歌曲 id */
  id: number
  /** 原文 LRC 文本 */
  lrc: string
  /** 译文 LRC 文本（可能为空串） */
  tlyric: string
  /** 逐行解析结果（已按时间排序，含双语） */
  lines: LyricLine[]
  /** 是否纯音乐（无歌词） */
  instrumental?: boolean
}

/** 播放模式（与 store/player.ts 的 PlayMode 一致） */
export type PlayMode = 'order' | 'repeat-one' | 'shuffle' | 'loop'

/** 搜索类型 */
export type SearchType = 'song' | 'artist' | 'album' | 'playlist'

/** 搜索聚合结果 */
export interface SearchResult {
  songs: Song[]
  artists: Artist[]
  albums: Album[]
  playlists: Playlist[]
  /** 关键词 */
  keyword: string
  /** 各类型总数（网易云只返回有限数量） */
  counts?: Partial<Record<SearchType, number>>
}

/** 榜单条目（列表页用的精简结构） */
export interface ChartSummary {
  id: number
  name: string
  coverImgUrl: string
  /** 更新时间描述，如"刚刚更新" */
  updateFrequency: string
  trackCount: number
  playCount?: number
}

/** 推荐歌单（首页网格） */
export interface RecommendPlaylist extends Playlist {
  /** 推荐文案 */
  copywriter?: string
}

/** 排行榜 id 常量（实测自 /api/toplist/detail） */
export const CHART_IDS = {
  /** 飙升榜 */
  rising: 19723756,
  /** 新歌榜 */
  newSong: 3779629,
  /** 原创榜 */
  original: 2884035,
  /** 热歌榜 */
  hot: 3778678,
  /** 网易云古典榜 */
  classical: 71384707,
  /** 网易云电音榜 */
  electronic: 1978921795,
  /** 网易云中文说唱榜 */
  hiphop: 991319590,
  /** 潮流风向榜 */
  trendy: 13372522766
} as const

/** 数据来源标识 */
export type DataSource = 'official' | 'gdstudio' | 'meting' | 'cache' | 'demo' | 'fallback'

/** 音频直链查询结果 */
export interface AudioUrl {
  /** 直链（可能为空串） */
  url: string
  /** 码率（bps），128000 / 320000 */
  br: number
  /** 文件大小（字节） */
  size: number
  /** 来源 */
  source: DataSource
  /** 文件格式推测 */
  format: 'mp3' | 'flac' | 'unknown'
  /** 过期时间（毫秒时间戳，0 表示未知） */
  expiresAt?: number
  /** 为 true 时表示"无可用音源"，播放引擎应进入演示模式 */
  unavailable?: boolean
}
