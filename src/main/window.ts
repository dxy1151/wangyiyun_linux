/**
 * 窗口管理
 *  - 无边框自绘标题栏（frame:false），1200x820，minWidth 960 / minHeight 620
 *  - 迷你播放器模式：320x120，alwaysOnTop，无边框可拖动（-webkit-app-region）
 *  - 位置/大小持久化（写进 userData/settings.json 的 window 字段，与设置共用同一个原子写）
 *  - 最大化状态推送（win:state-changed）
 *  - 关闭到托盘（依据 settings.closeToTray）；真正的退出由托盘菜单 / MPRIS Quit 触发
 */
import { BrowserWindow, app, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_EVENT } from '../shared/ipc'
import type { WindowMode, WindowState, WinAction } from '../shared/types'
import { createLogger, errorText } from './logger'
import { getSettings, setSettings } from './settings'

const log = createLogger('window')

export const NORMAL_SIZE = { width: 1200, height: 820 } as const
export const MIN_SIZE = { width: 960, height: 620 } as const
export const MINI_SIZE = { width: 320, height: 120 } as const

/** 持久化的窗口字段（不是 Settings 的一部分，单独存在同一个 JSON 里） */
export interface PersistedWindow {
  bounds: { x: number; y: number; width: number; height: number }
  maximized?: boolean
  mode?: WindowMode
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

let mainWindow: BrowserWindow | null = null
let currentMode: WindowMode = 'normal'
let normalBounds: Rect | null = null
let quitting = false
let quittingReason = ''
let saveTimer: NodeJS.Timeout | null = null

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
const rendererUrl = process.env['ELECTRON_RENDERER_URL']

/* ------------------------------------------------------------------ */
/* 持久化（复用 settings.json，通过 settings 模块原子写整份文件）        */
/* ------------------------------------------------------------------ */

/**
 * 窗口字段（写进 userData/settings.json 的 `window` 键，与设置共用同一个原子写）。
 * settings.ts 的 setSettings(patch, beforeWrite) 会在落盘前调用它。
 */
export function windowPatch(): { window: PersistedWindow } {
  const win = mainWindow
  const bounds = normalBounds ?? { x: 0, y: 0, width: NORMAL_SIZE.width, height: NORMAL_SIZE.height }
  const patch: PersistedWindow = { bounds, mode: currentMode }
  if (win && !win.isDestroyed()) {
    patch.maximized = win.isMaximized()
    // 普通模式且非最大化/最小化时才采样实时尺寸；迷你模式不覆盖恢复用的普通 bounds
    if (currentMode === 'normal' && !win.isMaximized() && !win.isMinimized()) {
      patch.bounds = win.getBounds()
    }
  }
  return { window: patch }
}

/** 立即把窗口状态写入 settings.json */
function persistWindow(liveBounds?: Rect): void {
  if (liveBounds) normalBounds = liveBounds
  try {
    setSettings({}, () => undefined)
  } catch (err) {
    log.warn('persist window failed:', errorText(err))
  }
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (currentMode === 'normal' && !win.isMaximized() && !win.isMinimized()) {
      persistWindow(win.getBounds())
    } else {
      persistWindow()
    }
  }, 400)
  saveTimer.unref?.()
}

/** 从文件恢复的窗口状态（index.ts 在 ready 后读取一次） */
interface RestoredWindow {
  bounds: Rect
  maximized: boolean
  mode: WindowMode
}

/** 判断保存的位置是否还在某块屏幕上（拔掉显示器后不要恢复到屏幕外） */
function isBoundsVisible(b: Rect): boolean {
  try {
    const displays = screen.getAllDisplays()
    for (const d of displays) {
      const wa = d.workArea
      const ix = Math.max(b.x, wa.x)
      const iy = Math.max(b.y, wa.y)
      const ax = Math.min(b.x + b.width, wa.x + wa.width)
      const ay = Math.min(b.y + b.height, wa.y + wa.height)
      // 至少要露出 120x80 的可点击区域
      if (ax - ix >= 120 && ay - iy >= 80) return true
    }
  } catch (err) {
    log.warn('display check failed:', errorText(err))
  }
  return false
}

