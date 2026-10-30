import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minus, Search, Square, X } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import { navigate, useNavigate, useRoute } from '@/hooks/useRoute'
import { onWindowState, winAction, winGetState } from '@/hooks/useBridge'
import { useUi } from '@/store/ui'
import { cx } from '@/utils/format'
import './TitleBar.css'

export interface TitleBarProps {
  /** 迷你模式下隐藏标题栏 */
  hidden?: boolean
}

/** 无边框窗口自绘标题栏：拖拽区 + 前进后退 + 全局搜索 + 窗口按钮 */
export function TitleBar({ hidden = false }: TitleBarProps): JSX.Element | null {
  const route = useRoute()
  const nav = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [maximized, setMaximized] = useState(false)
  const focusSignal = useUi(s => s.focusSearchSignal)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [canBack, setCanBack] = useState(false)

  // 最大化状态同步
  useEffect(() => {
    if (hidden) return
    let alive = true
    void winGetState().then(s => {
      if (alive) setMaximized(s.maximized)
    })
    const dispose = onWindowState(s => setMaximized(!!s.maximized))
    return () => {
      alive = false
      dispose()
    }
  }, [hidden])

  // 全局聚焦搜索（Ctrl+K / 点击侧栏搜索）
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])

  // 搜索路由时回填关键词
  useEffect(() => {
    if (route.path === '/search') setKeyword(route.query.get('k') ?? '')
  }, [route.path, route.query])

  // 简化的前进/后退可用性（hash 变化即认为有历史）
  useEffect(() => {
    const onHash = (): void => setCanBack(window.history.length > 1)
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const kw = keyword.trim()
    nav(kw ? `/search?k=${encodeURIComponent(kw)}` : '/search')
    inputRef.current?.blur()
  }

  if (hidden) return null

  return (
    <header className="nt-titlebar nt-drag">
      {/* 左：前进后退 + 品牌 */}
      <div className="nt-titlebar__left nt-no-drag">
        <button
          type="button"
          className={cx('nt-titlebar__navbtn', !canBack && 'is-disabled')}
          aria-label="后退"
          title="后退"
          disabled={!canBack}
          onClick={() => window.history.back()}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="nt-titlebar__navbtn"
          aria-label="前进"
          title="前进"
          onClick={() => window.history.forward()}
        >
          <ChevronRight size={18} />
        </button>
        <span
          className="nt-titlebar__brand"
          onClick={() => navigate('/discover')}
          onKeyDown={e => {
            if (e.key === 'Enter') navigate('/discover')
          }}
          role="link"
          tabIndex={0}
          title="回到发现音乐"
        >
          <span className="nt-titlebar__logo" aria-hidden="true">
            ♪
          </span>
          <span className="nt-titlebar__name">网易云音乐</span>
        </span>
      </div>

      {/* 中：搜索框 */}
      <form className="nt-search nt-no-drag" onSubmit={submit} role="search">
        <Search size={14} className="nt-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="nt-search__input"
          type="text"
          value={keyword}
          placeholder="搜索音乐、歌手、专辑、歌单"
          aria-label="搜索"
          spellCheck={false}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setKeyword('')
              e.currentTarget.blur()
            }
          }}
        />
        {keyword && (
          <button
            type="button"
            className="nt-search__clear"
            aria-label="清空搜索"
            onClick={() => {
              setKeyword('')
              inputRef.current?.focus()
            }}
          >
            <X size={12} />
          </button>
        )}
        <kbd className="nt-search__kbd">Ctrl K</kbd>
      </form>

      {/* 右：窗口按钮 */}
      <div className="nt-titlebar__right nt-no-drag">
        <button type="button" className="nt-wbtn" aria-label="最小化" title="最小化" onClick={() => winAction('minimize')}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="nt-wbtn"
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
          onClick={() => winAction('maximize')}
        >
          {maximized ? <Square size={12} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          className="nt-wbtn nt-wbtn--close"
          aria-label="关闭"
          title="关闭"
          onClick={() => winAction('close')}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
