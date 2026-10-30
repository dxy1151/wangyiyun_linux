/**
 * 主进程入口：组装窗口 / 托盘 / MPRIS / 媒体键 / 下载 / 设置 / 深链。
 *
 * 设计原则：
 *  - 任何"桌面集成"能力（托盘、MPRIS、媒体键、协议注册）都必须是可失败的：
 *    失败只打 warn 日志，主窗口与播放功能照常可用。
 *  - Linux 沙箱：chrome-sandbox 没有 setuid root 位时 Chromium 会 FATAL，
 *    这里检测后自动补 --no-sandbox（等价于 chromium 的常规降级），保证开发机与
 *    普通用户的非 setuid 安装也能开箱运行。
 */
import { app } from 'electron'
import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_EVENT } from '../shared/ipc'
import type { MprisAction, PlayMode, Settings } from '../shared/types'
import { createLogger, errorText } from './logger'
import { installErrorHandlers, enableFileLogging } from './errors'
import { acquireSingleInstanceLock, findDeepLink, parseDeepLink, registerProtocol } from './protocol'
import { getSettings, setSettings } from './settings'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc'
import { registerMediaKeys, unregisterMediaKeys } from './mediakeys'
import { MprisService } from './mpris/service'
import { abortAllDownloads } from './download'
import { createTray, destroyTray, refreshTrayMenu } from './tray'
import {
  createMainWindow,
  disposeWindowModule,
  getMainWindow,
  getWindowMode,
  quitApp,
  restoreWindowState,
  sendToRenderer,
  showMainWindow
} from './window'

const log = createLogger('app')

const APP_ID = 'com.don0ox1.neteasemusic'

/* ------------------------------------------------------------------ */
/* 0. 沙箱兼容（必须在 app ready 之前）                                  */
/* ------------------------------------------------------------------ */

/**
 * chrome-sandbox 需要 root 所有且 setuid 位（4755）。开发机 / 解包目录 / 部分
 * AppImage 安装方式不满足该条件，Chromium 会直接 abort。此时自动追加 --no-sandbox，
 * 让应用仍能正常启动（渲染进程仍在 JS 层面隔离：contextIsolation + 禁用 nodeIntegration）。
 */
function ensureSandboxUsable(): void {
  if (process.platform !== 'linux') return
  const sandboxPath = join(process.resourcesPath ?? app.getAppPath(), 'chrome-sandbox')
  const candidates = [sandboxPath, join(process.execPath, '..', 'chrome-sandbox')]
  let usable = false
  let checked = false
  for (const p of candidates) {
    try {
      const st = statSync(p)
      checked = true
      const isRoot = st.uid === 0
      const isSetuid = (st.mode & 0o4000) !== 0
      if (isRoot && isSetuid) {
        usable = true
        break
      }
      log.warn(
        `chrome-sandbox not usable: ${p} (uid=${st.uid}, mode=${(st.mode & 0o7777).toString(8)}) ` +
          `→ need root:4755; falling back to --no-sandbox`
      )
    } catch {
      // 该候选不存在，继续
    }
  }
  if (!checked) {
    // 找不到 chrome-sandbox（AppImage 解包路径差异等）：交给 Chromium 自己决定，
    // 只有明确检测到不可用时才降级，避免误伤
    log.debug('chrome-sandbox not found, leaving sandbox settings untouched')
    return
  }
  if (!usable) {
    app.commandLine.appendSwitch('no-sandbox')
    // 若处于 setuid 沙箱受限环境，仍保留 contextIsolation 等 JS 层隔离
    log.warn('started with --no-sandbox (setuid-less chrome-sandbox)')
  }
}

ensureSandboxUsable()

/* ------------------------------------------------------------------ */
/* 0.5 userData 可写性兜底（容器 / 沙箱环境里 $HOME 常常只读）             */
/*     必须在 whenReady 与任何 getPath('userData') 调用之前执行。         */
/* ------------------------------------------------------------------ */