function sanitizeBounds(raw: unknown): Rect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Rect>
  if (![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const width = Math.max(MIN_SIZE.width, Math.round(r.width!))
  const height = Math.max(MIN_SIZE.height, Math.round(r.height!))
  return { x: Math.round(r.x!), y: Math.round(r.y!), width, height }
}

export function restoreWindowState(raw: unknown, mode: unknown): RestoredWindow {
  const saved = (raw ?? {}) as Partial<PersistedWindow>
  const bounds = sanitizeBounds(saved.bounds)
  const max = saved.maximized === true
  const restoredMode: WindowMode = mode === 'mini' ? 'mini' : 'normal'
  let result: Rect
  if (bounds && isBoundsVisible(bounds)) {
    result = bounds
  } else {
    // 居中于主屏
    try {
      const wa = screen.getPrimaryDisplay().workArea
      const width = Math.min(NORMAL_SIZE.width, wa.width)
      const height = Math.min(NORMAL_SIZE.height, wa.height)
      result = {
        x: Math.round(wa.x + (wa.width - width) / 2),
        y: Math.round(wa.y + (wa.height - height) / 2),
        width,
        height
      }
    } catch {
      result = { x: 0, y: 0, width: NORMAL_SIZE.width, height: NORMAL_SIZE.height }
    }
  }
  currentMode = restoredMode
  normalBounds = result
  return { bounds: result, maximized: max && restoredMode === 'normal', mode: restoredMode }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function sendToRenderer(channel: string, payload?: unknown): void {
  const win = getMainWindow()
  if (!win) return
  try {
    win.webContents.send(channel, payload)
  } catch (err) {
    log.warn(`send ${channel} failed:`, errorText(err))
  }
}

export function getWindowState(): WindowState {
  const win = getMainWindow()
  return { maximized: win ? win.isMaximized() : false }
}

function broadcastWindowState(): void {
  sendToRenderer(IPC_EVENT.WIN_STATE_CHANGED, getWindowState())
}

export function getWindowMode(): WindowMode {
  return currentMode
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function toggleMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else showMainWindow()
}

/** 真正退出（跳过 closeToTray 拦截） */
export function quitApp(reason: string): void {
  quitting = true
  quittingReason = reason
  log.info(`quit requested: ${reason}`)
  try {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    persistWindow()
  } catch (err) {
    log.warn('persist before quit failed:', errorText(err))
  }
  app.quit()
}

export function isQuitting(): boolean {
  return quitting
}

/** 托盘 / 深链唤起时判断是否被 closeToTray 拦下 */
export function shouldHideOnClose(): boolean {
  if (quitting) return false
  const s = getSettings()
  return s.closeToTray === true
}

/* ------------------------------------------------------------------ */
/* 迷你模式                                                            */
/* ------------------------------------------------------------------ */

function applyWindowMode(mode: WindowMode): void {
  const win = getMainWindow()
  if (!win) return
  if (mode === currentMode) {
    sendToRenderer(IPC_EVENT.WINDOW_MODE, mode)
    return
  }
  try {
    if (mode === 'mini') {
      if (currentMode === 'normal' && !win.isMaximized() && !win.isMinimized()) {
        normalBounds = win.getBounds()
      }
      if (win.isMaximized()) win.unmaximize()
      currentMode = 'mini'
      win.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
      win.setMaximumSize(MINI_SIZE.width, MINI_SIZE.height)
      win.setResizable(false)
      win.setAlwaysOnTop(true, 'floating')
      win.setSkipTaskbar(false)
      // 迷你窗口放到右下角（工作区内），不打扰用户
      let target: Rect = { x: 0, y: 0, ...MINI_SIZE }
      try {
        const wa = screen.getDisplayMatching(win.getBounds()).workArea
        target = {
          x: Math.round(wa.x + wa.width - MINI_SIZE.width - 24),
          y: Math.round(wa.y + wa.height - MINI_SIZE.height - 24),
          ...MINI_SIZE
        }
      } catch {
        // 用默认值
      }
      win.setSize(MINI_SIZE.width, MINI_SIZE.height, true)
      win.setPosition(target.x, target.y, true)
    } else {
      currentMode = 'normal'
      win.setAlwaysOnTop(false)
      win.setResizable(true)
      win.setMaximumSize(0, 0)
      win.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height)
      const b = normalBounds
      if (b) {
        win.setBounds(b, true)
      } else {
        win.setSize(NORMAL_SIZE.width, NORMAL_SIZE.height, true)
        win.center()
      }
    }
  } catch (err) {
    log.error('apply window mode failed:', errorText(err))
  }
  sendToRenderer(IPC_EVENT.WINDOW_MODE, mode)
  schedulePersist()
}

/** 窗口位置/大小变化后调用（由 index.ts 在托盘/模式切换后触发保存） */
export function persistWindowNow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    persistWindow()
    return
  }
  if (currentMode === 'normal' && !win.isMaximized() && !win.isMinimized()) persistWindow(win.getBounds())
  else persistWindow()
}

