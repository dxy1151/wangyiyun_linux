import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, X, WifiOff } from 'lucide-react'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar } from '@/components/Sidebar'
import { PlayerBar } from '@/components/PlayerBar'
import { QueuePanel } from '@/components/QueuePanel'
import { MiniPlayer } from '@/components/MiniPlayer'
import { ContextMenuHost } from '@/components/ContextMenu'
import { ToastContainer } from '@/components/Toast'
import { EmptyState } from '@/components/EmptyState'
import { ScrollArea } from '@/components/ScrollArea'
import { navigate, useRoute } from '@/hooks/useRoute'
import { onWindowMode, onWindowState, setWindowMode } from '@/hooks/useBridge'
import { getPlayerState, player, subscribePlayer } from '@/hooks/usePlayerView'
import { useUi } from '@/store/ui'
import { initPlayer } from '@/store/player'
import { cx } from '@/utils/format'

import { DiscoverPage } from '@/pages/DiscoverPage'
import { SearchPage } from '@/pages/SearchPage'
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage'
import { AlbumDetailPage } from '@/pages/AlbumDetailPage'
import { ArtistDetailPage } from '@/pages/ArtistDetailPage'
import { MyMusicPage } from '@/pages/MyMusicPage'
import { RecentPage } from '@/pages/RecentPage'
import { LocalDownloadPage } from '@/pages/LocalDownloadPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { PlayerPage } from '@/pages/PlayerPage'
import './App.css'

/* ------------------------------------------------------------------ */
/* 路由 → 页面                                                          */
/* ------------------------------------------------------------------ */

function RouteView(): JSX.Element {
  const route = useRoute()

  switch (route.segments[0]) {
    case 'discover':
      return <DiscoverPage />
    case 'search':
      return <SearchPage />
    case 'playlist':
      return <PlaylistDetailPage />
    case 'album':
      return <AlbumDetailPage />
    case 'artist':
      return <ArtistDetailPage />
    case 'my':
      return <MyMusicPage />
    case 'recent':
      return <RecentPage />
    case 'local':
      return <LocalDownloadPage />
    case 'settings':
      return <SettingsPage />
    case 'player':
      return <PlayerPage />
    case 'podcast':
      return (
        <ScrollArea padding={0}>
          <EmptyState
            kind="empty"
            title="私人漫游即将上线"
            description="根据你的收听偏好，为你挑选更合口味的音乐"
            action={
              <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => navigate('/discover')}>
                先去发现音乐
              </button>
            }
          />
        </ScrollArea>
      )
    default:
      return <DiscoverPage />
  }
}

/* ------------------------------------------------------------------ */
/* 网络横幅                                                             */
/* ------------------------------------------------------------------ */

function NetworkBanner(): JSX.Element | null {
  const [banner, setBanner] = useState<{ message: string; level: 'info' | 'warn' | 'error' } | null>(null)

  useEffect(() => {
    const sync = (): void => {
      const s = getPlayerState()
      if (s.networkBanner) setBanner({ message: s.networkBanner, level: s.bannerLevel })
      else setBanner(null)
    }
    sync()
    return subscribePlayer(sync)
  }, [])

  if (!banner) return null

  const Icon =
    banner.level === 'error' ? <WifiOff size={15} /> : banner.level === 'warn' ? <AlertTriangle size={15} /> : <Info size={15} />

  return (
    <div className={cx('nt-netbanner', `is-${banner.level}`)} role="status">
      <span className="nt-netbanner__icon">{Icon}</span>
      <span className="nt-netbanner__msg">{banner.message}</span>
      <button type="button" className="nt-netbanner__retry" onClick={() => player.retryCurrent()}>
        重试
      </button>
      <button
        type="button"
        className="nt-netbanner__close"
        aria-label="关闭提示"
        onClick={() => {
          player.dismissBanner()
          setBanner(null)
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 全局快捷键                                                           */
/* ------------------------------------------------------------------ */

const NAV_SHORTCUTS: Record<string, string> = {
  '1': '/discover',
  '2': '/my',
  '3': '/recent',
  '4': '/local',
  '5': '/settings'
}

function useGlobalShortcuts(): void {
  const requestFocusSearch = useUi(s => s.requestFocusSearch)
  const toggleQueue = useUi(s => s.toggleQueue)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // Ctrl+K 聚焦搜索
      if (mod && key === 'k') {
        e.preventDefault()
        requestFocusSearch()
        return
      }

      // Ctrl+Shift+M 迷你模式切换
      if (mod && e.shiftKey && key === 'm') {
        e.preventDefault()
        const next = useUi.getState().windowMode === 'mini' ? 'normal' : 'mini'
        setWindowMode(next)
        useUi.getState().setWindowMode(next)
        return
      }

      // Ctrl+L 打开播放列表
      if (mod && key === 'l') {
        e.preventDefault()
        toggleQueue()
        return
      }

      // 输入框内不触发播放快捷键
      if (typing && !mod) return

      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        player.toggle()
        return
      }
      if (mod && e.key === 'ArrowRight') {
        e.preventDefault()
        player.next()
        return
      }
      if (mod && e.key === 'ArrowLeft') {
        e.preventDefault()
        player.prev()
        return
      }
      if (mod && e.key === 'ArrowUp') {
        e.preventDefault()
        player.setVolume(Math.min(1, getPlayerState().volume + 0.05))
        return
      }
      if (mod && e.key === 'ArrowDown') {
        e.preventDefault()
        player.setVolume(Math.max(0, getPlayerState().volume - 0.05))
        return
      }

      // Ctrl+1..5 切换主导航
      if (mod && !e.shiftKey && NAV_SHORTCUTS[e.key]) {
        e.preventDefault()
        navigate(NAV_SHORTCUTS[e.key])
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestFocusSearch, toggleQueue])
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App(): JSX.Element {
  const route = useRoute()
  const windowMode = useUi(s => s.windowMode)
  const setWindowModeState = useUi(s => s.setWindowMode)
  const setQueueOpen = useUi(s => s.setQueueOpen)

  // 初始化播放引擎（恢复上次队列 + 后台探测音源），只执行一次
  useEffect(() => {
    try {
      initPlayer()
    } catch (err) {
      console.warn('[app] initPlayer failed', err)
    }
  }, [])

  // 窗口模式变化同步到 UI 状态
  useEffect(() => {
    const disposeMode = onWindowMode(mode => setWindowModeState(mode))
    const disposeState = onWindowState(() => void 0)
    return () => {
      disposeMode()
      disposeState()
    }
  }, [setWindowModeState])

  // 路由变化：滚动回顶部 + 关闭队列面板
  useEffect(() => {
    setQueueOpen(false)
    const scroller = document.querySelector('.nt-app__content .nt-scrollarea')
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0
  }, [route.path, route.query, setQueueOpen])

  useGlobalShortcuts()

  // 播放页 Esc 返回
  useEffect(() => {
    if (route.path !== '/player') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (window.history.length > 1) window.history.back()
        else navigate('/discover', { replace: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.path])

  // 迷你模式：全窗只渲染迷你播放器
  if (windowMode === 'mini') {
    return (
      <>
        <MiniPlayer />
        <ContextMenuHost />
        <ToastContainer />
      </>
    )
  }

  return (
    <div className="nt-app">
      <TitleBar />
      <div className="nt-app__body">
        <Sidebar />
        <main className="nt-app__main">
          <NetworkBanner />
          <div className="nt-app__content" key={route.path}>
            <RouteView />
          </div>
        </main>
      </div>
      <PlayerBar />
      <QueuePanel />
      <ContextMenuHost />
      <ToastContainer />
    </div>
  )
}
