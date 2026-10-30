/**
 * 登录 / 账号相关类型（UI 侧定义）
 *
 * 后端 IPC 由 desktop 实现；契约（lead 裁定）：
 *   window.nt.authGetSession(): Promise<AuthSession>
 *   window.nt.authQrCreate(): Promise<{ unikey: string; qrDataUrl: string }>
 *   window.nt.authQrPoll(unikey): Promise<AuthQrPollResult>
 *   window.nt.authSetCookie(cookie): Promise<AuthCookieResult>
 *   window.nt.authLogout(): Promise<void>
 *   window.nt.authMyPlaylists(): Promise<{ created: Playlist[]; subscribed: Playlist[] }>
 *   window.nt.onAuthChanged(cb): () => void
 *
 * 若 desktop 之后把它们正式写进 @shared/types 与本文件冲突，以 @shared/types 为准（届时改用其类型即可）。
 */
import type { Playlist } from '@/api/types'

/** 登录用户 */
export interface AuthUser {
  id: number
  nickname: string
  avatarUrl: string
  /** 0 普通 / 10 VIP / 11 音乐包 等（网易云 vipType） */
  vipType?: number
  signature?: string
}

/** 登录态 */
export interface AuthSession {
  loggedIn: boolean
  user?: AuthUser
  error?: string
}

/** 二维码创建结果 */
export interface AuthQrResult {
  unikey: string
  /** 二维码图片 dataURL（可直接放 <img src>） */
  qrDataUrl: string
}

/** 二维码轮询状态：800 过期 / 801 等待扫码 / 802 待确认 / 803 成功 */
export type AuthQrStatus = 800 | 801 | 802 | 803

export interface AuthQrPollResult {
  status: AuthQrStatus
  message: string
  user?: AuthUser
}

/** Cookie 登录结果 */
export interface AuthCookieResult {
  ok: boolean
  user?: AuthUser
  error?: string
}

/** 我的歌单 */
export interface AuthMyPlaylists {
  created: Playlist[]
  subscribed: Playlist[]
}

/** 登录后可能用到的统一事件载荷 */
export interface AuthChangedEvent {
  loggedIn: boolean
  user?: AuthUser
}

/** 二维码状态 → 中文文案 */
export const QR_STATUS_TEXT: Record<AuthQrStatus, string> = {
  800: '二维码已过期，点击刷新',
  801: '请使用网易云音乐 App 扫码',
  802: '扫描成功，请在手机上确认登录',
  803: '登录成功'
}
