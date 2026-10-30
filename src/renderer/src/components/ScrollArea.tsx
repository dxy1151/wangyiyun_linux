import { forwardRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { cx } from '@/utils/format'
import './ScrollArea.css'

export interface ScrollAreaProps {
  children: ReactNode
  className?: string
  /** 内边距 */
  padding?: string | number
  style?: CSSProperties
  /** 是否整体撑满（flex:1 + min-height:0） */
  grow?: boolean
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  /** 隐藏滚动条但保留滚动能力 */
  hideBar?: boolean
}

/** 滚动容器：统一美化滚动条 + overflow 策略 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { children, className, padding, style, grow = true, onScroll, hideBar = false },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx('nt-scroll', 'nt-scrollarea', grow && 'is-grow', hideBar && 'hide-bar', className)}
      style={{
        padding: typeof padding === 'number' ? `${padding}px` : padding,
        ...style
      }}
      onScroll={onScroll}
    >
      {children}
    </div>
  )
})
