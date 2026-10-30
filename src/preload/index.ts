/**
 * Preload：通过 contextBridge 把受控的原生能力暴露为 window.nt。
 * 接口契约见 src/preload/index.d.ts 与 README「接口契约」小节。
 *
 * 约定：
 *  - 所有 onXxx(cb) 返回取消订阅函数（不要忘了在 useEffect cleanup 里调用）。
 *  - 所有 send 通道在渲染层不可伪造（contextIsolation: true, nodeIntegration: false）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENT } from '@shared/ipc'
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
import type { NtApi } from './index.d'

type IpcListener = (event: Electron.IpcRendererEvent, ...args: any[]) => void

/** 订阅主进程事件并返回取消订阅函数 */
function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener: IpcListener = (_e, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const nt: NtApi = {
  platform: 'linux',
  versions: {
    app: process.env.APP_VERSION ?? '1.0.0',
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? ''
  },

  // ---- 窗口 ----
  setWindowMode: (mode: WindowMode) => ipcRenderer.send(IPC.WIN_SET_MODE, mode),
  onWindowMode: (cb: (mode: WindowMode) => void) => subscribe<WindowMode>(IPC_EVENT.WINDOW_MODE, cb),
  onWindowState: (cb: (s: WindowState) => void) => subscribe<WindowState>(IPC_EVENT.WIN_STATE_CHANGED, cb),
  winAction: (a: WinAction) => ipcRenderer.send(IPC.WIN_ACTION, a),
  winGetState: () => ipcRenderer.invoke(IPC.WIN_GET_STATE) as Promise<WindowState>,

  // ---- 设置 ----
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<Settings>,
  setSettings: (p: Partial<Settings>) => ipcRenderer.invoke(IPC.SETTINGS_SET, p) as Promise<Settings>,
  pickFolder: () => ipcRenderer.invoke(IPC.DIALOG_PICK_FOLDER) as Promise<string | null>,

  // ---- 下载 ----
  download: (p: DownloadRequest) => ipcRenderer.invoke(IPC.DOWNLOAD_SAVE, p) as Promise<DownloadResult>,
  cancelDownload: (id: string) => ipcRenderer.send(IPC.DOWNLOAD_CANCEL, id),
  onDownloadProgress: (cb: (p: DownloadProgress) => void) =>
    subscribe<DownloadProgress>(IPC_EVENT.DOWNLOAD_PROGRESS, cb),

  // ---- 系统 ----
  openExternal: (url: string) => ipcRenderer.send(IPC.SHELL_OPEN, url),

  // ---- 媒体键 ----
  onMediaKey: (cb: (k: MediaKeyAction) => void) => subscribe<MediaKeyAction>(IPC_EVENT.MEDIA_KEY, cb),

  // ---- 托盘 ----
  setTrayTip: (tip: string) => ipcRenderer.send(IPC.TRAY_TIP, tip),
  setTrayProgress: (v: number | null) => ipcRenderer.send(IPC.TRAY_PROGRESS, v),
  onTrayAction: (cb: (a: TrayAction) => void) => subscribe<TrayAction>(IPC_EVENT.TRAY_ACTION, cb),

  // ---- MPRIS ----
  mprisUpdate: (s: MprisState) => ipcRenderer.send(IPC.MPRIS_UPDATE, s),
  onMprisCmd: (cb: (c: MprisCommand) => void) => subscribe<MprisCommand>(IPC_EVENT.MPRIS_CMD, cb),

  // ---- 深链接 ----
  onDeepLink: (cb: (url: string) => void) => subscribe<string>(IPC_EVENT.DEEP_LINK, cb),

  // ---- 账号登录 ----
  authGetSession: () => ipcRenderer.invoke(IPC.AUTH_SESSION) as Promise<AuthSession>,
  authQrCreate: () => ipcRenderer.invoke(IPC.AUTH_QR_CREATE) as Promise<QrCreateResult>,
  authQrPoll: (unikey: string) => ipcRenderer.invoke(IPC.AUTH_QR_POLL, unikey) as Promise<QrPollResult>,
  authLoginWithCookie: (cookie: string) =>
    ipcRenderer.invoke(IPC.AUTH_COOKIE_LOGIN, cookie) as Promise<CookieLoginResult>,
  /** 兼容别名（UI 契约使用 authSetCookie） */
  authSetCookie: (cookie: string) =>
    ipcRenderer.invoke(IPC.AUTH_COOKIE_LOGIN, cookie) as Promise<CookieLoginResult>,
  authLogout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT) as Promise<void>,
  authMyPlaylists: () => ipcRenderer.invoke(IPC.AUTH_MY_PLAYLISTS) as Promise<MyPlaylistsResult>,
  onAuthChanged: (cb: (s: AuthSession) => void) => subscribe<AuthSession>(IPC_EVENT.AUTH_CHANGED, cb),

  // ---- 其它 ----
  clearCache: () => ipcRenderer.invoke(IPC.CACHE_CLEAR) as Promise<void>
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('nt', nt)
  } catch (err) {
    console.error('[preload] exposeInMainWorld failed:', err)
  }
} else {
  // 兜底（本项目 contextIsolation 恒为 true，正常不会走到这里）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).nt = nt
}
