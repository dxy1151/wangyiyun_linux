/**
 * 单实例锁 + `netease-music://` 深链
 *  - 首启：app.setAsDefaultProtocolClient('netease-music')（开发态需要带 execPath + 脚本路径）
 *  - 二次启动：第二实例把 argv 里的深链转发给已运行实例（second-instance 事件）
 *  - 所有深链统一解析（parseDeepLink），再通过 deeplink 事件推给渲染层
 */
import { app } from 'electron'
import { createLogger, errorText } from './logger'

const log = createLogger('protocol')

export const PROTOCOL = 'netease-music://'

export interface DeepLink {
  /** 原始 url */
  url: string
  /** 行为段：song / playlist / album / artist / search / open ... */
  action: string
  /** 主参数（歌曲 id 等） */
  id: string
  /** query 参数 */
  params: Record<string, string>
}

/** 解析深链：netease-music://song/123?x=1 → {action:'song', id:'123', params:{x:'1'}} */
export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url.toLowerCase().startsWith('netease-music:')) return null
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
    const action = segments[0] ?? parsed.hostname.toLowerCase()
    const id = segments[1] ?? ''
    const params: Record<string, string> = {}
    parsed.searchParams.forEach((v, k) => {
      params[k] = v
    })
    return { url, action, id, params }
  } catch (err) {
    log.warn('parse failed:', errorText(err), url)
    return null
  }
}

/** 从命令行参数里挑出深链（Linux：./app netease-music://song/1） */
export function findDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith('netease-music://')) return arg
  }
  return null
}

/** 注册协议（Electron 需要启动参数里带可执行文件路径才生效，见文档） */
export function registerProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL.slice(0, -3), process.execPath, [process.argv[1]])
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL.slice(0, -3))
    }
    log.info('default protocol client registered for netease-music://')
  } catch (err) {
    // 无 xdg-mime 的环境（或 AppImage 未安装到桌面）会失败，不影响运行
    log.warn('setAsDefaultProtocolClient failed:', errorText(err))
  }
}

/** 单实例锁：拿到锁返回 true；false 表示已有实例在跑，本进程应退出 */
export function acquireSingleInstanceLock(): boolean {
  try {
    return app.requestSingleInstanceLock()
  } catch (err) {
    log.error('requestSingleInstanceLock failed, continuing as sole instance:', errorText(err))
    return true
  }
}
