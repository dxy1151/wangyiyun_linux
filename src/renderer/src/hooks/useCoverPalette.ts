import { useEffect, useState } from 'react'
import { gradientFromSeed } from '@/components/Cover'

/**
 * 从封面地址提取主色，用于播放页背景取色。
 * - 用 canvas 读取（同源/允许 CORS 的图片才能读像素；失败则退化为种子渐变）
 * - 返回 { color, gradient }
 */
export interface CoverPalette {
  /** 主色（rgb 字符串） */
  color: string
  /** 第二个色（用于渐变） */
  color2: string
  /** 可直接用作 background 的渐变 */
  gradient: string
}

const FALLBACK = '#ec4141'

function runExtract(src: string): Promise<{ color: string; color2: string }> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const done = (r: { color: string; color2: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const timer = window.setTimeout(() => done({ color: FALLBACK, color2: '#8c1f1f' }), 4000)

    img.onload = () => {
      window.clearTimeout(timer)
      try {
        const size = 24
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return done({ color: FALLBACK, color2: '#8c1f1f' })
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)

        // 粗略聚类：收集饱和度足够的像素，加权平均；同时统计最亮/最暗
        let r = 0
        let g = 0
        let b = 0
        let weight = 0
        let r2 = 0
        let g2 = 0
        let b2 = 0
        let w2 = 0
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i]
          const pg = data[i + 1]
          const pb = data[i + 2]
          const pa = data[i + 3]
          if (pa < 100) continue
          const max = Math.max(pr, pg, pb)
          const min = Math.min(pr, pg, pb)
          const sat = max === 0 ? 0 : (max - min) / max
          const lum = (0.299 * pr + 0.587 * pg + 0.114 * pb) / 255
          // 避开纯黑纯白
          const norm = lum > 0.08 && lum < 0.96 ? 1 : 0.25
          const w = (0.35 + sat) * norm
          r += pr * w
          g += pg * w
          b += pb * w
          weight += w
          // 次色：取与主色差异较大的像素（近似：取更亮的）
          if (lum > 0.5) {
            r2 += pr
            g2 += pg
            b2 += pb
            w2 += 1
          }
        }
        if (weight < 1) return done({ color: FALLBACK, color2: '#8c1f1f' })
        const c1 = `rgb(${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)})`
        const c2 =
          w2 > 10
            ? `rgb(${Math.round(r2 / w2)}, ${Math.round(g2 / w2)}, ${Math.round(b2 / w2)})`
            : `rgb(${Math.round((r / weight) * 0.55)}, ${Math.round((g / weight) * 0.55)}, ${Math.round((b / weight) * 0.55)})`
        done({ color: c1, color2: c2 })
      } catch {
        // CORS 污染 canvas → 退化为种子渐变色
        done({ color: FALLBACK, color2: '#8c1f1f' })
      }
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      done({ color: FALLBACK, color2: '#8c1f1f' })
    }
    img.src = src
  })
}

const cache = new Map<string, { color: string; color2: string }>()

export function useCoverPalette(src: string | undefined | null, seed?: string | number): CoverPalette {
  const [palette, setPalette] = useState<CoverPalette>(() => {
    if (!src) return fromSeed(seed)
    const hit = cache.get(src)
    return hit ? { ...hit, gradient: `linear-gradient(140deg, ${hit.color}, ${hit.color2})` } : fromSeed(seed)
  })

  useEffect(() => {
    if (!src) {
      setPalette(fromSeed(seed))
      return
    }
    const hit = cache.get(src)
    if (hit) {
      setPalette({ ...hit, gradient: `linear-gradient(140deg, ${hit.color}, ${hit.color2})` })
      return
    }
    let alive = true
    void runExtract(src).then(res => {
      cache.set(src, res)
      if (alive) setPalette({ ...res, gradient: `linear-gradient(140deg, ${res.color}, ${res.color2})` })
    })
    return () => {
      alive = false
    }
  }, [src, seed])

  return palette
}

function fromSeed(seed: string | number | undefined): CoverPalette {
  const g = gradientFromSeed(seed ?? 'nt')
  return { color: FALLBACK, color2: '#8c1f1f', gradient: g }
}