function ensureWritableUserData(): void {
  const check = (dir: string): boolean => {
    try {
      mkdirSync(dir, { recursive: true })
      accessSync(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }
  try {
    const dir = app.getPath('userData')
    if (check(dir)) return
    log.warn(`userData not writable: ${dir}`)
  } catch (err) {
    log.warn('app.getPath(userData) failed:', errorText(err))
  }
  const fallback = join(tmpdir(), 'netease-cloud-music-linux')
  try {
    if (check(fallback)) {
      app.setPath('userData', fallback)
      log.warn(`userData not writable — fell back to ${fallback}`)
      return
    }
  } catch (err) {
    log.warn('fallback userData failed:', errorText(err))
  }
  // 最后兜底：临时目录下带 pid 的子目录，保证一定能写
  try {
    const pidDir = join(tmpdir(), `netease-cloud-music-linux-${process.pid}`)
    mkdirSync(pidDir, { recursive: true })
    app.setPath('userData', pidDir)
    log.warn(`userData fell back to ${pidDir}`)
  } catch (err) {
    // 真的一处都不可写：让 Chromium 自己报错，但至少不静默
    log.error('no writable userData directory found:', errorText(err))
  }
}

ensureWritableUserData()
installErrorHandlers()

if (process.platform === 'linux') {
  // 与 electron-builder linux.desktop.StartupWMClass 保持一致（托盘/任务栏图标归组依赖它）
  app.setName('NeteaseCloudMusic')
  // Wayland 下跟随会话；X11 下 auto 会正确选择 x11
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}
app.setAppUserModelId(APP_ID)

/* ------------------------------------------------------------------ */
/* 1. 单实例锁                                                          */
/* ------------------------------------------------------------------ */

let mpris: MprisService | null = null
let started = false

if (!acquireSingleInstanceLock()) {
  log.info('another instance is running, focusing it and quitting')
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    log.info('second-instance detected, raising main window')
    showMainWindow()
    const link = findDeepLink(argv)
    if (link) dispatchDeepLink(link)
  })

  app.on('open-url', (event, url) => {
    // macOS / 某些桌面用 xdg-open 时走这里
    event.preventDefault()
    dispatchDeepLink(url)
  })

  start()
}

/* ------------------------------------------------------------------ */
/* 2. 深链                                                              */
/* ------------------------------------------------------------------ */

let pendingDeepLink: string | null = findDeepLink(process.argv)

function dispatchDeepLink(raw: string): void {
  const link = parseDeepLink(raw)
  if (!link) {
    log.warn('ignore non-app deep link:', raw)
    return
  }
  log.info(`deep link: ${link.action}/${link.id}`)
  if (!started) {
    pendingDeepLink = raw
    return
  }
  showMainWindow()
  sendToRenderer(IPC_EVENT.DEEP_LINK, raw)
}

/* ------------------------------------------------------------------ */
/* 3. 启动                                                              */
/* ------------------------------------------------------------------ */

function seedSettings(): void {
  // 首次运行：写一次文件，保证 userData/settings.json 存在且 downloadDir 有默认值
  try {
    const before = getSettings()
    setSettings({}, () => undefined)
    log.info(`settings ready (downloadDir=${before.downloadDir})`)
  } catch (err) {
    log.warn('seed settings failed:', errorText(err))
  }
}

async function startMpris(): Promise<MprisService> {
  const service = new MprisService({
    onCommand: (action: MprisAction, value?: number) => {
      try {
        sendToRenderer(IPC_EVENT.MPRIS_CMD, value === undefined ? { action } : { action, value })
      } catch (err) {
        log.warn('forward mpris cmd failed:', errorText(err))
      }
    },
    onRaise: () => showMainWindow(),
    onQuit: () => quitApp('mpris-quit')
  })
  // 播放模式/音量变化（来自音量通知等）同步到设置
  service.on('shuffle', (on: boolean) => {
    try {
      setSettings({ playMode: on ? 'shuffle' : 'order' })
    } catch (err) {
      log.warn('sync shuffle to settings failed:', errorText(err))
    }
  })
  service.on('loop-status', (mode: PlayMode) => {
    try {
      setSettings({ playMode: mode })
    } catch (err) {
      log.warn('sync loop status to settings failed:', errorText(err))
    }
  })
  await service.start() // 内部 try/catch，永不 throw
  // 启动时把已保存的播放模式同步给 MPRIS 客户端（Shuffle / LoopStatus）
  try {
    service.setPlayMode(getSettings().playMode)
  } catch (err) {
    log.warn('initial play mode sync failed:', errorText(err))
  }
  return service
}

