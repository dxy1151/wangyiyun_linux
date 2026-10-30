import { useEffect, useMemo, useState } from 'react'
import {
  Compass,
  Download,
  HardDrive,
  Heart,
  History,
  ListMusic,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings as SettingsIcon,
  Sparkles,
  UserRound
} from 'lucide-react'
import { Cover } from '@/components/Cover'
import { LoginModal } from '@/components/LoginModal'
import { toast } from '@/components/Toast'
import { useAuth } from '@/store/auth'
import { useRoute } from '@/hooks/useRoute'
import { usePlayerView } from '@/hooks/usePlayerView'
import { useSidebarCollapsed, useUi } from '@/store/ui'
import { cx } from '@/utils/format'
import './Sidebar.css'

interface NavItem {
  path: string
  label: string
  icon: JSX.Element
  /** 匹配前缀（用于高亮） */
  match: string
}

const PRIMARY_NAV: NavItem[] = [
  { path: '/discover', label: '发现音乐', icon: <Compass size={18} />, match: '/discover' },
  { path: '/podcast', label: '私人漫游', icon: <Radio size={18} />, match: '/podcast' },
  { path: '/my', label: '我的音乐', icon: <ListMusic size={18} />, match: '/my' },
  { path: '/recent', label: '最近播放', icon: <History size={18} />, match: '/recent' },
  { path: '/local', label: '本地与下载', icon: <HardDrive size={18} />, match: '/local' },
  { path: '/settings', label: '设置', icon: <SettingsIcon size={18} />, match: '/settings' }
]

/** 左侧可折叠侧栏 */
export function Sidebar(): JSX.Element {
  const route = useRoute()
  const collapsed = useSidebarCollapsed()
  const toggleSidebar = useUi(s => s.toggleSidebar)
  const { favorites, recent } = usePlayerView()

  const isActive = (item: NavItem): boolean => route.path === item.match || route.path.startsWith(item.match + '/')

  const recentShort = useMemo(() => recent.slice(0, 6), [recent])

  return (
    <nav className={cx('nt-sidebar', collapsed && 'is-collapsed')} aria-label="主导航">
      <div className="nt-sidebar__scroll nt-scroll">
        <ul className="nt-sidebar__list">
          {PRIMARY_NAV.map(item => (
            <li key={item.path}>
              <a
                href={'#' + item.path}
                className={cx('nt-navitem', isActive(item) && 'is-active')}
                title={collapsed ? item.label : undefined}
                aria-current={isActive(item) ? 'page' : undefined}
              >
                <span className="nt-navitem__icon">{item.icon}</span>
                <span className="nt-navitem__label">{item.label}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="nt-sidebar__group">
          <div className="nt-sidebar__group-head">
            <span className="nt-sidebar__group-title">我喜欢的音乐</span>
          </div>
          <a
            href="#/my"
            className={cx('nt-sidebar__favorite', route.path === '/my' && 'is-active')}
            title={collapsed ? '我喜欢的音乐' : undefined}
          >
            <span className="nt-sidebar__favorite-icon" aria-hidden="true">
              <Heart size={16} />
            </span>
            <span className="nt-sidebar__favorite-meta">
              <span className="nt-sidebar__favorite-title">我的收藏</span>
              <span className="nt-sidebar__favorite-count">{favorites.length} 首</span>
            </span>
          </a>
        </div>

        {recentShort.length > 0 && (
          <div className="nt-sidebar__group">
            <div className="nt-sidebar__group-head">
              <span className="nt-sidebar__group-title">最近播放</span>
              <a href="#/recent" className="nt-sidebar__more">
                全部
              </a>
            </div>
            <ul className="nt-sidebar__recent">
              {recentShort.map(song => (
                <li key={`r-${song.id}`}>
                  <a href="#/recent" className="nt-sidebar__recent-item" title={song.name}>
                    <Cover src={song.picUrl || song.album?.picUrl} seed={song.id} size={24} radius={4} iconSize={11} />
                    <span className="nt-sidebar__recent-text">
                      <span className="nt-sidebar__recent-name nt-ellipsis">{song.name}</span>
                      <span className="nt-sidebar__recent-artist nt-ellipsis">
                        {song.artistText || song.artists?.map(a => a.name).join(' / ')}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="nt-sidebar__group">
          <div className="nt-sidebar__group-head">
            <span className="nt-sidebar__group-title">我的歌单</span>
            <a href="#/my" className="nt-sidebar__more">
              <Sparkles size={12} />
            </a>
          </div>
          <ul className="nt-sidebar__playlists">
            <li>
              <a href="#/local" className="nt-sidebar__pl-item">
                <span className="nt-sidebar__pl-cover nt-sidebar__pl-cover--local">
                  <Download size={14} />
                </span>
                <span className="nt-sidebar__pl-name nt-ellipsis">我的下载</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* 账号：未登录引导 / 已登录用户卡片 */}
      <UserCard collapsed={!!collapsed} />

      <button
        type="button"
        className="nt-sidebar__collapse"
        onClick={toggleSidebar}
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </nav>
  )
}


/** 侧栏底部账号卡片：未登录显示「点击登录」，已登录显示头像+昵称 */
function UserCard({ collapsed }: { collapsed: boolean }): JSX.Element {
  const { loggedIn, user, refreshSession, logout } = useAuth()
  const [open, setOpen] = useState(false)

  // 首次挂载时读取一次登录态
  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  const handleLogout = async (): Promise<void> => {
    try {
      await logout()
      toast.success('已退出登录')
    } catch {
      toast.error('退出登录失败')
    }
  }

  return (
    <div className="nt-sidebar__user">
      {loggedIn && user ? (
        <div className="nt-sidebar__user-card" title={user.nickname}>
          {user.avatarUrl ? (
            <img className="nt-sidebar__user-avatar" src={user.avatarUrl} alt={user.nickname} />
          ) : (
            <span className="nt-sidebar__user-avatar nt-sidebar__user-avatar--ph">
              <UserRound size={16} />
            </span>
          )}
          {!collapsed && (
            <span className="nt-sidebar__user-meta">
              <span className="nt-sidebar__user-name nt-ellipsis">{user.nickname}</span>
              {(user.vipType ?? 0) > 0 && <span className="nt-sidebar__user-vip">VIP</span>}
            </span>
          )}
          {!collapsed && (
            <button
              type="button"
              className="nt-sidebar__user-logout"
              onClick={handleLogout}
              title="退出登录"
              aria-label="退出登录"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="nt-sidebar__user-login"
          onClick={() => setOpen(true)}
          title="登录网易云账号"
        >
          <span className="nt-sidebar__user-avatar nt-sidebar__user-avatar--ph">
            <UserRound size={16} />
          </span>
          {!collapsed && <span className="nt-sidebar__user-name">点击登录</span>}
        </button>
      )}

      <LoginModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
