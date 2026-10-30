/**
 * 下载（net 模块流式下载）
 *
 * 契约（shared/types.ts）：
 *   download:save ({id,url,filename}) -> Promise<DownloadResult>
 *   download:cancel (id)              -> void
 *   事件 download:progress {id,received,total}
 *
 * 关键点：
 *  - 用 Electron `net.request`：走系统代理 / 证书 / cookie 策略，比 http.request 更稳
 *  - 网易云外链（gdstudio → 126.net）会重定向，net 会跟随重定向，但 URL 可能变化 → 打印最终 URL
 *  - 带 User-Agent 与 Referer（music.163.com），否则 126.net 可能 403
 *  - 目标目录不存在自动 mkdir -p；重名自动加 (1)(2) 序号
 *  - 进度节流推送（默认 200ms 一条），避免 IPC 洪水
 *  - 取消：中止请求 + 删除残留的 .part 文件
 */
import { app, net } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { IPC_EVENT } from '../shared/ipc'
import type { DownloadProgress, DownloadRequest, DownloadResult } from '../shared/types'
import { createLogger, errorText } from './logger'
import { getSettings } from './settings'
import { sendToRenderer } from './window'

const log = createLogger('download')

const PROGRESS_INTERVAL_MS = 200
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const REFERER = 'https://music.163.com/'

interface ActiveDownload {
  id: string
  request: Electron.ClientRequest
  stream: WriteStream | null
  partPath: string
  targetPath: string
  received: number
  total: number
  lastEmit: number
  canceled: boolean
  done: boolean
  resolve: (r: DownloadResult) => void
}

const active = new Map<string, ActiveDownload>()

/** 过滤路径分隔符 / 非法字符（Linux 只禁 '/'，NUL 由 Node 抛错，一并过滤） */
function sanitizeFilename(raw: string | undefined, fallback = 'track.mp3'): string {
  const base = basename(String(raw ?? '').trim()).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim()
  if (!base || base === '.' || base === '..') return fallback
  // 过长文件名会失败（Linux 单段 255 字节），保守截断
  if (Buffer.byteLength(base) > 200) {
    const ext = extname(base)
    const cut = 200 - Buffer.byteLength(ext)
    let head = base.slice(0, base.length - ext.length)
    while (Buffer.byteLength(head) > cut) head = head.slice(0, -1)
    return `${head}${ext}`
  }
  return base
}

/** 目标目录：settings.downloadDir 优先，非法/不可写则回落到 音乐目录/网易云音乐 */
function ensureDownloadDir(): string {
  const candidates: string[] = []
  try {
    const s = getSettings()
    if (s.downloadDir) candidates.push(isAbsolute(s.downloadDir) ? s.downloadDir : resolve(s.downloadDir))
  } catch (err) {
    log.warn('read settings failed:', errorText(err))
  }
  candidates.push(join(app.getPath('music'), '网易云音乐'))
  candidates.push(app.getPath('downloads'))

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true })
      statSync(dir)
      return dir
    } catch (err) {
      log.warn(`download dir unusable: ${dir}`, errorText(err))
    }
  }
  throw new Error('no writable download directory')
}

/** 同名文件加 (1)(2)... 序号 */
function uniquePath(dir: string, filename: string): string {
  const name = sanitizeFilename(filename)
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  let i = 1
  while (existsSync(candidate) || [...active.values()].some((a) => a.targetPath === candidate)) {
    candidate = join(dir, `${stem} (${i})${ext}`)
    i++
    if (i > 9999) {
      candidate = join(dir, `${stem} (${Date.now()})${ext}`)
      break
    }
  }
  return candidate
}

/**
 * Electron 的 IncomingMessage（net 模块）在类型上未声明流控制方法，
 * 但运行时它就是可读流。统一走这里做最小强转，避免调用点散落 any。
 */
type ReadableLike = { pause(): void; resume(): void }

function asReadable(res: unknown): ReadableLike {
  return res as ReadableLike
}

function pause(res: unknown): void {
  try {
    asReadable(res).pause()
  } catch {
    // 流已结束
  }
}

function resume(res: unknown): void {
  try {
    asReadable(res).resume()
  } catch {
    // 流已结束
  }
}

/** 丢弃响应体（例如错误状态码），避免连接悬挂 */
function drain(res: unknown): void {
  try {
    asReadable(res).resume()
  } catch {
    // ignore
  }
}

function emitProgress(d: ActiveDownload, force = false): void {
  const now = Date.now()
  if (!force && now - d.lastEmit < PROGRESS_INTERVAL_MS) return
  d.lastEmit = now
  const payload: DownloadProgress = { id: d.id, received: d.received, total: d.total }
  sendToRenderer(IPC_EVENT.DOWNLOAD_PROGRESS, payload)
}

function finish(d: ActiveDownload, result: DownloadResult): void {
  if (d.done) return
  d.done = true
  active.delete(d.id)
  try {
    d.stream?.end()
  } catch {
    // ignore
  }
  if (!result.ok && existsSync(d.partPath)) {
    try {
      rmSync(d.partPath, { force: true })
    } catch {
      // ignore
    }
  }
  emitProgress(d, true)
  d.resolve(result)
}

