import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { cx } from '@/utils/format'
import './Carousel.css'

export interface CarouselItem {
  id: number | string
  /** 大图（背景） */
  image: string
  /** 标题 */
  title: string
  /** 副标题 */
  subtitle?: string
  /** 点击跳转路由 */
  href?: string
  /** 播放回调（优先于 href） */
  onPlay?: () => void
}

export interface CarouselProps {
  items: CarouselItem[]
  /** 自动轮播间隔，0 关闭 */
  interval?: number
  className?: string
  height?: number
}

/**
 * 首页轮播：
 * - 自动播放 + hover 暂停
 * - 左右箭头 + 指示点
 * - 背景大图 + 渐变遮罩 + 内容卡片
 */
export function Carousel({ items, interval = 5200, className, height = 200 }: CarouselProps): JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const count = items.length

  const go = useCallback(
    (i: number) => {
      if (count === 0) return
      setIndex(((i % count) + count) % count)
    },
    [count]
  )

  const next = useCallback(() => go(index + 1), [go, index])
  const prev = useCallback(() => go(index - 1), [go, index])

  useEffect(() => {
    if (!interval || paused || count <= 1) return
    timerRef.current = window.setInterval(() => setIndex(i => (i + 1) % count), interval)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [interval, paused, count])

  // 数据变化时修正越界
  useEffect(() => {
    if (index >= count) setIndex(0)
  }, [count, index])

  if (!count) return null

  return (
    <section
      className={cx('nt-carousel', className)}
      style={{ height }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="推荐轮播"
    >
      <div className="nt-carousel__track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {items.map(item => (
          <div className="nt-carousel__slide" key={item.id} aria-hidden={items[index]?.id !== item.id}>
            <div className="nt-carousel__bg" style={{ backgroundImage: `url("${item.image}")` }} />
            <div className="nt-carousel__scrim" />
            <div className="nt-carousel__content">
              <div className="nt-carousel__thumb">
                <Cover src={item.image} seed={item.id} radius={10} iconSize={26} alt={item.title} />
              </div>
              <div className="nt-carousel__text">
                <h2 className="nt-carousel__title nt-clamp-2">{item.title}</h2>
                {item.subtitle && <p className="nt-carousel__sub nt-clamp-2">{item.subtitle}</p>}
                <button
                  type="button"
                  className="nt-carousel__play"
                  onClick={() => {
                    if (item.onPlay) item.onPlay()
                    else if (item.href) window.location.hash = '#' + item.href
                  }}
                >
                  <Play size={13} fill="currentColor" />
                  立即播放
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {count > 1 && (
        <>
          <button type="button" className="nt-carousel__arrow is-prev" aria-label="上一张" onClick={prev}>
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="nt-carousel__arrow is-next" aria-label="下一张" onClick={next}>
            <ChevronRight size={20} />
          </button>
          <div className="nt-carousel__dots" role="tablist" aria-label="轮播指示器">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`第 ${i + 1} 张`}
                className={cx('nt-carousel__dot', i === index && 'is-active')}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
