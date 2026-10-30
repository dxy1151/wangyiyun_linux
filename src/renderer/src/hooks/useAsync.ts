import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 通用异步数据 hook：
 * - 自动处理竞态（仅最后一次请求落地）
 * - 提供 data / loading / error / reload
 * - deps 变化时重新拉取
 * - 卸载后不再 setState
 *
 * fetcher 返回什么就拿到什么；若 api 层返回 `{code, data}` 包装，
 * 由 initApi 注入的 unwrap 统一拆开。
 */

export interface AsyncState<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
  reload: () => void
}

export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // 竞态标记
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const reqId = ++reqIdRef.current
    let alive = true
    setLoading(true)
    setError(null)

    Promise.resolve()
      .then(() => fetcherRef.current())
      .then(result => {
        if (!alive || reqId !== reqIdRef.current) return
        setData(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive || reqId !== reqIdRef.current) return
        const e = err instanceof Error ? err : new Error(String(err))
        console.warn('[useAsync] request failed:', e.message)
        setError(e)
        setLoading(false)
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])

  return { data, loading, error, reload }
}

/**
 * 分页/增量加载 hook（搜索、长列表可选用）
 * loadMore 会调用 fetchPage(page, pageSize)
 */
export function usePagedAsync<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; hasMore: boolean }>,
  deps: unknown[],
  pageSize = 30
): {
  items: T[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: Error | null
  loadMore: () => void
  reset: () => void
} {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const pageRef = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const busyRef = useRef(false)

  const load = useCallback(
    async (page: number) => {
      if (busyRef.current) return
      busyRef.current = true
      if (page === 0) {
        setLoading(true)
        setItems([])
      } else {
        setLoadingMore(true)
      }
      setError(null)
      try {
        const res = await fetchRef.current(page, pageSize)
        setItems(prev => (page === 0 ? res.items : [...prev, ...res.items]))
        setHasMore(res.hasMore)
        pageRef.current = page
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
        if (page === 0) setHasMore(false)
      } finally {
        busyRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [pageSize]
  )

  useEffect(() => {
    pageRef.current = 0
    busyRef.current = false
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return
    void load(pageRef.current + 1)
  }, [hasMore, loading, loadingMore, load])

  const reset = useCallback(() => {
    pageRef.current = 0
    busyRef.current = false
    void load(0)
  }, [load])

  return { items, loading, loadingMore, hasMore, error, loadMore, reset }
}

/** 简易防抖值 hook（搜索框输入用） */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
