import { useEffect, useMemo, useRef } from 'react'
import { Music2 } from 'lucide-react'
import type { LyricLine } from '@/utils/format'
import { cx, formatDuration } from '@/utils/format'
import { usePlayerView } from '@/hooks/usePlayerView'
import './LyricsView.css'

export interface LyricsViewProps {
  lines: LyricLine[]
  /** 当前播放时间（毫秒） */
  progress: number
  /** 是否显示译文 */
  showTranslation?: boolean
  /** 垂直对齐：center 居中（播放页） / top 顶部（侧栏） */
  align?: 'center' | 'top'
  /** 点击某行 → 跳转 */
  onSeekLine?: (ms: number) => void
  className?: string
  /** 字体大小缩放 */
  scale?: number
  /** 空歌词提示 */
  emptyText?: string
}

/** 找到当前行（二分） */
export function findLineIndex(lines: LyricLine[], time: number): number {
  if (!lines.length) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * 滚动歌词：
 * - 当前行高亮（渐变文字）+ 自动居中滚动
 * - 点击某行跳转
 * - 无歌词显示提示
 */
export function LyricsView({
  lines,
  progress,
  showTranslation = true,
  align = 'center',
  onSeekLine,
  className,
  scale = 1,
  emptyText = '纯音乐，请欣赏'
}: LyricsViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)
  const activeIndex = useMemo(() => findLineIndex(lines, progress), [lines, progress])

  // 自动滚动到当前行
  useEffect(() => {
    const container = containerRef.current
    const active = activeRef.current
    if (!container || !active) return
    const targetTop = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top: Math.max(0, targetTop), behavior: reduce ? 'auto' : 'smooth' })
  }, [activeIndex, lines.length])

  if (!lines.length) {
    return (
      <div className={cx('nt-lyrics', 'is-empty', align === 'top' && 'is-top', className)}>
        <div className="nt-lyrics__empty">
          <Music2 size={30} strokeWidth={1.4} />
          <p>{emptyText}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cx('nt-lyrics', align === 'top' && 'is-top', className)}
      style={{ ['--lyric-scale' as string]: String(scale) }}
      role="list"
      aria-label="歌词"
    >
      <div className="nt-lyrics__spacer" aria-hidden="true" />
      {lines.map((line, i) => {
        const isActive = i === activeIndex
        const isNear = Math.abs(i - activeIndex) <= 2
        return (
          <div
            key={`${line.time}-${i}`}
            ref={isActive ? activeRef : undefined}
            className={cx('nt-lyrics__line', isActive && 'is-active', isNear && 'is-near')}
            role="listitem"
            tabIndex={onSeekLine ? 0 : -1}
            onClick={() => onSeekLine?.(line.time)}
            onKeyDown={e => {
              if (e.key === 'Enter') onSeekLine?.(line.time)
            }}
            aria-current={isActive ? 'true' : undefined}
          >
            <span className="nt-lyrics__text">{line.text}</span>
            {showTranslation && line.translation && (
              <span className="nt-lyrics__translation">{line.translation}</span>
            )}
          </div>
        )
      })}
      <div className="nt-lyrics__spacer" aria-hidden="true" />
    </div>
  )
}

/** 播放栏内嵌的迷你歌词（单行/双行滚动） */
export function MiniLyrics({ className }: { className?: string }): JSX.Element {
  const { lyrics, lyricIndex, progress, duration } = usePlayerView()

  const current = lyricIndex >= 0 ? lyrics[lyricIndex] : undefined
  const nextLine = lyricIndex + 1 < lyrics.length ? lyrics[lyricIndex + 1] : undefined

  if (!lyrics.length) {
    return (
      <div className={cx('nt-minilyrics', 'is-empty', className)}>
        <span className="nt-minilyrics__line">{duration > 0 ? formatDuration(progress) : ''}</span>
      </div>
    )
  }

  return (
    <div className={cx('nt-minilyrics', className)} aria-live="off">
      <span className="nt-minilyrics__line is-current nt-ellipsis">{current?.text ?? ''}</span>
      {nextLine && <span className="nt-minilyrics__line is-next nt-ellipsis">{nextLine.text}</span>}
    </div>
  )
}
