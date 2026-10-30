/**
 * 主进程错误处理
 *  - uncaughtException / unhandledRejection：记录日志，不直接崩溃
 *    注意：Node 对真正不可恢复的 native 崩溃无能为力，这里保证 JS 层的错误只记录不退出
 *  - logger 的 file sink 在 app ready 后才有 userData 路径，之前只打印到控制台
 */
import { app } from 'electron'
import { createLogger, errorText, initFileLogging } from './logger'

const log = createLogger('crash')

let installed = false

export function installErrorHandlers(): void {
  if (installed) return
  installed = true

  process.on('uncaughtException', (err) => {
    log.error('uncaughtException (kept alive):', errorText(err))
  })

  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection (kept alive):', errorText(reason))
  })

  // 静音 EPIPE 等输出流错误（终端关闭 / 管道被 tail 截断时 console 写失败）
  process.on('warning', (w) => {
    log.debug('process warning:', w.name, w.message)
  })

  try {
    app.on('child-process-gone', (_e, details) => {
      log.error('child process gone:', details.type, details.reason, details.exitCode)
    })
    app.on('render-process-gone', (_e, _wc, details) => {
      log.error('render process gone:', details.reason, details.exitCode)
    })
  } catch (err) {
    log.warn('failed to hook app events:', errorText(err))
  }

  try {
    process.stdout.on?.('error', () => undefined)
    process.stderr.on?.('error', () => undefined)
  } catch {
    // ignore
  }
}

/** ready 之后启用文件日志 */
export function enableFileLogging(): void {
  try {
    initFileLogging(app.getPath('userData'))
    log.info(`file logging enabled at ${app.getPath('userData')}/logs/main.log`)
  } catch (err) {
    log.warn('enableFileLogging failed:', errorText(err))
  }
}
