/**
 * IPC 注册（main 侧）—— 通道名全部来自 shared/ipc.ts，不在这里硬编码字符串。
 *
 * 约定：
 *  - handle 型的 handler 内部一律 try/catch，失败返回安全默认值而不是 reject（渲染层更简单）
 *  - 所有来自渲染层的入参都视作不可信，做类型/范围校验
 */
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { IPC_EVENT } from '../shared/ipc'
import type {
  AuthSession,
  CookieLoginResult,
  DownloadRequest,
  MprisState,
  MyPlaylistsResult,
  QrCreateResult,
  QrPollResult,
  Settings,
  WindowMode,
  WindowState,
  WinAction
} from '../shared/types'
import { createLogger, errorText } from './logger'
import * as auth from './auth'
import { activeDownloadCount, cancelDownload, saveDownload } from './download'
import { getSettings, setSettings } from './settings'
import { getWindowState, getMainWindow, handleWindowAction, setWindowMode } from './window'
import { refreshTrayMenu, setPlaybackLabel, setTrayProgress, setTrayTip } from './tray'
import type { MprisService } from './mpris/service'

const log = createLogger('ipc')

let mpris: MprisService | null = null
let registered = false

/** 清理会话缓存（cache:clear）；渲染层 IndexedDB 由 UI 自己清 */
export async function clearAppCache(): Promise<void> {
  const targets = new Set<Electron.Session>()
  try {
    targets.add(session.defaultSession)
  } catch (err) {
    log.warn('defaultSession unavailable:', errorText(err))
  }
  const win = getMainWindow()
  if (win) targets.add(win.webContents.session)

  for (const ses of targets) {
    await ses.clearCache()
    // 顺带清理代码缓存（不影响 localStorage/IndexedDB，避免用户数据丢失）
    try {
      await ses.clearCodeCaches({})
    } catch (err) {
      log.debug('clearCodeCaches failed (non-fatal):', errorText(err))
    }
  }
  log.info(`cache cleared for ${targets.size} session(s)`)
}

function registerOnce(channel: string): void {
  // 开发态热重载时可能重复注册；显式移除避免 "second handler" 报错
  try {
    ipcMain.removeHandler(channel)
  } catch {
    // ignore
  }
}

