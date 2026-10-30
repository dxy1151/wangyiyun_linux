import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'
import { cx } from '@/utils/format'
import './IconButton.css'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 图标尺寸，默认 16 */
  size?: number
  /** 变体：ghost 默认 / solid 实心红 / subtle 底衬 */
  variant?: 'ghost' | 'solid' | 'subtle'
  /** 是否激活（用于模式切换的高亮） */
  active?: boolean
  /** 圆形 */
  round?: boolean
  /** 尺寸（按钮直径） */
  dimension?: number
  label?: string
  children: ReactNode
}

/** 通用图标按钮：统一 hover / focus / active 样式 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 16, variant = 'ghost', active = false, round = false, dimension, label, children, className, style, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'nt-icon-btn',
        `nt-icon-btn--${variant}`,
        active && 'is-active',
        round && 'is-round',
        className
      )}
      style={{
        ...(dimension ? { width: dimension, height: dimension } : null),
        ...style
      }}
      {...rest}
    >
      <span className="nt-icon-btn__inner" style={{ fontSize: size }}>
        {children}
      </span>
    </button>
  )
})
