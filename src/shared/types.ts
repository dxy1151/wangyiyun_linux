/**
 * 跨进程共享类型（main / preload / renderer 三端共用）
 * renderer 通过别名 `@shared`（= src/shared）导入。
 */

export type WindowMode = 'normal' | 'mini'

export type WinAction = 'minimize' | 'maximize' | 'close'

export type MediaKeyAction = 'play-pause' | 'next' | 'prev' | 'stop'

export type TrayAction = 'play-pause' | 'next' | 'prev' | 'show' | 'quit'

export type MprisAction = 'play-pause' | 'next' | 'prev' | 'seek-to' | 'volume'

export type PlayMode = 'order' | 'repeat-one' | 'shuffle' | 'loop'

export type ThemeMode = 'dark' | 'light'

export interface Settings {
  theme: ThemeMode
  /** 0 ~ 1 */
  volume: number
  playMode: PlayMode
  downloadDir: string
  closeToTray: boolean
  cacheLimitMB: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  volume: 0.8,
  playMode: 'order',
  downloadDir: '',
  closeToTray: true,
  cacheLimitMB: 1024
}

export interface WindowState {
  maximized: boolean
}

export interface DownloadRequest {
  id: string
  url: string
  filename: string
}

export interface DownloadResult {
  ok: boolean
  path?: string
  error?: string
}

export interface DownloadProgress {
  id: string
  received: number
  total: number
}

export interface MprisCommand {
  action: MprisAction
  value?: number
}

/** MPRIS 播放状态同步载荷（main 侧用于更新 DBus 属性） */
export interface MprisState {
  playbackStatus?: 'Playing' | 'Paused' | 'Stopped'
  title?: string
  artist?: string
  album?: string
  /** 秒 */
  position?: number
  /** 秒 */
  duration?: number
  /** 0 ~ 1 */
  volume?: number
  /** 可循环的曲目数 */
  canGoNext?: boolean
  canGoPrevious?: boolean
  canPlay?: boolean
  canPause?: boolean
}

export type Unsubscribe = () => void

/* ------------------------------- 账号登录 ------------------------------- */

export interface AuthUser {
  id: number
  nickname: string
  avatarUrl: string
  /** 0 普通用户 / 10 音乐人 / 11 VIP 等，按网易云原值透传 */
  vipType: number
  signature?: string
}

export interface AuthSession {
  loggedIn: boolean
  user?: AuthUser
  error?: string
}

/** 二维码扫码状态：800 过期 / 801 等待扫码 / 802 待确认 / 803 成功 */
export interface QrPollResult {
  status: 800 | 801 | 802 | 803
  message: string
  user?: AuthUser
}

export interface QrCreateResult {
  unikey: string
  /** 二维码内容（渲染层据此生成二维码图片） */
  qrContent: string
}

export interface UserPlaylist {
  id: number
  name: string
  coverImgUrl: string
  trackCount: number
  playCount: number
  /** 是否为收藏（非自建）歌单 */
  subscribed: boolean
  creator: { id: number; nickname: string }
}

export interface MyPlaylistsResult {
  created: UserPlaylist[]
  subscribed: UserPlaylist[]
}

export interface CookieLoginResult {
  ok: boolean
  user?: AuthUser
  error?: string
}
