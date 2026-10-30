/**
 * IPC 通道名契约（main <-> renderer）
 * 所有通道字符串只在这里定义，main / preload / renderer 三方共用，避免拼写漂移。
 */

/** renderer -> main（contextBridge 暴露的 window.nt 方法） */
export const IPC = {
  /** invoke (mode: WindowMode) */
  WIN_SET_MODE: 'win:set-mode',
  /** invoke (a: WinAction) */
  WIN_ACTION: 'win:action',
  /** invoke -> WindowState */
  WIN_GET_STATE: 'win:state',
  /** invoke -> Settings */
  SETTINGS_GET: 'settings:get',
  /** invoke (p: Partial<Settings>) -> Settings */
  SETTINGS_SET: 'settings:set',
  /** invoke -> string | null */
  DIALOG_PICK_FOLDER: 'dialog:pick-folder',
  /** invoke ({id,url,filename}) -> DownloadResult */
  DOWNLOAD_SAVE: 'download:save',
  /** send (id: string) */
  DOWNLOAD_CANCEL: 'download:cancel',
  /** send (url: string) */
  SHELL_OPEN: 'shell:open',
  /** send (v: number | null) -> 托盘进度 */
  TRAY_PROGRESS: 'tray:progress',
  /** send (tip: string) */
  TRAY_TIP: 'tray:tip',
  /** send (s: MprisState) */
  MPRIS_UPDATE: 'mpris:update',
  /** invoke -> void */
  CACHE_CLEAR: 'cache:clear',

  /* ---- 账号登录 ---- */
  /** invoke -> AuthSession */
  AUTH_SESSION: 'auth:session',
  /** invoke -> QrCreateResult */
  AUTH_QR_CREATE: 'auth:qr-create',
  /** invoke (unikey: string) -> QrPollResult */
  AUTH_QR_POLL: 'auth:qr-poll',
  /** invoke (cookie: string) -> CookieLoginResult */
  AUTH_COOKIE_LOGIN: 'auth:cookie-login',
  /** invoke -> void */
  AUTH_LOGOUT: 'auth:logout',
  /** invoke -> MyPlaylistsResult */
  AUTH_MY_PLAYLISTS: 'auth:my-playlists'
} as const

/** main -> renderer 推送事件 */
export const IPC_EVENT = {
  /** (s: WindowState) */
  WIN_STATE_CHANGED: 'win:state-changed',
  /** (k: MediaKeyAction) */
  MEDIA_KEY: 'mediakey',
  /** (a: TrayAction) */
  TRAY_ACTION: 'tray:action',
  /** (mode: WindowMode) */
  WINDOW_MODE: 'window-mode',
  /** ({id, received, total}) */
  DOWNLOAD_PROGRESS: 'download:progress',
  /** ({action, value?}) */
  MPRIS_CMD: 'mpris:cmd',
  /** (url: string) */
  DEEP_LINK: 'deeplink',
  /** (s: AuthSession) 登录状态变化 */
  AUTH_CHANGED: 'auth:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]
