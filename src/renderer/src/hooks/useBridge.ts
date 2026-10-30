/**
 * window.nt（preload 暴露的 NtApi）安全封装
 *
 * 所有调用都做可选链 + 类型守卫保护：在纯浏览器环境（无 preload）下
 * 退化为 no-op / 本地降级，不会抛错。渲染层所有原生能力都从这里走。
 */
import type { WindowMode, WinAction } from '@shared/types'
import type {
  AuthCookieResult,
  AuthMyPlaylists,
  AuthQrPollResult,
  AuthQrResult,
  AuthSession
} from '@/store/authTypes'

export type { WindowMode, WinAction }

export type WindowStateInfo = { maximized: boolean }

type Unsub = () => void

interface BridgeLike {
  setWindowMode?: (mode: WindowMode) => void
  onWindowMode?: (cb: (mode: WindowMode) => void) => Unsub
  onWindowState?: (cb: (s: WindowStateInfo) => void) => Unsub
  winAction?: (a: WinAction) => void
  winGetState?: () => Promise<WindowStateInfo>
  getSettings?: () => Promise<Record<string, unknown>>
  setSettings?: (p: Record<string, unknown>) => Promise<Record<string, unknown>>
  pickFolder?: () => Promise<string | null>
  openExternal?: (url: string) => void
  setTrayTip?: (tip: string) => void
  setTrayProgress?: (v: number | null) => void
  mprisUpdate?: (s: Record<string, unknown>) => void
  clearCache?: () => Promise<void>
  platform?: string
  versions?: { app: string; electron: string; chrome: string }

  /* —— 账号 / 登录（desktop 提供；未落地时 UI 走降级提示） —— */
  authGetSession?: () => Promise<AuthSession>
  authQrCreate?: () => Promise<AuthQrResult>
  authQrPoll?: (unikey: string) => Promise<AuthQrPollResult>
  authSetCookie?: (cookie: string) => Promise<AuthCookieResult>
  authLogout?: () => Promise<void>
  authMyPlaylists?: () => Promise<AuthMyPlaylists>
  onAuthChanged?: (cb: (s: { loggedIn: boolean; user?: AuthUserLike }) => void) => Unsub

  /* —— 下载（download/cancelDownload/onDownloadProgress） —— */
  download?: (p: DownloadRequestLike) => Promise<DownloadResultLike>
  cancelDownload?: (id: string) => void
  onDownloadProgress?: (cb: (p: DownloadProgressLike) => void) => Unsub
}

/** preload 里已有的下载类型（这里用宽松结构，避免强耦合） */
interface DownloadRequestLike {
  id: string
  url: string
  filename: string
}
interface DownloadResultLike {
  ok: boolean
  path?: string
  error?: string
}
interface DownloadProgressLike {
  id: string
  received: number
  total: number
}
interface AuthUserLike {
  id: number
  nickname: string
  avatarUrl: string
  vipType?: number
  signature?: string
}

/** 获取桥接对象（浏览器中为 undefined） */
export function bridge(): BridgeLike | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return (window.nt as unknown as BridgeLike | undefined) ?? undefined
  } catch {
    return undefined
  }
}

export const isElectron = (): boolean => !!bridge()

function call(fn: (() => void) | undefined): void {
  if (typeof fn !== 'function') return
  try {
    fn()
  } catch (err) {
    console.warn('[nt] bridge call failed', err)
  }
}

/* ------------------------------ 窗口操作 ------------------------------ */

export function winAction(action: WinAction): void {
  const b = bridge()
  if (typeof b?.winAction === 'function') {
    try {
      b.winAction(action)
      return
    } catch (err) {
      console.warn('[nt] winAction failed', err)
    }
  }
  console.info('[nt] winAction（浏览器环境，忽略）:', action)
}