export function setWindowMode(mode: unknown): void {
  if (mode !== 'normal' && mode !== 'mini') {
    log.warn('ignored invalid window mode:', mode)
    return
  }
  applyWindowMode(mode)
}

export function handleWindowAction(action: unknown): void {
  const win = getMainWindow()
  if (!win) return
  switch (action as WinAction) {
    case 'minimize':
      win.minimize()
      break
    case 'maximize':
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      break
    case 'close':
      win.close()
      break
    default:
      log.warn('ignored invalid window action:', action)
  }
}

/* ------------------------------------------------------------------ */
/* 创建窗口                                                            */
/* ------------------------------------------------------------------ */

function iconCandidates(): string[] {
  return [
    join(__dirname, '../../build/icon.png'),
    join(process.cwd(), 'build/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(process.resourcesPath ?? '', 'build', 'icon.png')
  ].filter(Boolean)
}

export function findIconPath(): string {
  return iconCandidates().find((p) => existsSync(p)) ?? ''
}

export interface CreateWindowOptions {
  restored: RestoredWindow
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const { bounds, maximized } = opts.restored
  const icon = findIconPath()

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    frame: false,
    // Linux 上 titleBarStyle 无实际效果，但保留以便未来支持 macOS；
    // 无边框窗口仍需自行处理拖动区域（CSS -webkit-app-region: drag）
    titleBarStyle: 'hidden',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    title: '网易云音乐',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  mainWindow = win

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on('show', () => {
    if (!win.isDestroyed() && !win.isMaximized()) broadcastWindowState()
  })
  win.on('maximize', broadcastWindowState)
  win.on('unmaximize', () => {
    broadcastWindowState()
    schedulePersist()
  })

  // 位置/大小变化 → 防抖保存
  win.on('resize', schedulePersist)
  win.on('move', schedulePersist)

  // 关闭到托盘
  win.on('close', (e) => {
    if (shouldHideOnClose()) {
      e.preventDefault()
      log.info('close intercepted → hide to tray (closeToTray=true)')
      win.hide()
    } else if (!quitting) {
      // closeToTray=false：关闭即退出
      quitting = true
      quittingReason = 'window-close'
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) log.error(`renderer load failed (${code} ${desc}) url=${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer process gone:', details.reason, details.exitCode)
  })
  win.webContents.on('preload-error', (_e, path, error) => {
    log.error(`preload error in ${path}:`, errorText(error))
  })

  // 外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/.test(url)) {
      shell.openExternal(url).catch((err) => log.warn('openExternal failed:', errorText(err)))
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = rendererUrl ? new URL(rendererUrl) : null
    const sameDev = !!devUrl && url.startsWith(devUrl.origin)
    if (!url.startsWith('file://') && !sameDev) {
      e.preventDefault()
      if (/^(https?:|mailto:)/.test(url)) {
        shell.openExternal(url).catch((err) => log.warn('openExternal failed:', errorText(err)))
      }
    }
  })

  if (maximized) {
    // 先 maximize 再首次 show，避免闪一下小窗
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.maximize()
    })
  }

  if (opts.restored.mode === 'mini') {
    // 迷你模式由 index.ts 在窗口创建后再切换（把普通 bounds 当作可恢复值）
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) applyWindowMode('mini')
    })
  }

  if (isDev && rendererUrl) {
    win.loadURL(rendererUrl).catch((err) => log.error('loadURL failed:', errorText(err)))
  } else {
    const indexHtml = join(__dirname, '../renderer/index.html')
    win.loadFile(indexHtml).catch((err) => {
      // 渲染层产物缺失（例如只构建了 main）时不要拖垮主进程：仍展示窗口并记日志
      log.error(`loadFile failed (${indexHtml}):`, errorText(err))
      win.show()
    })
  }

  return win
}

/** 收到 second-instance / 深链时把窗口拉到前面 */
export function focusMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

export function disposeWindowModule(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    persistWindowNow()
  } catch {
    // 退出路径上尽力而为
  }
}
