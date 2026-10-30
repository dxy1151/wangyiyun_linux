import { cx } from '@/utils/format'
import './Skeleton.css'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  /** 形状：block 矩形 / circle 圆形 / text 文本行 */
  variant?: 'block' | 'circle' | 'text'
  className?: string
  style?: React.CSSProperties
}

/** 骨架屏基元：shimmer 扫光 */
export function Skeleton({ width, height, radius = 8, variant = 'block', className, style }: SkeletonProps): JSX.Element {
  return (
    <div
      className={cx('nt-skeleton', `nt-skeleton--${variant}`, className)}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: variant === 'circle' ? '50%' : typeof radius === 'number' ? `${radius}px` : radius,
        ...style
      }}
      aria-hidden="true"
    />
  )
}

export interface SkeletonListProps {
  count?: number
  className?: string
}

/** 卡片网格骨架（发现页 / 搜索页用） */
export function SkeletonGrid({ count = 10, className }: SkeletonListProps): JSX.Element {
  return (
    <div className={cx('nt-skeleton-grid', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="nt-skeleton-grid__item" key={i}>
          <Skeleton height="100%" radius={12} style={{ aspectRatio: '1 / 1', height: 'auto' }} />
          <Skeleton variant="text" height={12} width="82%" style={{ marginTop: 10 }} />
          <Skeleton variant="text" height={10} width="56%" style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  )
}

/** 歌曲行骨架 */
export function SkeletonRows({ count = 12 }: SkeletonListProps): JSX.Element {
  return (
    <div className="nt-skeleton-rows" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div className="nt-skeleton-rows__row" key={i}>
          <Skeleton width={26} height={12} radius={4} />
          <Skeleton width={36} height={36} radius={6} />
          <div className="nt-skeleton-rows__main">
            <Skeleton variant="text" height={12} width={`${40 + ((i * 13) % 35)}%`} />
            <Skeleton variant="text" height={10} width={`${22 + ((i * 7) % 20)}%`} style={{ marginTop: 6 }} />
          </div>
          <Skeleton width={90} height={10} radius={4} />
          <Skeleton width={44} height={10} radius={4} />
        </div>
      ))}
    </div>
  )
}

/** 详情页头图骨架 */
export function SkeletonDetailHeader(): JSX.Element {
  return (
    <div className="nt-skeleton-header" aria-hidden="true">
      <Skeleton width={188} height={188} radius={14} />
      <div className="nt-skeleton-header__info">
        <Skeleton variant="text" height={18} width={72} />
        <Skeleton variant="text" height={26} width="58%" style={{ marginTop: 12 }} />
        <Skeleton variant="text" height={12} width="40%" style={{ marginTop: 14 }} />
        <Skeleton variant="text" height={12} width="46%" style={{ marginTop: 8 }} />
        <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
          <Skeleton width={110} height={34} radius={18} />
          <Skeleton width={96} height={34} radius={18} />
        </div>
      </div>
    </div>
  )
}

/** 通用文本块骨架 */
export function SkeletonBlock({ lines = 3, className }: { lines?: number; className?: string }): JSX.Element {
  return (
    <div className={cx('nt-skeleton-block', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton variant="text" height={12} width={i === lines - 1 ? '62%' : '100%'} key={i} style={{ marginBottom: 8 }} />
      ))}
    </div>
  )
}