function restoreAndCreateWindow(): void {
  const s: Settings & { window?: unknown } = getSettings() as Settings & { window?: unknown }
  try {
    const restored = restoreWindowState(s.window, getWindowMode())
    const win = createMainWindow({ restored })
    if (!win) throw new Error('createMainWindow returned null')
    log.info(
      `main window created (${restored.bounds.width}x${restored.bounds.height} @ ${restored.bounds.x},${restored.bounds.y})`
    )
    // 首次 ready-to-show 之后补发挂起的深链
    win.once('show', () => {
      if (pendingDeepLink) {
        const link = pendingDeepLink
        pendingDeepLink = null
        setTimeout(() => dispatchDeepLink(link), 300)
      }
    })
  } catch (err) {
    log.error('window creation failed:', errorText(err))
  }
}

async function start(): Promise<void> {
  await app.whenReady()
  started = true
  enableFileLogging()
  log.info(`app ready (electron ${process.versions.electron}, packaged=${app.isPackaged})`)

  try {
    registerProtocol()
  } catch (err) {
    log.warn('protocol registration failed:', errorText(err))
  }

  seedSettings()
  restoreAndCreateWindow()

  // 托盘：失败不阻断（无托盘环境的桌面）
  try {
    createTray()
  } catch (err) {
    log.error('tray setup failed (continuing without tray):', errorText(err))
  }

  mpris = await startMpris()
  registerIpcHandlers(mpris)

  // 媒体键：静默失败
  try {
    registerMediaKeys()
  } catch (err) {
    log.warn('media keys setup failed:', errorText(err))
  }

  // 托盘菜单"播放/暂停"文案由 ipc.ts 的 mpris:update 驱动（setPlaybackLabel）
  refreshTrayMenu()

  // 启动后若有挂起的深链（首次带参数启动），等渲染层就绪后推送
  if (pendingDeepLink) {
    const link = pendingDeepLink
    const timer = setTimeout(() => {
      pendingDeepLink = null
      dispatchDeepLink(link)
    }, 1500)
    timer.unref?.()
  }

  app.on('activate', () => {
    if (!getMainWindow()) {
      restoreAndCreateWindow()
      refreshTrayMenu()
    } else {
      showMainWindow()
    }
  })
}

/* ------------------------------------------------------------------ */
/* 5. 退出                                                              */
/* ------------------------------------------------------------------ */

app.on('window-all-closed', () => {
  // 关闭到托盘时窗口是 hide 不是 close；真到 close 说明用户要退出
  if (process.platform !== 'darwin') {
    log.info('all windows closed → quit')
    quitApp('window-all-closed')
  }
})

app.on('before-quit', () => {
  log.info('before-quit: cleaning up')
  try {
    abortAllDownloads()
  } catch (err) {
    log.warn('abort downloads failed:', errorText(err))
  }
  try {
    unregisterMediaKeys()
  } catch (err) {
    log.warn('unregister media keys failed:', errorText(err))
  }
  try {
    disposeWindowModule()
  } catch (err) {
    log.warn('dispose window failed:', errorText(err))
  }
  try {
    void mpris?.stop()
  } catch (err) {
    log.warn('stop mpris failed:', errorText(err))
  }
  try {
    unregisterIpcHandlers()
  } catch (err) {
    log.warn('unregister ipc failed:', errorText(err))
  }
  try {
    destroyTray()
  } catch (err) {
    log.warn('destroy tray failed:', errorText(err))
  }
})

app.on('will-quit', () => {
  log.info('will-quit')
})
