/**
 * 统一 fetch 封装：超时(8s) + 重试(1 次) + 内存 LRU + localStorage 持久化缓存
 *
 * 约束：
 *  - **永不抛出未捕获异常**：所有失败路径都返回 { ok:false, error }，由调用方做降级。
 *  - 渲染层直连 music.163.com 时浏览器会强制带 Origin/UA，因此官方接口必须带
 *    `User-Agent` + `Referer: https://music.163.com`（Electron 渲染进程可设置；
 *    普通浏览器会忽略这两个头但不一定报错，见 docs/api-notes.md）。
 *  - 缓存分两级：内存 LRU（快）+ localStorage（跨刷新，只存较小的热门数据）。
 */

export interface RequestOptions {
  /** 超时毫秒，默认 8000 */
  timeout?: number
  /** 额外重试次数，默认 1 */
  retries?: number
  /** 自定义 headers */
  headers?: Record<string, string>
  /** 请求方法，默认 GET */
  method?: 'GET' | 'POST'
  /** 是否跳过缓存 */
  noCache?: boolean
  /** 是否写入 localStorage（大对象应关闭，如歌单 tracks） */
  persist?: boolean
  /** 缓存存活时间毫秒，默认 5 分钟 */
  ttl?: number
  /** 响应类型：json 默认；text 用于 LRC/纯文本 */
  as?: 'json' | 'text'
  /** 外部中止信号 */
  signal?: AbortSignal
}

export interface RequestResult<T> {
  ok: boolean
  data: T | null
  status: number
  error?: string
  /** 是否命中缓存 */
  cached?: boolean
  /** 耗时（毫秒） */
  ms: number
}

const DEFAULT_TIMEOUT = 8000
const MEMORY_LIMIT = 160
const LS_PREFIX = 'nt.cache:'
const LS_INDEX_KEY = 'nt.cache.index'
const LS_MAX_ENTRIES = 80
/** localStorage 单条上限（约 1.5MB，超出不落盘） */
const LS_MAX_BYTES = 1_500_000

/* ------------------------------ 内存 LRU ------------------------------ */

interface MemEntry {
  data: unknown
  expires: number
}

const memory = new Map<string, MemEntry>()

function memGet(key: string): unknown | undefined {
  const hit = memory.get(key)
  if (!hit) return undefined
  if (hit.expires < Date.now()) {
    memory.delete(key)
    return undefined
  }
  // 触碰即刷新为最新（LRU：Map 保持插入顺序）
  memory.delete(key)
  memory.set(key, hit)
  return hit.data
}

function memSet(key: string, data: unknown, ttl: number): void {
  memory.set(key, { data, expires: Date.now() + ttl })
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next()
    if (oldest.done) break
    memory.delete(oldest.value)
  }
}

/* --------------------------- localStorage 层 --------------------------- */

