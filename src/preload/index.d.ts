/**
 * window.nt 接口契约 —— 渲染层（React）唯一可用的原生能力入口。
 * 由 src/preload/index.ts 通过 contextBridge 暴露；T2 在主进程实现对应 handler。
 *
 * 注意：本文件只放类型，不做任何运行时引用，renderer 里可直接 `import type { NtApi } from '@preload'`
 * （也可以直接使用全局的 window.nt）。
 */
import type {
  AuthSession,
  CookieLoginResult,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  MyPlaylistsResult,
  QrCreateResult,
  QrPollResult,
  MediaKeyAction,
  MprisCommand,
  MprisState,
  Settings,
  TrayAction,
  Unsubscribe,
  WindowMode,
  WindowState,
  WinAction
} from '@shared/types'

export type {
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  MediaKeyAction,
  MprisCommand,
  MprisState,
  Settings,
  TrayAction,
  Unsubscribe,
  WindowMode,
  WindowState,
  WinAction
}

export interface NtApi {
  readonly platform: 'linux'
  readonly versions: { app: string; electron: string; chrome: string }

  /** 普通窗口 <-> 迷你播放器窗口 */
  setWindowMode(mode: WindowMode): void
  /** 订阅窗口模式变化，返回取消订阅函数 */
  onWindowMode(cb: (mode: WindowMode) => void): Unsubscribe
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onWindowState(cb: (s: WindowState) => void): Unsubscribe
  /** 窗口操作（无边框窗口的自定义标题栏用） */
  winAction(a: WinAction): void
  /** 查询当前窗口状态 */
  winGetState(): Promise<WindowState>

  /** 读取设置（带默认值合并） */
  getSettings(): Promise<Settings>
  /** 局部更新设置，返回合并后的完整设置 */
  setSettings(p: Partial<Settings>): Promise<Settings>
  /** 选择下载目录 */
  pickFolder(): Promise<string | null>

  /** 下载一首歌到本地，返回保存路径 */
  download(p: DownloadRequest): Promise<DownloadResult>
  /** 取消正在进行的下载 */
  cancelDownload(id: string): void
  /** 订阅下载进度，返回取消订阅函数 */
  onDownloadProgress(cb: (p: DownloadProgress) => void): Unsubscribe

  /** 用系统浏览器打开外链 */
  openExternal(url: string): void

  /** 媒体键（X11 MPRIS/键盘媒体键转发） */
  onMediaKey(cb: (k: MediaKeyAction) => void): Unsubscribe

  /** 托盘 tooltip */
  setTrayTip(tip: string): void
  /** 托盘/任务栏进度，null 表示清除 */
  setTrayProgress(v: number | null): void

  /** 播放状态同步到 MPRIS（D-Bus） */
  mprisUpdate(s: MprisState): void
  /** 订阅来自 MPRIS 控制端的指令 */
  onMprisCmd(cb: (c: MprisCommand) => void): Unsubscribe

  /** 托盘菜单点击 */
  onTrayAction(cb: (a: TrayAction) => void): Unsubscribe

  /** 深链接（netease-cloud-music://song/123） */
  onDeepLink(cb: (url: string) => void): Unsubscribe

  /** 清理缓存（可选实现） */
  clearCache?(): Promise<void>

  /* ---------------------------- 账号登录 ---------------------------- */

  /** 读取当前登录态（基于会话 cookie） */
  authGetSession(): Promise<AuthSession>

  /** 申请二维码登录：返回 unikey 与二维码内容（渲染层自行生成二维码图片） */
  authQrCreate(): Promise<QrCreateResult>

  /** 轮询扫码状态（800 过期 / 801 等待 / 802 待确认 / 803 成功） */
  authQrPoll(unikey: string): Promise<QrPollResult>

  /** 用浏览器复制的 cookie 字符串登录（兜底方案） */
  authLoginWithCookie(cookie: string): Promise<CookieLoginResult>

  /** authLoginWithCookie 的别名（UI 契约使用该名称） */
  authSetCookie(cookie: string): Promise<CookieLoginResult>

  /** 退出登录（清空登录 cookie） */
  authLogout(): Promise<void>

  /** 我的歌单：自建 + 收藏 */
  authMyPlaylists(): Promise<MyPlaylistsResult>

  /** 登录态变化订阅 */
  onAuthChanged(cb: (s: AuthSession) => void): Unsubscribe
}

/** 供 preload 实现使用：declare global 块内无法直接 import 此类型 */
export type { NtApi as default }

declare global {
  interface Window {
    nt: NtApi
  }
}
