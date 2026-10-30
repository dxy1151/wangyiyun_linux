import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '@/utils/format'
import './Slider.css'

export interface ProgressSliderProps {
  /** 当前值（毫秒） */
  value: number
  /** 最大值（毫秒） */
  max: number
  onSeek: (ms: number) => void
  /** 拖动中（用于暂停歌词跟随等） */
  onScrubStart?: () => void
  onScrubEnd?: (ms: number) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

/**
 * 进度条：
 * - 支持点击定位与拖拽（pointer events，兼容触控）
 * - hover/drag 时显示滑块，并加粗已播放轨道
 * - 拖拽期间用本地值渲染，松手才 seek，避免抖动
 */
export function ProgressSlider({
  value,
  max,
  onSeek,
  onScrubStart,
  onScrubEnd,
  disabled = false,
  className,
  ariaLabel = '播放进度'
}: ProgressSliderProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const [dragValue, setDragValue] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  const safeMax = max > 0 ? max : 0
  const shown = dragging ? dragValue : value
  const ratio = safeMax > 0 ? Math.min(1, Math.max(0, shown / safeMax)) : 0

  const ratioFromEvent = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  const commit = useCallback(
    (r: number) => {
      if (safeMax <= 0) return
      onSeek(Math.round(r * safeMax))
    },
    [onSeek, safeMax]
  )

  // 全局 pointer 事件接管拖拽（指针移出轨道也能继续）
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent): void => {
      const r = ratioFromEvent(e.clientX)
      setDragValue(r * safeMax)
      setHoverRatio(r)
    }
    const onUp = (e: PointerEvent): void => {
      const r = ratioFromEvent(e.clientX)
      setDragging(false)
      onScrubEnd?.(r * safeMax)
      commit(r)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, ratioFromEvent, commit, onScrubEnd, safeMax])

  const startDrag = (e: React.PointerEvent): void => {
    if (disabled || safeMax <= 0) return
    e.preventDefault()
    const r = ratioFromEvent(e.clientX)
    setDragValue(r * safeMax)
    setDragging(true)
    setHoverRatio(r)
    onScrubStart?.()
  }

  return (
    <div
      className={cx('nt-slider', dragging && 'is-dragging', hover && 'is-hover', disabled && 'is-disabled', className)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false)
        if (!dragging) setHoverRatio(null)
      }}
    >
      <div
        ref={trackRef}
        className="nt-slider__track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={shown}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        onPointerDown={startDrag}
        onPointerMove={e => {
          if (!dragging) setHoverRatio(ratioFromEvent(e.clientX))
        }}
        onKeyDown={e => {
          if (disabled || safeMax <= 0) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onSeek(Math.min(safeMax, value + 5000))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onSeek(Math.max(0, value - 5000))
          } else if (e.key === 'Home') {
            e.preventDefault()
            onSeek(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            onSeek(safeMax)
          }
        }}
      >
        {/* 悬停指示 */}
        {hoverRatio !== null && !disabled && (
          <div className="nt-slider__hover-fill" style={{ width: `${hoverRatio * 100}%` }} />
        )}
        <div className="nt-slider__fill" style={{ width: `${ratio * 100}%` }}>
          <div className="nt-slider__thumb" />
        </div>
      </div>
    </div>
  )
}

export interface VolumeControlProps {
  /** 0 ~ 1 */
  value: number
  onChange: (v: number) => void
  onToggleMute?: () => void
  className?: string
}

/** 音量控制：图标 + 细长滑块 */
export function VolumeControl({ value, onChange, className }: VolumeControlProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)

  const ratioFromEvent = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent): void => onChange(ratioFromEvent(e.clientX))
    const onUp = (e: PointerEvent): void => {
      onChange(ratioFromEvent(e.clientX))
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, ratioFromEvent, onChange])

  const pct = Math.min(1, Math.max(0, value)) * 100

  return (
    <div className={cx('nt-volume', dragging && 'is-dragging', className)}>
      <div
        ref={trackRef}
        className="nt-volume__track"
        role="slider"
        tabIndex={0}
        aria-label="音量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        onPointerDown={e => {
          e.preventDefault()
          setDragging(true)
          onChange(ratioFromEvent(e.clientX))
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(Math.min(1, value + 0.05))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(Math.max(0, value - 0.05))
          }
        }}
      >
        <div className="nt-volume__fill" style={{ width: `${pct}%` }}>
          <span className="nt-volume__thumb" />
        </div>
      </div>
    </div>
  )
}