function lsAvailable(): boolean {
  try {
    const k = '__nt_probe__'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

const HAS_LS = typeof window !== 'undefined' && lsAvailable()

interface LsIndex {
  [key: string]: { expires: number; at: number }
}

function lsReadIndex(): LsIndex {
  if (!HAS_LS) return {}
  try {
    const raw = window.localStorage.getItem(LS_INDEX_KEY)
    return raw ? (JSON.parse(raw) as LsIndex) : {}
  } catch {
    return {}
  }
}

function lsWriteIndex(index: LsIndex): void {
  if (!HAS_LS) return
  try {
    window.localStorage.setItem(LS_INDEX_KEY, JSON.stringify(index))
  } catch {
    /* 配额满：清掉一半再试一次 */
    try {
      pruneLs(true)
      window.localStorage.setItem(LS_INDEX_KEY, JSON.stringify(lsReadIndex()))
    } catch {
      /* 忽略 */
    }
  }
}

function lsGet<T>(key: string): T | undefined {
  if (!HAS_LS) return undefined
  const index = lsReadIndex()
  const meta = index[key]
  if (!meta) return undefined
  if (meta.expires < Date.now()) {
    try {
      window.localStorage.removeItem(LS_PREFIX + key)
      delete index[key]
      lsWriteIndex(index)
    } catch {
      /* ignore */
    }
    return undefined
  }
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key)
    if (!raw) return undefined
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function lsSet(key: string, data: unknown, ttl: number): void {
  if (!HAS_LS) return
  try {
    const raw = JSON.stringify(data)
    if (raw.length > LS_MAX_BYTES) return
    const index = lsReadIndex()
    index[key] = { expires: Date.now() + ttl, at: Date.now() }
    // 超出条目上限：先淘汰最旧的
    const keys = Object.keys(index)
    if (keys.length > LS_MAX_ENTRIES) {
      keys
        .sort((a, b) => index[a].at - index[b].at)
        .slice(0, keys.length - LS_MAX_ENTRIES)
        .forEach(k => {
          delete index[k]
          window.localStorage.removeItem(LS_PREFIX + k)
        })
    }
    window.localStorage.setItem(LS_PREFIX + key, raw)
    lsWriteIndex(index)
  } catch {
    // 配额超限：清理过期项后重试一次
    pruneLs(true)
    try {
      const raw = JSON.stringify(data)
      if (raw.length <= LS_MAX_BYTES) {
        window.localStorage.setItem(LS_PREFIX + key, raw)
        const index = lsReadIndex()
        index[key] = { expires: Date.now() + ttl, at: Date.now() }
        lsWriteIndex(index)
      }
    } catch {
      /* 放弃持久化，内存缓存仍在 */
    }
  }
}

/** 清理过期（或全部）localStorage 缓存 */
export function pruneLs(all = false): number {
  if (!HAS_LS) return 0
  const index = lsReadIndex()
  const now = Date.now()
  let removed = 0
  for (const key of Object.keys(index)) {
    if (all || index[key].expires < now) {
      try {
        window.localStorage.removeItem(LS_PREFIX + key)
      } catch {
        /* ignore */
      }
      delete index[key]
      removed++
    }
  }
  lsWriteIndex(index)
  return removed
}

/** 清空全部缓存（内存 + localStorage） */
export function clearApiCache(): void {
  memory.clear()
  pruneLs(true)
}

/** 当前缓存条目数（调试/设置页展示） */
export function cacheStats(): { memory: number; persist: number } {
  return { memory: memory.size, persist: Object.keys(lsReadIndex()).length }
}

/* ------------------------------ 请求核心 ------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function errText(err: unknown): string {
  if (!err) return 'unknown error'
  const e = err as { name?: string; message?: string }
  if (e.name === 'AbortError') return 'timeout'
  return e.message ?? String(err)
}

/**
 * 发起一次请求（带缓存）。
 * 永远 resolve，不会 reject。
 */
export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<RequestResult<T>> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = 1,
    headers = {},
    method = 'GET',
    noCache = false,
    persist = false,
    ttl = 5 * 60_000,
    as = 'json',
    signal
  } = options

  const cacheKey = `${method} ${as} ${url}`
  if (!noCache) {
    const mem = memGet(cacheKey)
    if (mem !== undefined) return { ok: true, data: mem as T, status: 200, cached: true, ms: 0 }
    if (persist) {
      const disk = lsGet<T>(cacheKey)
      if (disk !== undefined) {
        memSet(cacheKey, disk, Math.min(ttl, 60_000))
        return { ok: true, data: disk, status: 200, cached: true, ms: 0 }
      }
    }
  }

  const started = Date.now()
  let lastError = 'unknown'
  let lastStatus = 0

  for (let attempt = 0; attempt <= retries; attempt++) {
    // 优先用 AbortSignal.timeout（不会把超时 AbortError 冒泡成 unhandledrejection）
    const timeoutSignal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeout) : null
    const ctrl = timeoutSignal ? null : new AbortController()
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0
    const combined = timeoutSignal ?? ctrl!.signal
    const onOuterAbort = (): void => ctrl?.abort()
    signal?.addEventListener('abort', onOuterAbort)
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json, text/plain, */*', ...headers },
        signal: combined,
        // 不携带 Cookie，避免与服务端登录态冲突（也规避 CORS 凭证要求）
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store'
      })
      lastStatus = res.status
      const text = await res.text()
      if (!res.ok) {
        lastError = `HTTP ${res.status}`
        // 4xx（除 429）不值得重试
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break
      } else {
        let data: unknown = text
        if (as === 'json') {
          try {
            data = JSON.parse(text)
          } catch {
            lastError = 'invalid json'
            data = null
          }
        }
        if (data !== null && data !== undefined) {
          memSet(cacheKey, data, ttl)
          if (persist) lsSet(cacheKey, data, ttl)
          return { ok: true, data: data as T, status: res.status, ms: Date.now() - started }
        }
      }
    } catch (err) {
      lastError = errText(err)
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
    if (attempt < retries) await sleep(300 * (attempt + 1))
  }

  return { ok: false, data: null, status: lastStatus, error: lastError, ms: Date.now() - started }
}

/** 便捷：请求 JSON，失败返回 null（不抛异常） */
export async function getJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T | null> {
  const r = await request<T>(url, { ...options, as: 'json' })
  return r.ok ? r.data : null
}

/** 便捷：请求文本（LRC 等） */
export async function getText(url: string, options: RequestOptions = {}): Promise<string | null> {
  const r = await request<string>(url, { ...options, as: 'text' })
  return r.ok && typeof r.data === 'string' ? r.data : null
}
