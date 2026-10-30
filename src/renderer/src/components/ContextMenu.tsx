import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { cx } from '@/utils/format'
import './ContextMenu.css'

export interface MenuItem {
  /** 唯一 id */
  key: string
  /** 菜单文案 */
  label: string
  icon?: React.ReactNode
  /** 右侧辅助文案 */
  hint?: string
  /** 危险样式（删除等） */
  danger?: boolean
  disabled?: boolean
  /** 分隔线（label 忽略） */
  divider?: boolean
  /** 子菜单 */
  children?: MenuItem[]
  onClick?: () => void
}

interface MenuPosition {
  x: number
  y: number
}

interface MenuState extends MenuPosition {
  items: MenuItem[]
}

/** 全局单例：openContextMenu(event, items) */
let openFn: ((pos: MenuPosition, items: MenuItem[]) => void) | null = null

export function openContextMenu(e: React.MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]): void {
  if (!items.length || !openFn) return
  const ev = e as Partial<React.MouseEvent>
  ev.preventDefault?.()
  ev.stopPropagation?.()
  openFn({ x: e.clientX, y: e.clientY }, items)
}

export const contextMenu = { open: openContextMenu }

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }): JSX.Element {
  const [openSub, setOpenSub] = useState<{ key: string; top: number; left: number } | null>(null)

  return (
    <ul className="nt-menu" role="menu">
      {items.map(item => {
        if (item.divider) return <li key={item.key} className="nt-menu__divider" role="separator" />
        const isOpen = openSub?.key === item.key
        return (
          <li key={item.key} role="none">
            <div
              className={cx(
                'nt-menu__item',
                item.danger && 'is-danger',
                item.disabled && 'is-disabled',
                isOpen && 'is-open'
              )}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onMouseEnter={e => {
                if (item.children?.length && !item.disabled) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setOpenSub({ key: item.key, top: rect.top - 5, left: rect.right + 2 })
                } else {
                  setOpenSub(null)
                }
              }}
              onClick={() => {
                if (item.disabled || item.children?.length) return
                const fn = item.onClick
                onDone()
                fn?.()
              }}
            >
              {item.icon && <span className="nt-menu__icon">{item.icon}</span>}
              <span className="nt-menu__label">{item.label}</span>
              {item.hint && <span className="nt-menu__hint">{item.hint}</span>}
              {item.children?.length ? <ChevronRight size={14} className="nt-menu__arrow" /> : null}
            </div>
            {isOpen && item.children?.length ? (
              <div className="nt-menu-floating nt-menu-floating--nested" style={{ top: openSub.top, left: openSub.left }}>
                <MenuList items={item.children} onDone={onDone} />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/** 在 App 根部渲染一次，提供跨组件右键菜单 */
export function ContextMenuHost(): JSX.Element | null {
  const [state, setState] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<MenuPosition>({ x: -9999, y: -9999 })

  const close = useCallback(() => setState(null), [])

  useEffect(() => {
    openFn = (p, items) => {
      setPos(p)
      setState({ ...p, items })
    }
    return () => {
      openFn = null
    }
  }, [])

  // 视口内定位修正
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = Math.max(8, Math.min(pos.x, vw - rect.width - 8))
    const y = Math.max(8, Math.min(pos.y, vh - rect.height - 8))
    if (x !== pos.x || y !== pos.y) setPos({ x, y })
    // 仅在菜单打开时修正一次，避免与 setPos 形成循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    if (!state) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      const el = document.querySelector('.nt-menu-floating')
      if (el && el.contains(target)) return
      if (!document.body.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
    }
  }, [state, close])

  if (!state) return null

  return createPortal(
    <div
      ref={menuRef}
      className="nt-menu-floating"
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={e => e.preventDefault()}
    >
      <MenuList items={state.items} onDone={close} />
    </div>,
    document.body
  )
}