export function setWindowMode(mode: WindowMode): void {
  const b = bridge()
  if (typeof b?.setWindowMode === 'function') {
    try {
      b.setWindowMode(mode)
      return
    } catch (err) {
      console.warn('[nt] setWindowMode failed', err)
    }
  }
  console.info('[nt] setWindowMode（浏览器环境，忽略）:', mode)
}

export async function winGetState(): Promise<WindowStateInfo> {
  const b = bridge()
  if (typeof b?.winGetState !== 'function') return { maximized: false }
  try {
    const s = await b.winGetState()
    return { maximized: !!s?.maximized }
  } catch {
    return { maximized: false }
  }
}

/** 订阅窗口模式变化；无桥接时返回空取消函数 */
export function onWindowMode(cb: (mode: WindowMode) => void): Unsub {
  const b = bridge()
  if (typeof b?.onWindowMode !== 'function') return () => {}
  try {
    const dispose = b.onWindowMode(cb)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

/** 订阅最大化状态；无桥接时返回空取消函数 */
export function onWindowState(cb: (s: WindowStateInfo) => void): Unsub {
  const b = bridge()
  if (typeof b?.onWindowState !== 'function') return () => {}
  try {
    const dispose = b.onWindowState(cb)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

/* ------------------------------ 系统能力 ------------------------------ */

export function openExternal(url: string): void {
  const b = bridge()
  if (typeof b?.openExternal === 'function') {
    try {
      b.openExternal(url)
      return
    } catch {
      /* fallthrough */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function pickFolder(): Promise<string | null> {
  const b = bridge()
  if (typeof b?.pickFolder !== 'function') return null
  try {
    const r = await b.pickFolder()
    return typeof r === 'string' ? r : null
  } catch {
    return null
  }
}

export async function clearCache(): Promise<boolean> {
  const b = bridge()
  if (typeof b?.clearCache !== 'function') return false
  try {
    await b.clearCache()
    return true
  } catch {
    return false
  }
}

export function setTrayTip(tip: string): void {
  const b = bridge()
  if (typeof b?.setTrayTip !== 'function') return
  call(() => b.setTrayTip!(tip))
}

export function setTrayProgress(v: number | null): void {
  const b = bridge()
  if (typeof b?.setTrayProgress !== 'function') return
  call(() => b.setTrayProgress!(v))
}

export const appVersion = (): string => bridge()?.versions?.app ?? '1.0.0'

/** 根据种子生成稳定的 CSS 渐变，用于封面加载失败时的占位 */
export function gradientFor(seed: string | number): string {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  const h2 = (h + 48) % 360
  return `linear-gradient(135deg, hsl(${h} 58% 42%), hsl(${h2} 62% 26%))`
}

/* ------------------------------------------------------------------ */
/* 账号 / 登录                                                          */
/* ------------------------------------------------------------------ */

/** 登录能力是否就绪（desktop 未落地时返回 false，UI 据此提示） */
export const authAvailable = (): boolean => typeof bridge()?.authGetSession === 'function'

/** 读取登录态；不可用时返回未登录 + 原因 */
export async function authGetSession(): Promise<AuthSession> {
  const b = bridge()
  if (typeof b?.authGetSession !== 'function') {
    return { loggedIn: false, error: '当前环境不支持账号登录' }
  }
  try {
    const s = await b.authGetSession()
    return s ?? { loggedIn: false }
  } catch (err) {
    return { loggedIn: false, error: err instanceof Error ? err.message : '读取登录态失败' }
  }
}

/** 创建扫码登录二维码 */
export async function authQrCreate(): Promise<AuthQrResult | null> {
  const b = bridge()
  if (typeof b?.authQrCreate !== 'function') return null
  try {
    return (await b.authQrCreate()) ?? null
  } catch (err) {
    console.warn('[nt] authQrCreate failed', err)
    return null
  }
}

/** 轮询二维码状态 */
export async function authQrPoll(unikey: string): Promise<AuthQrPollResult | null> {
  const b = bridge()
  if (typeof b?.authQrPoll !== 'function') return null
  try {
    return (await b.authQrPoll(unikey)) ?? null
  } catch (err) {
    console.warn('[nt] authQrPoll failed', err)
    return null
  }
}

/** Cookie 登录 */
export async function authSetCookie(cookie: string): Promise<AuthCookieResult> {
  const b = bridge()
  if (typeof b?.authSetCookie !== 'function') {
    return { ok: false, error: '当前环境不支持 Cookie 登录' }
  }
  try {
    return (await b.authSetCookie(cookie)) ?? { ok: false, error: '登录失败' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '登录失败' }
  }
}

/** 退出登录 */
export async function authLogout(): Promise<boolean> {
  const b = bridge()
  if (typeof b?.authLogout !== 'function') return false
  try {
    await b.authLogout()
    return true
  } catch (err) {
    console.warn('[nt] authLogout failed', err)
    return false
  }
}

/** 我的歌单（我创建 / 我收藏） */
export async function authMyPlaylists(): Promise<AuthMyPlaylists> {
  const b = bridge()
  if (typeof b?.authMyPlaylists !== 'function') return { created: [], subscribed: [] }
  try {
    const r = await b.authMyPlaylists()
    return {
      created: Array.isArray(r?.created) ? r.created : [],
      subscribed: Array.isArray(r?.subscribed) ? r.subscribed : []
    }
  } catch (err) {
    console.warn('[nt] authMyPlaylists failed', err)
    return { created: [], subscribed: [] }
  }
}

/** 订阅登录态变化 */
export function onAuthChanged(cb: (s: { loggedIn: boolean; user?: AuthUserLike }) => void): Unsub {
  const b = bridge()
  if (typeof b?.onAuthChanged !== 'function') return () => {}
  try {
    const dispose = b.onAuthChanged(cb)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

/* ------------------------------------------------------------------ */
/* 下载                                                                */
/* ------------------------------------------------------------------ */

export const downloadAvailable = (): boolean => typeof bridge()?.download === 'function'

/** 请求主进程下载一首歌 */
export async function downloadSong(req: DownloadRequestLike): Promise<DownloadResultLike> {
  const b = bridge()
  if (typeof b?.download !== 'function') {
    return { ok: false, error: '当前环境不支持下载' }
  }
  try {
    return (await b.download(req)) ?? { ok: false, error: '下载失败' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '下载失败' }
  }
}

/** 取消下载 */
export function cancelDownload(id: string): void {
  const b = bridge()
  if (typeof b?.cancelDownload !== 'function') return
  call(() => b.cancelDownload!(id))
}

/** 订阅下载进度 */
export function onDownloadProgress(cb: (p: DownloadProgressLike) => void): Unsub {
  const b = bridge()
  if (typeof b?.onDownloadProgress !== 'function') return () => {}
  try {
    const dispose = b.onDownloadProgress(cb)
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}

/** 把「歌手 - 歌名」变成安全的文件名 */
export function safeFilename(artist: string, name: string, ext = 'mp3'): string {
  const raw = `${artist} - ${name}`.trim() || '未命名'
  // 去掉文件系统非法字符
  const cleaned = raw.replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').slice(0, 120)
  return `${cleaned}.${ext}`
}

/* ------------------------------------------------------------------ */
/* 设置同步到主进程（closeToTray / volume / playMode）                   */
/* ------------------------------------------------------------------ */

/**
 * 把渲染层设置同步给主进程（主进程 MPRIS / 托盘需要真实状态）。
 * 主进程未实现或字段不被接受时静默忽略，不影响 UI。
 */
export async function syncSettings(patch: Record<string, unknown>): Promise<void> {
  const b = bridge()
  if (typeof b?.setSettings !== 'function') return
  try {
    await b.setSettings(patch)
  } catch (err) {
    console.warn('[nt] setSettings failed', err)
  }
}