export function registerIpcHandlers(mprisService: MprisService | null): void {
  if (registered) return
  registered = true
  mpris = mprisService

  /* ---------------- 窗口 ---------------- */
  ipcMain.on(IPC.WIN_SET_MODE, (_e, mode: WindowMode) => {
    try {
      setWindowMode(mode)
      refreshTrayMenu()
    } catch (err) {
      log.error('win:set-mode failed:', errorText(err))
    }
  })

  ipcMain.on(IPC.WIN_ACTION, (_e, action: WinAction) => {
    try {
      handleWindowAction(action)
    } catch (err) {
      log.error('win:action failed:', errorText(err))
    }
  })

  registerOnce(IPC.WIN_GET_STATE)
  ipcMain.handle(IPC.WIN_GET_STATE, (): WindowState => {
    try {
      return getWindowState()
    } catch (err) {
      log.error('win:state failed:', errorText(err))
      return { maximized: false }
    }
  })

  /* ---------------- 设置 ---------------- */
  registerOnce(IPC.SETTINGS_GET)
  ipcMain.handle(IPC.SETTINGS_GET, (): Settings => {
    try {
      return getSettings()
    } catch (err) {
      log.error('settings:get failed:', errorText(err))
      // 兜底：返回最小可用设置，保证渲染层不会因为一次读盘失败而白屏
      return {
        theme: 'dark',
        volume: 0.8,
        playMode: 'order',
        downloadDir: app.getPath('music'),
        closeToTray: true,
        cacheLimitMB: 1024
      }
    }
  })

  registerOnce(IPC.SETTINGS_SET)
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: Partial<Settings>): Settings => {
    try {
      if (!patch || typeof patch !== 'object') {
        log.warn('settings:set ignored non-object patch')
        return getSettings()
      }
      // 窗口字段（window.bounds/mode）由 settings.ts 的 beforeWrite 钩子并入同一份 JSON
      const next = setSettings(patch, () => undefined)
      // 关闭到托盘设置变化 → 刷新托盘菜单文案（无副作用）
      refreshTrayMenu()
      log.info('settings updated:', Object.keys(patch).join(','))
      return next
    } catch (err) {
      log.error('settings:set failed:', errorText(err))
      return getSettings()
    }
  })

  registerOnce(IPC.DIALOG_PICK_FOLDER)
  ipcMain.handle(IPC.DIALOG_PICK_FOLDER, async (): Promise<string | null> => {
    try {
      const win = getMainWindow()
      const options: Electron.OpenDialogOptions = {
        title: '选择下载目录',
        properties: ['openDirectory', 'createDirectory']
      }
      const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (r.canceled || r.filePaths.length === 0) return null
      return r.filePaths[0]
    } catch (err) {
      log.error('dialog:pick-folder failed:', errorText(err))
      return null
    }
  })

  /* ---------------- 下载 ---------------- */
  registerOnce(IPC.DOWNLOAD_SAVE)
  ipcMain.handle(IPC.DOWNLOAD_SAVE, async (_e, req: DownloadRequest) => {
    try {
      return await saveDownload(req)
    } catch (err) {
      log.error('download:save failed:', errorText(err))
      return { ok: false, error: errorText(err) }
    }
  })

  ipcMain.on(IPC.DOWNLOAD_CANCEL, (_e, id: string) => {
    try {
      cancelDownload(id)
    } catch (err) {
      log.error('download:cancel failed:', errorText(err))
    }
  })

  /* ---------------- 外链 ---------------- */
  ipcMain.on(IPC.SHELL_OPEN, (_e, url: string) => {
    try {
      if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) {
        void shell.openExternal(url).catch((err) => log.warn('openExternal failed:', errorText(err)))
      } else {
        log.warn('shell:open rejected:', url)
      }
    } catch (err) {
      log.error('shell:open failed:', errorText(err))
    }
  })

  /* ---------------- 托盘 ---------------- */
  ipcMain.on(IPC.TRAY_PROGRESS, (_e, v: number | null) => {
    try {
      setTrayProgress(typeof v === 'number' && Number.isFinite(v) ? v : null)
    } catch (err) {
      log.error('tray:progress failed:', errorText(err))
    }
  })

  ipcMain.on(IPC.TRAY_TIP, (_e, tip: string) => {
    try {
      setTrayTip(typeof tip === 'string' ? tip : '')
    } catch (err) {
      log.error('tray:tip failed:', errorText(err))
    }
  })

  /* ---------------- MPRIS ---------------- */
  ipcMain.on(IPC.MPRIS_UPDATE, (_e, state: MprisState) => {
    try {
      if (!state || typeof state !== 'object') return
      mpris?.update(state)
      if (state.playbackStatus) setPlaybackLabel(state.playbackStatus === 'Playing')
    } catch (err) {
      log.error('mpris:update failed:', errorText(err))
    }
  })

  /* ---------------- 缓存 ---------------- */
  registerOnce(IPC.CACHE_CLEAR)
  ipcMain.handle(IPC.CACHE_CLEAR, async (): Promise<void> => {
    try {
      await clearAppCache()
    } catch (err) {
      log.error('cache:clear failed:', errorText(err))
    }
  })

  /* ---------------- 账号登录 ---------------- */
  registerOnce(IPC.AUTH_SESSION)
  ipcMain.handle(IPC.AUTH_SESSION, async (): Promise<AuthSession> => {
    try {
      return await auth.getSession()
    } catch (err) {
      log.warn('auth:session failed:', errorText(err))
      return { loggedIn: false, error: errorText(err) }
    }
  })

  registerOnce(IPC.AUTH_QR_CREATE)
  ipcMain.handle(IPC.AUTH_QR_CREATE, async (): Promise<QrCreateResult> => {
    try {
      return await auth.qrCreate()
    } catch (err) {
      log.warn('auth:qr-create failed:', errorText(err))
      throw new Error(errorText(err))
    }
  })

  registerOnce(IPC.AUTH_QR_POLL)
  ipcMain.handle(IPC.AUTH_QR_POLL, async (_e, unikey: unknown): Promise<QrPollResult> => {
    const key = typeof unikey === 'string' ? unikey : ''
    const result = await auth.qrPoll(key)
    if (result.status === 803 && result.user) {
      broadcastAuth({ loggedIn: true, user: result.user })
    }
    return result
  })

  registerOnce(IPC.AUTH_COOKIE_LOGIN)
  ipcMain.handle(IPC.AUTH_COOKIE_LOGIN, async (_e, cookie: unknown): Promise<CookieLoginResult> => {
    const raw = typeof cookie === 'string' ? cookie.slice(0, 20_000) : ''
    const result = await auth.loginWithCookie(raw)
    if (result.ok && result.user) broadcastAuth({ loggedIn: true, user: result.user })
    return result
  })

  registerOnce(IPC.AUTH_LOGOUT)
  ipcMain.handle(IPC.AUTH_LOGOUT, async (): Promise<void> => {
    await auth.logout()
    broadcastAuth({ loggedIn: false })
  })

  registerOnce(IPC.AUTH_MY_PLAYLISTS)
  ipcMain.handle(IPC.AUTH_MY_PLAYLISTS, async (): Promise<MyPlaylistsResult> => {
    try {
      return await auth.myPlaylists()
    } catch (err) {
      log.warn('auth:my-playlists failed:', errorText(err))
      return { created: [], subscribed: [] }
    }
  })

  log.info('IPC handlers registered')
}

/** 向所有窗口广播登录态变化 */
function broadcastAuth(s: AuthSession): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send(IPC_EVENT.AUTH_CHANGED, s)
      } catch {
        // ignore
      }
    }
  }
}

/** 退出前清理 IPC（开发态热重载安全） */
export function unregisterIpcHandlers(): void {
  const handles = [
    IPC.WIN_GET_STATE, IPC.SETTINGS_GET, IPC.SETTINGS_SET, IPC.DIALOG_PICK_FOLDER,
    IPC.DOWNLOAD_SAVE, IPC.CACHE_CLEAR,
    IPC.AUTH_SESSION, IPC.AUTH_QR_CREATE, IPC.AUTH_QR_POLL,
    IPC.AUTH_COOKIE_LOGIN, IPC.AUTH_LOGOUT, IPC.AUTH_MY_PLAYLISTS
  ]
  for (const ch of handles) {
    try {
      ipcMain.removeHandler(ch)
    } catch {
      // ignore
    }
  }
  registered = false
}
