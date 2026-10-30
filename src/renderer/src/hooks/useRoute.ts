import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * 极简 hash 路由（不引入 react-router）
 *
 * 路由形态：
 *   #/discover
 *   #/search?k=关键词
 *   #/playlist/:id
 *   #/album/:id
 *   #/artist/:id
 *   #/my
 *   #/recent
 *   #/local
 *   #/settings
 *   #/player
 *
 * 支持浏览器前进/后退、页面刷新保持位置，以及编程式 navigate。
 */

export interface RouteInfo {
  /** 规范化后的路径，如 '/playlist/123'；解析失败时为 '/discover' */
  path: string
  /** 解析后的路径分段，如 ['playlist', '123'] */
  segments: string[]
  /** 查询参数 */
  query: URLSearchParams
  /** 原始 hash（不含 '#'） */
  raw: string
}

export const DEFAULT_ROUTE = '/discover'

const listeners = new Set<() => void>()
let cachedRaw: string | null = null
let cachedRoute: RouteInfo | null = null

/** 解析 location.hash → RouteInfo */
export function parseHash(hash: string): RouteInfo {
  let raw = (hash || '').replace(/^#/, '')
  if (!raw) raw = DEFAULT_ROUTE

  // 去掉可能存在的完整 URL 前缀
  const hashIndex = raw.indexOf('#/')
  if (hashIndex > 0) raw = raw.slice(hashIndex + 1)

  if (!raw.startsWith('/')) raw = '/' + raw

  const qIndex = raw.indexOf('?')
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : ''

  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map(seg => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })

  let query: URLSearchParams
  try {
    query = new URLSearchParams(queryPart)
  } catch {
    query = new URLSearchParams()
  }

  const path = '/' + segments.join('/')
  return { path: path === '/' ? DEFAULT_ROUTE : path, segments, query, raw }
}

function getSnapshot(): string {
  if (typeof window === 'undefined') return '#'
  return window.location.hash || '#'
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  listeners.forEach(l => l())
}

// 监听 hashchange / 首次加载补齐默认路由
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', emit)
  window.addEventListener('popstate', emit)
  if (!window.location.hash || window.location.hash === '#') {
    // 用 replaceState 避免产生历史记录
    window.history.replaceState(null, '', '#' + DEFAULT_ROUTE)
  }
}

/** 返回当前路由信息（订阅 hash 变化） */
export function useRoute(): RouteInfo {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => '#')
  if (raw === cachedRaw && cachedRoute) return cachedRoute
  cachedRaw = raw
  cachedRoute = parseHash(raw)
  return cachedRoute
}

export interface NavigateOptions {
  /** 替换当前历史记录，而不是新增 */
  replace?: boolean
}

function normalize(to: string): string {
  if (!to) return '#' + DEFAULT_ROUTE
  if (to.startsWith('#')) return to
  return '#' + (to.startsWith('/') ? to : '/' + to)
}

/** 编程式跳转（可用于任意位置，不必在组件内） */
export function navigate(to: string, options: NavigateOptions = {}): void {
  if (typeof window === 'undefined') return
  const target = normalize(to)
  if (target === (window.location.hash || '#')) {
    // 同一路由重复点击：手动通知一次，方便需要滚回顶部的场景
    emit()
    return
  }
  if (options.replace) {
    window.history.replaceState(null, '', target)
    emit()
  } else {
    window.location.hash = target
  }
}

/** 组件内使用的 navigate（稳定引用） */
export function useNavigate(): (to: string, options?: NavigateOptions) => void {
  return useCallback((to: string, options?: NavigateOptions) => navigate(to, options), [])
}

/** 返回某个路由对应的完整 hash 字符串，用于 <a href> 或跳转 */
export function href(to: string): string {
  return normalize(to)
}

/**
 * 生成链接构造器，便于在列表里批量生成子路由
 * buildPath('/playlist/', id) → '/playlist/123'
 */
export function buildPath(base: string, id: string | number): string {
  return base.replace(/\/$/, '') + '/' + encodeURIComponent(String(id))
}
