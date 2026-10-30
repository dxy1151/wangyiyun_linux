import { create } from 'zustand'
import type { Playlist } from '@/api/types'
import {
  authAvailable,
  authGetSession,
  authLogout,
  authMyPlaylists,
  authQrCreate,
  authQrPoll,
  authSetCookie,
  onAuthChanged
} from '@/hooks/useBridge'
import type { AuthQrResult, AuthUser } from '@/store/authTypes'

/**
 * 登录态 store
 * - 会话由 desktop 主进程持久化（cookie 存于主进程），渲染层只做展示与触发
 * - authMyPlaylists 结果缓存于此，供「我的音乐」页与侧栏复用
 */

interface AuthState {
  /** 后端能力是否就绪（desktop 未落地时为 false） */
  available: boolean
  loggedIn: boolean
  user: AuthUser | null
  /** 最近一次错误信息 */
  error: string | null
  /** 是否正在读取会话 */
  loading: boolean

  /** 我创建的歌单 */
  created: Playlist[]
  /** 我收藏的歌单 */
  subscribed: Playlist[]
  /** 歌单是否加载中 */
  playlistsLoading: boolean
  /** 歌单错误 */
  playlistsError: string | null

  /* —— actions —— */
  refreshSession: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  logout: () => Promise<void>
  loginByCookie: (cookie: string) => Promise<{ ok: boolean; error?: string }>
  /** 登录成功后的统一收尾（更新本地态 + 拉歌单） */
  applyLoggedIn: (user: AuthUser) => Promise<void>
  /** 订阅主进程的登录态变化（只订阅一次） */
  bindAuthEvents: () => () => void
}

export const useAuth = create<AuthState>()((set, get) => ({
  available: false,
  loggedIn: false,
  user: null,
  error: null,
  loading: true,

  created: [],
  subscribed: [],
  playlistsLoading: false,
  playlistsError: null,

  refreshSession: async () => {
    set({ loading: true })
    const avail = authAvailable()
    const session = await authGetSession()
    set({
      available: avail,
      loading: false,
      loggedIn: !!session.loggedIn && !!session.user,
      user: session.user ?? null,
      error: session.error ?? null
    })
    if (session.loggedIn && session.user) {
      void get().refreshPlaylists()
    }
  },

  refreshPlaylists: async () => {
    if (!get().loggedIn) {
      set({ created: [], subscribed: [] })
      return
    }
    set({ playlistsLoading: true, playlistsError: null })
    try {
      const res = await authMyPlaylists()
      set({
        created: res.created,
        subscribed: res.subscribed,
        playlistsLoading: false
      })
    } catch (err) {
      set({
        playlistsLoading: false,
        playlistsError: err instanceof Error ? err.message : '歌单加载失败'
      })
    }
  },

  logout: async () => {
    const ok = await authLogout()
    if (ok || !authAvailable()) {
      set({ loggedIn: false, user: null, created: [], subscribed: [], error: null })
    }
  },

  loginByCookie: async (cookie: string) => {
    const res = await authSetCookie(cookie.trim())
    if (res.ok && res.user) {
      set({ loggedIn: true, user: res.user, error: null })
      void get().refreshPlaylists()
      return { ok: true }
    }
    const error = res.error ?? '登录失败，请检查 Cookie 是否有效'
    set({ error })
    return { ok: false, error }
  },

  applyLoggedIn: async user => {
    set({ loggedIn: true, user, error: null })
    await get().refreshPlaylists()
  },

  bindAuthEvents: () => {
    return onAuthChanged(s => {
      if (s.loggedIn && s.user) {
        const u = s.user as AuthUser
        set({ loggedIn: true, user: u, error: null })
        void get().refreshPlaylists()
      } else {
        set({ loggedIn: false, user: null, created: [], subscribed: [] })
      }
    })
  }
}))

/* ------------------------------ 二维码登录流程 ------------------------------ */

export interface QrState {
  /** 二维码图片 dataURL */
  qrDataUrl: string | null
  unikey: string | null
  status: 800 | 801 | 802 | 803 | null
  message: string
  /** 是否正在创建二维码 */
  creating: boolean
}

/** 创建一张新二维码 */
export async function createQr(): Promise<QrState> {
  const res: AuthQrResult | null = await authQrCreate()
  if (!res) {
    return {
      qrDataUrl: null,
      unikey: null,
      status: 800,
      message: '当前环境不支持扫码登录，请改用 Cookie 登录',
      creating: false
    }
  }
  return {
    qrDataUrl: res.qrDataUrl,
    unikey: res.unikey,
    status: 801,
    message: '请使用网易云音乐 App 扫码',
    creating: false
  }
}

/** 轮询一次二维码状态 */
export async function pollQr(unikey: string): Promise<{ status: 800 | 801 | 802 | 803; message: string; user?: AuthUser } | null> {
  const res = await authQrPoll(unikey)
  if (!res) return null
  return { status: res.status, message: res.message, user: res.user }
}