/**
 * 开始下载。任何异常都会变成 {ok:false, error} 返回，不会 reject（渲染层无需 try/catch）。
 */
export function saveDownload(req: DownloadRequest): Promise<DownloadResult> {
  return new Promise<DownloadResult>((resolve) => {
    const id = String(req?.id ?? '')
    const url = String(req?.url ?? '')
    if (!id) {
      resolve({ ok: false, error: 'missing download id' })
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      resolve({ ok: false, error: `unsupported url: ${url}` })
      return
    }
    if (active.has(id)) {
      resolve({ ok: false, error: `download ${id} already in progress` })
      return
    }

    let targetDir: string
    try {
      targetDir = ensureDownloadDir()
    } catch (err) {
      resolve({ ok: false, error: errorText(err) })
      return
    }
    const targetPath = uniquePath(targetDir, req.filename)
    const partPath = `${targetPath}.part`

    let request: Electron.ClientRequest
    try {
      request = net.request({ method: 'GET', url, redirect: 'follow', useSessionCookies: true })
      request.setHeader('User-Agent', USER_AGENT)
      request.setHeader('Referer', REFERER)
      request.setHeader('Accept', '*/*')
      // 禁用压缩，保证 received/total 与文件字节数一致
      request.setHeader('Accept-Encoding', 'identity')
    } catch (err) {
      resolve({ ok: false, error: errorText(err) })
      return
    }

    const d: ActiveDownload = {
      id,
      request,
      stream: null,
      partPath,
      targetPath,
      received: 0,
      total: 0,
      lastEmit: 0,
      canceled: false,
      done: false,
      resolve
    }
    active.set(id, d)

    request.on('response', (response) => {
      try {
        const status = response.statusCode
        log.info(`GET ${url} -> ${status} (len=${response.headers['content-length'] ?? '?'})`)
        if (status < 200 || status >= 300) {
          drain(response)
          finish(d, { ok: false, error: `HTTP ${status}` })
          return
        }
        const len = Number(response.headers['content-length'])
        d.total = Number.isFinite(len) && len > 0 ? len : 0

        try {
          d.stream = createWriteStream(partPath, { flags: 'w' })
        } catch (err) {
          drain(response)
          finish(d, { ok: false, error: `cannot open file: ${errorText(err)}` })
          return
        }

        d.stream.on('error', (err) => {
          log.error('write stream error:', errorText(err))
          try {
            request.abort()
          } catch {
            // ignore
          }
          finish(d, { ok: false, error: `write failed: ${errorText(err)}` })
        })
        d.stream.on('finish', () => {
          if (d.done) return
          if (d.canceled) {
            finish(d, { ok: false, error: 'canceled' })
            return
          }
          if (d.total > 0 && d.received < d.total) {
            finish(d, { ok: false, error: `incomplete download (${d.received}/${d.total})` })
            return
          }
          try {
            // rename 覆盖：targetPath 在开始时已确保唯一
            renameSync(partPath, targetPath)
          } catch (err) {
            finish(d, { ok: false, error: `rename failed: ${errorText(err)}` })
            return
          }
          log.info(`saved ${targetPath} (${d.received} bytes)`)
          finish(d, { ok: true, path: targetPath })
        })

        response.on('data', (chunk: Buffer) => {
          if (d.canceled || d.done) return
          d.received += chunk.length
          if (!d.stream!.write(chunk)) {
            pause(response)
            d.stream!.once('drain', () => {
              if (!d.canceled && !d.done) resume(response)
            })
          }
          emitProgress(d)
        })
        response.on('end', () => {
          if (d.canceled) {
            finish(d, { ok: false, error: 'canceled' })
            return
          }
          try {
            d.stream?.end()
          } catch {
            // finish 事件会兜底
          }
        })
        response.on('error', (err: Error) => {
          log.error('response error:', errorText(err))
          finish(d, { ok: false, error: errorText(err) })
        })
      } catch (err) {
        finish(d, { ok: false, error: errorText(err) })
      }
    })

    request.on('error', (err: Error) => {
      log.error('request error:', errorText(err))
      finish(d, { ok: false, error: errorText(err) })
    })
    request.on('abort', () => {
      if (!d.done) finish(d, { ok: false, error: 'canceled' })
    })

    emitProgress(d, true)
    request.end()
  })
}

/** 取消下载（download:cancel） */
export function cancelDownload(id: string): void {
  const d = active.get(String(id))
  if (!d) {
    log.warn('cancel: unknown id', id)
    return
  }
  log.info('cancel download', id)
  d.canceled = true
  try {
    d.request.abort()
  } catch (err) {
    log.warn('abort failed:', errorText(err))
  }
  finish(d, { ok: false, error: 'canceled' })
}

/** 退出前清理正在下载的任务 */
export function abortAllDownloads(): void {
  for (const [, d] of active) {
    d.canceled = true
    try {
      d.request.abort()
    } catch {
      // ignore
    }
    finish(d, { ok: false, error: 'app quitting' })
  }
  active.clear()
}

export function activeDownloadCount(): number {
  return active.size
}
