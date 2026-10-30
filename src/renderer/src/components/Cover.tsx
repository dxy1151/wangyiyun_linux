import { useEffect, useMemo, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cx } from '@/utils/format'
import './Cover.css'

export interface CoverProps {
  /** 图片地址 */
  src?: string | null
  /** 占位种子（通常是 song/album id），用于生成稳定的渐变 */
  seed?: string | number
  /** 圆角尺寸 */
  radius?: number | string
  /** 是否圆形（歌手头像 / 播放栏旋转封面） */
  round?: boolean
  /** 尺寸：传数字则宽高相等 */
  size?: number | string
  /** 占位音符图标大小 */
  iconSize?: number
  className?: string
  /** 额外加载 2x 清晰度参数 */
  scale?: number
  alt?: string
  /** 给外层加阴影 */
  shadow?: boolean
}

/**
 * 封面组件：
 * - lazy 加载 + 淡入
 * - 加载失败/无图 → CSS 渐变占位 + 音符图标
 * - 支持任意 src（http/https/data），不强校验域名
 */
export function Cover({
  src,
  seed = '',
  radius = 10,
  round = false,
  size,
  iconSize = 26,
  className,
  scale = 1,
  alt = '',
  shadow = false
}: CoverProps): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const url = useMemo(() => normalizeImageUrl(src, scale), [src, scale])

  // src 变化时重置状态
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [url])

  // 已缓存图片可能不会触发 onLoad，挂载后补查
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete) {
      if (img.naturalWidth > 0) setLoaded(true)
      else if (url) setFailed(true)
    }
  }, [url])

  const gradient = useMemo(() => gradientFromSeed(seed), [seed])
  const showImage = !!url && !failed

  const dimensionStyle: Record<string, string> = {}
  if (size !== undefined) {
    dimensionStyle.width = typeof size === 'number' ? `${size}px` : size
    dimensionStyle.height = typeof size === 'number' ? `${size}px` : size
  }

  const radiusStyle = round ? '50%' : typeof radius === 'number' ? `${radius}px` : radius

  return (
    <div
      className={cx('nt-cover', round && 'is-round', shadow && 'has-shadow', className)}
      style={{ ...dimensionStyle, background: gradient, borderRadius: radiusStyle }}
      data-loaded={loaded || failed}
    >
      {showImage && (
        <img
          ref={imgRef}
          className={cx('nt-cover__img', loaded && 'is-loaded')}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}

      {/* 占位：渐变 + 音符图标 */}
      {(!loaded || !showImage) && (
        <div className="nt-cover__placeholder" aria-hidden="true">
          <Music2 size={iconSize} strokeWidth={1.5} />
        </div>
      )}

      {/* 加载中的 shimmer 扫光 */}
      {!loaded && showImage && <div className="nt-cover__shimmer" aria-hidden="true" />}
    </div>
  )
}

/** 拼接网易云图片清晰度参数（不改变其它图床的 URL） */
export function normalizeImageUrl(src: string | null | undefined, scale = 1): string | undefined {
  if (!src || typeof src !== 'string') return undefined
  let url = src.trim()
  if (!url) return undefined
  // 协议相对地址补 https
  if (url.startsWith('//')) url = 'https:' + url
  if (url.startsWith('http://')) url = 'https://' + url.slice(7)
  // 去重已有尺寸参数
  url = url.replace(/\?param=\d+y\d+/, '')
  if (scale > 1 && /(p\d+\.music\.126\.net|music\.126\.net|126\.net\/)/.test(url)) {
    const px = Math.min(1024, Math.round(256 * scale))
    return `${url}?param=${px}y${px}`
  }
  return url
}

/** 稳定哈希 → 渐变（与 useBridge.gradientFor 保持一致语义） */
export function gradientFromSeed(seed: string | number): string {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  const h2 = (h + 52) % 360
  return `linear-gradient(135deg, hsl(${h} 52% 40%), hsl(${h2} 60% 24%))`
}
