/**
 * 主进程日志：统一前缀 + 可选落盘（userData/logs/main.log，2MB 轮转一次）。
 * 只依赖 node，不依赖 electron，便于在无头脚本里单独 require 测试。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 2 * 1024 * 1024

let logFile: string | null = null
let fileEnabled = false

/** 在 app ready 之后调用一次（userData 目录此时才可用） */
export function initFileLogging(userDataDir: string): void {
  try {
    logFile = join(userDataDir, 'logs', 'main.log')
    mkdirSync(dirname(logFile), { recursive: true })
    fileEnabled = true
  } catch (err) {
    fileEnabled = false
    logFile = null
    console.warn('[log] file logging disabled:', err)
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // 轮转失败不影响日志本身，忽略
  }
}

function writeFile(level: LogLevel, scope: string, args: unknown[]): void {
  if (!fileEnabled || !logFile) return
  try {
    const text = args
      .map((a) => {
        if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        }
        return String(a)
      })
      .join(' ')
    rotateIfNeeded(logFile)
    appendFileSync(logFile, `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${text}\n`, 'utf-8')
  } catch {
    // 落盘失败静默，避免日志拖垮主进程
  }
}

/** 创建带 scope 的 logger，输出形如 `[mpris] ...` */
export function createLogger(scope: string) {
  const emit =
    (level: LogLevel, sink: (...a: unknown[]) => void) =>
    (...args: unknown[]): void => {
      try {
        sink(`[${scope}]`, ...args)
      } catch {
        // 忽略控制台异常（例如 EPIPE：终端/tail 管道已关闭）
      }
      writeFile(level, scope, args)
    }

  return {
    debug: emit('debug', console.debug.bind(console)),
    info: emit('info', console.log.bind(console)),
    warn: emit('warn', console.warn.bind(console)),
    error: emit('error', console.error.bind(console))
  }
}

export type Logger = ReturnType<typeof createLogger>

/** 兜底：任何位置抛错都写一行日志，不静默吞掉 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`
  return String(err)
}
