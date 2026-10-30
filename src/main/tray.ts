/**
 * 系统托盘
 *  - 图标：build/icon.png → nativeImage（失败时用代码生成的红色圆点兜底，绝不阻断启动）
 *  - 右键菜单：显示/隐藏、播放-暂停、上一首、下一首、迷你模式、设置、退出
 *  - 左键：切换窗口显示/隐藏（部分桌面环境左键直接弹菜单，两条路都可用）
 *  - tooltip 显示当前歌曲（tray:tip），title 显示进度（tray:progress，xembed dbus 下有效）
 *  - 托盘不可用（无 StatusNotifier / 无 xembed 托盘）时降级：只在日志里说明，不影响主功能
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { IPC_EVENT } from '../shared/ipc'
import type { TrayAction } from '../shared/types'
import { createLogger, errorText } from './logger'
import {
  findIconPath,
  getWindowMode,
  getMainWindow,
  quitApp,
  sendToRenderer,
  setWindowMode,
  showMainWindow,
  toggleMainWindow
} from './window'

const log = createLogger('tray')

const BASE_TIP = '网易云音乐'

let tray: Tray | null = null
let destroyed = false
let currentTip = BASE_TIP
let playbackLabel = '播放/暂停'

/** 32x32 红色圆点 + 白色音符（代码生成，避免资源缺失导致托盘不可用） */
function fallbackIcon(): NativeImage {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // BGRA（Electron 期望的原始位图顺序）
      buf[i] = 40
      buf[i + 1] = 40
      buf[i + 2] = 236
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      // 音符：竖条 + 圆头
      const stem = x >= 18 && x <= 21 && y >= 7 && y <= 21
      const head = Math.hypot(x + 0.5 - 16, y + 0.5 - 22) <= 4.5
      const flag = x >= 21 && x <= 25 && y >= 7 && y <= 13
      if (stem || head || flag) {
        buf[i] = 255
        buf[i + 1] = 255
        buf[i + 2] = 255
      }
      buf[i + 3] = d <= cx - 1 ? 255 : 0
    }
  }
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size })
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function buildTrayIcon(): NativeImage {
  const path = findIconPath()
  let img: NativeImage | null = null
  if (path) {
    try {
      const raw = nativeImage.createFromPath(path)
      if (!raw.isEmpty()) img = raw.resize({ width: 22, height: 22, quality: 'best' })
      else log.warn('icon file loaded but empty:', path)
    } catch (err) {
      log.warn('icon load failed:', errorText(err))
    }
  } else {
    log.warn('icon not found, using generated fallback')
  }
  if (!img || img.isEmpty()) img = fallbackIcon()
  return img
}

function emitTrayAction(action: TrayAction): void {
  const win = getMainWindow()
  if (!win || win.webContents.isDestroyed()) {
    // 渲染层还没就绪时，至少保证"显示窗口"可用
    if (action === 'show') showMainWindow()
    else log.warn('tray action dropped (renderer not ready):', action)
    return
  }
  sendToRenderer(IPC_EVENT.TRAY_ACTION, action)
}

function buildMenu(): Menu {
  const mode = getWindowMode()
  return Menu.buildFromTemplate([
    { label: `网易云音乐${currentTip !== BASE_TIP ? '' : ''}`, enabled: false },
    { type: 'separator' },
    {
      label: playbackLabel,
      click: () => emitTrayAction('play-pause')
    },
    { label: '上一首', click: () => emitTrayAction('prev') },
    { label: '下一首', click: () => emitTrayAction('next') },
    { type: 'separator' },
    {
      label: mode === 'mini' ? '退出迷你模式' : '迷你播放器',
      click: () => setWindowMode(mode === 'mini' ? 'normal' : 'mini')
    },
    {
      label: '显示主窗口',
      click: () => {
        showMainWindow()
        emitTrayAction('show')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => quitApp('tray-menu')
    }
  ])
}

function refreshMenu(): void {
  if (!tray || destroyed) return
  try {
    tray.setContextMenu(buildMenu())
  } catch (err) {
    log.warn('setContextMenu failed:', errorText(err))
  }
}

export function createTray(): boolean {
  if (tray) return true
  try {
    tray = new Tray(buildTrayIcon())
  } catch (err) {
    // 某些 Linux 桌面（无 xembed / 无 StatusNotifier）会抛错，这里降级
    log.error('tray creation failed, running without tray:', errorText(err))
    tray = null
    return false
  }

  tray.setToolTip(BASE_TIP)
  refreshMenu()

  tray.on('click', () => {
    // 左键切换显示；部分 DE 会同时弹菜单，不影响功能
    toggleMainWindow()
  })
  tray.on('double-click', () => showMainWindow())
  tray.on('right-click', () => refreshMenu())

  // Tray 类型里没有 'show'/'hide'/'destroyed' 事件，部分平台实现会发，用 EventEmitter 兜底监听
  const emitter = tray as unknown as NodeJS.EventEmitter
  emitter.on?.('destroyed', () => {
    log.warn('tray destroyed')
    destroyed = true
  })
  emitter.on?.('show', () => log.info('tray visible'))

  log.info('tray created')
  return true
}

export function setTrayTip(tip: string): void {
  currentTip = typeof tip === 'string' && tip.trim() ? tip.trim() : BASE_TIP
  if (!tray || destroyed) return
  try {
    tray.setToolTip(currentTip)
    // Linux(xembed) 下 tooltip/title 都受支持；setTitle 在部分托盘实现里无效果但无害
    tray.setTitle(currentTip === BASE_TIP ? '' : currentTip)
  } catch (err) {
    log.warn('setTrayTip failed:', errorText(err))
  }
}

/**
 * 进度：0~1 普通进度；负值表示错误态（如缓冲失败）；null 清除。
 * Tray 本身没有 setProgressBar，用 tooltip/title 文本表达进度（见下方实现）。
 */
export function setTrayProgress(v: number | null): void {
  if (!tray || destroyed) return
  try {
    // Tray 没有 setProgressBar（那是 BrowserWindow 的方法）。Linux 托盘只能靠
    // tooltip / title 文本表达进度：
    //   有进度 → "曲名 — 45%"
    //   无进度 → 恢复为当前曲名
    if (typeof v === 'number' && Number.isFinite(v)) {
      const pct = Math.round(Math.max(0, Math.min(1, v)) * 100)
      tray.setToolTip(`${currentTip} — ${pct}%`)
      tray.setTitle(`${pct}%`)
    } else {
      tray.setToolTip(currentTip)
      tray.setTitle(currentTip === BASE_TIP ? '' : currentTip)
    }
  } catch (err) {
    log.warn('setTrayProgress failed:', errorText(err))
  }
}

export function setPlaybackLabel(playing: boolean): void {
  const next = playing ? '暂停' : '播放'
  if (next === playbackLabel) return
  playbackLabel = next
  refreshMenu()
  if (tray && !destroyed) {
    try {
      tray.setToolTip(currentTip)
    } catch {
      // ignore
    }
  }
}

export function refreshTrayMenu(): void {
  refreshMenu()
}

export function destroyTray(): void {
  if (!tray) return
  destroyed = true
  try {
    tray.destroy()
  } catch (err) {
    log.warn('tray destroy failed:', errorText(err))
  }
  tray = null
  log.info('tray destroyed')
}

export function isTrayAvailable(): boolean {
  return tray !== null && !destroyed
}

/** 供 index.ts 在 before-quit 时调用，保证托盘图标不残留 */
export function shutdownTray(): void {
  destroyTray()
  void app
}
