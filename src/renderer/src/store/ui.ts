import { create } from 'zustand'

/**
 * UI / 偏好设置 store —— 与播放引擎 store（store/player.ts，dataplayer 维护）完全独立。
 * 这里只存放：主题、侧栏折叠、音质、下载目录、关闭到托盘等界面偏好，
 * 以及跨页面的轻量 UI 状态（队列面板开合、全屏播放页主题色）。
 */

export type ThemeMode = 'dark' | 'light'
export type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export interface Settings {
  theme: ThemeMode
  /** 侧栏折叠为图标模式 */
  sidebarCollapsed: boolean
  /** 关闭窗口时最小化到托盘 */
  closeToTray: boolean
  /** 桌面通知（歌曲切换时） */
  notifications: boolean
  /** 偏好音质 */
  quality: AudioQuality
  /** 下载目录（仅展示/由主进程实际执行） */
  downloadDir: string
  /** 音量记忆交给 player store 持久化；这里仅存启动恢复用 */
  autoPlayOnStart: boolean
}

export interface UiState {
  settings: Settings
  /** 播放列表（队列）面板是否展开 */
  queueOpen: boolean
  /** 播放页背景主色（从封面取色得到） */
  accent: string
  /** 当前窗口模式 */
  windowMode: 'normal' | 'mini'
  /** 窗口是否最大化 */
  maximized: boolean
  /** 全局搜索框聚焦请求信号 */
  focusSearchSignal: number
}

interface UiActions {
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  setQueueOpen: (open: boolean) => void
  toggleQueue: () => void
  setAccent: (accent: string) => void
  setWindowMode: (mode: 'normal' | 'mini') => void
  setMaximized: (v: boolean) => void
  requestFocusSearch: () => void
  resetSettings: () => void
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  sidebarCollapsed: false,
  closeToTray: true,
  notifications: true,
  quality: 'exhigh',
  downloadDir: '~/音乐/网易云音乐',
  autoPlayOnStart: false
}

const SETTINGS_KEY = 'nt.settings'
const THEME_KEY = 'nt.theme'
const SIDEBAR_KEY = 'nt.sidebarCollapsed'

function loadSettings(): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS }
  try {
    const rawTheme = localStorage.getItem(THEME_KEY)
    if (rawTheme === 'dark' || rawTheme === 'light') base.theme = rawTheme

    const rawCollapsed = localStorage.getItem(SIDEBAR_KEY)
    if (rawCollapsed === '1') base.sidebarCollapsed = true
    if (rawCollapsed === '0') base.sidebarCollapsed = false

    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      if (parsed && typeof parsed === 'object') {
        if (parsed.theme === 'dark' || parsed.theme === 'light') base.theme = parsed.theme
        if (typeof parsed.sidebarCollapsed === 'boolean') base.sidebarCollapsed = parsed.sidebarCollapsed
        if (typeof parsed.closeToTray === 'boolean') base.closeToTray = parsed.closeToTray
        if (typeof parsed.notifications === 'boolean') base.notifications = parsed.notifications
        if (typeof parsed.autoPlayOnStart === 'boolean') base.autoPlayOnStart = parsed.autoPlayOnStart
        if (typeof parsed.downloadDir === 'string' && parsed.downloadDir) base.downloadDir = parsed.downloadDir
        if (['standard', 'higher', 'exhigh', 'lossless'].includes(String(parsed.quality))) {
          base.quality = parsed.quality as AudioQuality
        }
      }
    }
  } catch {
    /* localStorage 不可用时使用默认值 */
  }
  return base
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.getAttribute('data-theme') === theme) return
  // 临时开启颜色过渡，避免生硬切换
  root.classList.add('theme-anim')
  root.setAttribute('data-theme', theme)
  window.setTimeout(() => root.classList.remove('theme-anim'), 320)
}

const initialSettings = loadSettings()
applyTheme(initialSettings.theme)

function persist(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    localStorage.setItem(THEME_KEY, settings.theme)
    localStorage.setItem(SIDEBAR_KEY, settings.sidebarCollapsed ? '1' : '0')
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

export const useUi = create<UiState & UiActions>()((set, get) => ({
  settings: initialSettings,
  queueOpen: false,
  accent: '#ec4141',
  windowMode: 'normal',
  maximized: false,
  focusSearchSignal: 0,

  setTheme: theme => {
    if (get().settings.theme === theme) return
    applyTheme(theme)
    const next = { ...get().settings, theme }
    persist(next)
    set({ settings: next })
  },

  toggleTheme: () => {
    const nextTheme: ThemeMode = get().settings.theme === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
    const next = { ...get().settings, theme: nextTheme }
    persist(next)
    set({ settings: next })
  },

  toggleSidebar: () => {
    const next = { ...get().settings, sidebarCollapsed: !get().settings.sidebarCollapsed }
    persist(next)
    set({ settings: next })
  },

  setSetting: (key, value) => {
    const next = { ...get().settings, [key]: value }
    if (key === 'theme') applyTheme(next.theme)
    persist(next)
    set({ settings: next })
  },

  setQueueOpen: open => set({ queueOpen: open }),
  toggleQueue: () => set({ queueOpen: !get().queueOpen }),
  setAccent: accent => set({ accent }),
  setWindowMode: mode => set({ windowMode: mode }),
  setMaximized: v => set({ maximized: v }),
  requestFocusSearch: () => set({ focusSearchSignal: get().focusSearchSignal + 1 }),

  resetSettings: () => {
    const next = { ...DEFAULT_SETTINGS }
    applyTheme(next.theme)
    persist(next)
    set({ settings: next })
  }
}))

/** 便捷选择器 */
export const useTheme = (): ThemeMode => useUi(s => s.settings.theme)
export const useSidebarCollapsed = (): boolean => useUi(s => s.settings.sidebarCollapsed)

// 调试钩子：便于在开发者工具 / 自动化测试里切换窗口模式与主题
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__ntUi = {
    setWindowMode: (mode: 'normal' | 'mini') => useUi.getState().setWindowMode(mode),
    setTheme: (theme: ThemeMode) => useUi.getState().setTheme(theme),
    getState: () => useUi.getState()
  }
}
