/**
 * 全局媒体键
 *  - globalShortcut 注册 MediaPlayPause / MediaNextTrack / MediaPreviousTrack / MediaStop
 *  - Linux 上常被 DE / 其它播放器抢占，注册失败只记录 debug，不打扰用户
 *  - Wayland 下 globalShortcut 基本无效 → 依赖 MPRIS（DE 会把媒体键发给当前 MPRIS 播放器）
 */
import { globalShortcut } from 'electron'
import { IPC_EVENT } from '../shared/ipc'
import type { MediaKeyAction } from '../shared/types'
import { createLogger, errorText } from './logger'
import { sendToRenderer } from './window'

const log = createLogger('mediakey')

const BINDS: ReadonlyArray<readonly [string, MediaKeyAction]> = [
  ['MediaPlayPause', 'play-pause'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'prev'],
  ['MediaStop', 'stop']
]

const accel = (action: MediaKeyAction): string => `[mediakey] ${action}`

/**
 * 注册媒体键，返回是否至少注册成功一个。
 * 永不抛出：全部失败也不影响主功能（MPRIS 仍然可用）。
 */
export function registerMediaKeys(): boolean {
  let ok = 0
  for (const [name, action] of BINDS) {
    try {
      const registered = globalShortcut.register(name, () => {
        log.debug(accel(action))
        sendToRenderer(IPC_EVENT.MEDIA_KEY, action)
      })
      if (registered) {
        ok++
      } else {
        log.debug(`register failed (occupied by DE/another app): ${name}`)
      }
    } catch (err) {
      log.debug(`register error ${name}:`, errorText(err))
    }
  }
  if (ok > 0) log.info(`media keys registered: ${ok}/${BINDS.length}`)
  else log.warn('no media key could be registered (desktop environment likely owns them) — MPRIS still works')
  return ok > 0
}

export function unregisterMediaKeys(): void {
  for (const [name] of BINDS) {
    try {
      if (globalShortcut.isRegistered(name)) globalShortcut.unregister(name)
    } catch {
      // 退出路径忽略
    }
  }
  try {
    globalShortcut.unregisterAll()
  } catch {
    // ignore
  }
}
