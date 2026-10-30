/**
 * 渲染层通用工具函数
 */

/** 毫秒 → mm:ss（超过 1 小时为 h:mm:ss） */
export function formatDuration(ms: number | undefined | null): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 播放量格式化：1234 → 1234, 12345 → 1.2万, 123456789 → 1.2亿 */
export function formatCount(n: number | undefined | null): string {
  if (!n || !Number.isFinite(n)) return '0'
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 10_000) return (n / 10_000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(Math.round(n))
}

/** 发布时间戳 → YYYY-MM-DD */
export function formatDate(ts: number | string | undefined | null): string {
  if (!ts) return ''
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 毫秒 → "x分钟前 / x小时前 / x天前" */
export function timeAgo(ts: number | undefined | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatDate(ts)
}

/** 拼接艺术家名（容忍多种字段形态） */
export function joinArtists(
  artists: Array<{ name?: string } | string> | string | undefined | null,
  sep = ' / '
): string {
  if (!artists) return '未知歌手'
  if (typeof artists === 'string') return artists || '未知歌手'
  if (Array.isArray(artists)) {
    const names = artists
      .map(a => (typeof a === 'string' ? a : a?.name))
      .filter((n): n is string => !!n && n.trim().length > 0 && n !== 'undefined')
    return names.length ? names.join(sep) : '未知歌手'
  }
  return '未知歌手'
}

/** 去掉网易云歌词里的翻译/罗马音等额外字段，返回纯文本 */
export function plainText(html: string | undefined | null): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/** 限制数值范围 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 数组按 size 分块 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** 类名拼接（轻量 clsx） */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(p => typeof p === 'string' && p.length > 0).join(' ')
}

/** 秒 → 毫秒（歌词用），已是毫秒则原样返回 */
export function toMs(v: number): number {
  return v < 1000 ? Math.round(v * 1000) : Math.round(v)
}

export interface LyricLine {
  time: number
  text: string
  translation?: string
}

/**
 * 解析 LRC 文本。
 * 兼容："[00:12.34]歌词"、"[00:12.345]歌词"、多时间标签、[t]/[ar:] 等元信息；
 * 若每行末尾带翻译格式（同一时间戳两行），把第二个非空文本作为 translation。
 */
export function parseLrc(raw: string | undefined | null): LyricLine[] {
  if (!raw || typeof raw !== 'string') return []
  const lines: LyricLine[] = []
  const timeTag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  const rawLines = raw.split(/\r?\n/)
  const byTime = new Map<number, LyricLine>()

  for (const line of rawLines) {
    if (!line) continue
    // 跳过元信息行 [ti:xxx] [ar:] [by:] [offset:]
    if (/^\s*\[(ti|ar|al|by|offset|length|kana|re|ve):/i.test(line)) continue
    const tags: Array<{ time: number }> = []
    let m: RegExpExecArray | null
    timeTag.lastIndex = 0
    while ((m = timeTag.exec(line)) !== null) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const fracRaw = m[3] ?? '0'
      const frac = parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10)
      tags.push({ time: min * 60_000 + sec * 1000 + frac })
    }
    if (!tags.length) continue
    const text = line.replace(timeTag, '').trim()
    if (!text) continue
    for (const tag of tags) {
      const existing = byTime.get(tag.time)
      if (existing) {
        if (!existing.translation) existing.translation = text
      } else {
        const entry: LyricLine = { time: tag.time, text }
        byTime.set(tag.time, entry)
        lines.push(entry)
      }
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines.filter(l => l.text && l.text.trim().length > 0)
}

/** 根据当前播放进度找到歌词行索引（二分） */
export function lyricIndexAt(lines: LyricLine[], timeMs: number): number {
  if (!lines.length) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= timeMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 从 CSS 颜色或种子得到 rgba */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    if ([r, g, b].some(Number.isNaN)) return color
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
  return color
}

/** 简易哈希 → 稳定索引 */
export function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
