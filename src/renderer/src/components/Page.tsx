import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { navigate } from '@/hooks/useRoute'
import { cx } from '@/utils/format'
import './Page.css'

/** 页面容器：统一左右内边距与最大宽度 */
export function Page({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cx('nt-page', className)}>{children}</div>
}

/** 页面大标题 */
export function PageTitle({
  title,
  subtitle,
  extra
}: {
  title: string
  subtitle?: string
  extra?: ReactNode
}): JSX.Element {
  return (
    <div className="nt-page__titlebar">
      <div className="nt-page__headings">
        <h1 className="nt-page__title">{title}</h1>
        {subtitle && <p className="nt-page__subtitle">{subtitle}</p>}
      </div>
      {extra && <div className="nt-page__extra">{extra}</div>}
    </div>
  )
}

/** 区块标题（如"推荐歌单"），支持"更多"跳转 */
export function Section({
  title,
  actionText,
  actionTo,
  onAction,
  children,
  className
}: {
  title: string
  actionText?: string
  actionTo?: string
  onAction?: () => void
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={cx('nt-section', className)}>
      <header className="nt-section__head">
        <h2 className="nt-section__title">{title}</h2>
        {(actionTo || onAction) && (
          <button
            type="button"
            className="nt-section__action"
            onClick={() => {
              if (onAction) onAction()
              else if (actionTo) navigate(actionTo)
            }}
          >
            {actionText ?? '更多'}
            <ChevronRight size={13} />
          </button>
        )}
      </header>
      {children}
    </section>
  )
}

/** 卡片网格容器 */
export function CardGrid({
  children,
  className,
  minWidth = 150
}: {
  children: ReactNode
  className?: string
  minWidth?: number
}): JSX.Element {
  return (
    <div className={cx('nt-card-grid', className)} style={{ ['--card-min' as string]: `${minWidth}px` }}>
      {children}
    </div>
  )
}
