/* eslint-disable */
/**
 * 图标生成器：无第三方依赖，用 zlib 手写 PNG。
 * 风格：近黑底 + 圆角红色播放/音符 + 云朵。
 * 用法：node scripts/gen-icon.mjs [size] [outFile]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = Number(process.argv[2] ?? 512)
const OUT = resolve(__dirname, '..', process.argv[3] ?? 'build/icon.png')

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// ---------- 绘制（4x 超采样抗锯齿） ----------
const SS = 4
const W = SIZE * SS
const H = SIZE * SS
const px = new Float32Array(W * H * 4) // rgba 0..1，预乘不考虑

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** 圆角矩形 sdf（<0 内部） */
function sdfRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r)
  const qy = Math.abs(y - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function sdfCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r
}

/** 胶囊（线段 + 半径）sdf */
function sdfCapsule(x, y, ax, ay, bx, by, r) {
  const pax = x - ax
  const pay = y - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

/** 云朵：若干圆的并集（sdf 近似取 min），k 为 0..1 坐标 */
function sdfCloud(k, x, y) {
  const S = W
  let d = sdfCircle(x, y, S * 0.5, S * 0.62, S * 0.25)
  d = Math.min(d, sdfCircle(x, y, S * 0.5 - S * 0.19, S * 0.68, S * 0.155))
  d = Math.min(d, sdfCircle(x, y, S * 0.5 + S * 0.19, S * 0.67, S * 0.175))
  d = Math.min(d, sdfRoundRect(x, y, S * 0.5, S * 0.7, S * 0.34, S * 0.08, S * 0.08))
  return d
}

const RED = [236, 65, 65]
const RED_TOP = [255, 106, 92]
const DARK = [18, 18, 18]
const DARK2 = [30, 26, 30]

function paint(x, y) {
  const nx = x / W
  const ny = y / H
  // 底色：圆角方形 + 径向渐变
  const bg = sdfRoundRect(x, y, W / 2, H / 2, W / 2, H / 2, W * 0.22)
  const bgA = clamp(0.5 - bg / (1.6 * SS))
  if (bgA <= 0) return [0, 0, 0, 0]

  const d = Math.hypot(nx - 0.5, ny - 0.42) / 0.9
  let r = mix(DARK2[0], DARK[0], clamp(d)) / 255
  let g = mix(DARK2[1], DARK[1], clamp(d)) / 255
  let b = mix(DARK2[2], DARK[2], clamp(d)) / 255

  // 顶部红色氛围光
  const glow = clamp(1 - Math.hypot(nx - 0.5, ny - 0.05) / 0.62)
  r = mix(r, 0.42, glow * glow * 0.8)
  g = mix(g, 0.07, glow * glow * 0.8)
  b = mix(b, 0.08, glow * glow * 0.8)

  // 红色圆环
  const ringD = Math.abs(sdfCircle(x, y, W * 0.5, H * 0.5, W * 0.383)) - W * 0.02
  const ringA = clamp(0.5 - ringD / (1.6 * SS))
  const ringT = clamp((ny - 0.12) / 0.82)
  r = mix(r, mix(0.32, RED_TOP[0] / 255, ringT), ringA)
  g = mix(g, mix(0.05, RED_TOP[1] / 255, ringT), ringA)
  b = mix(b, mix(0.05, RED_TOP[2] / 255, ringT), ringA)

  // 云朵
  const cd = sdfCloud(0, x, y)
  const ca = clamp(0.5 - cd / (1.6 * SS))
  const ct = clamp((ny - 0.34) / 0.5)
  r = mix(r, mix(1.0, 0.93, ct), ca)
  g = mix(g, mix(0.98, 0.9, ct), ca)
  b = mix(b, mix(0.97, 0.9, ct), ca)

  // 八分音符（杆 + 符头 + 符尾旗），坐标按 512 归一后缩放
  const u = W / 512
  const stemA = clamp(0.5 - sdfCapsule(x, y, 300 * u, 120 * u, 300 * u, 372 * u, 21 * u) / (1.6 * SS))
  const nr = clamp(0.5 - sdfCircle(x, y, 256 * u, 372 * u, 56 * u) / (1.6 * SS))
  let flagD = 1e9
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const fx = (300 + 128 * Math.sin(t * 1.25)) * u
    const fy = (120 + 150 * t) * u
    flagD = Math.min(flagD, sdfCircle(x, y, fx, fy, (34 - 14 * t) * u))
  }
  const flagA = clamp(0.5 - flagD / (1.6 * SS))
  const noteA = Math.max(stemA, nr, flagA)
  r = mix(r, RED[0] / 255, noteA)
  g = mix(g, RED[1] / 255, noteA)
  b = mix(b, RED[2] / 255, noteA)

  // 内描边高光（靠近边缘一圈浅色）
  const edge = smoothstep(0, 6 * SS, -bg) * (1 - smoothstep(6 * SS, 18 * SS, -bg))
  r = mix(r, 1, edge * 0.06)
  g = mix(g, 1, edge * 0.06)
  b = mix(b, 1, edge * 0.06)

  return [r, g, b, bgA]
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = paint(x + 0.5, y + 0.5)
    const i = (y * W + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = a
  }
}

// 降采样
const out = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4
        const pa = px[i + 3]
        r += px[i] * pa
        g += px[i + 1] * pa
        b += px[i + 2] * pa
        a += pa
      }
    }
    const n = SS * SS
    const o = (y * SIZE + x) * 4
    if (a > 0) {
      out[o] = Math.round(clamp(r / a) * 255)
      out[o + 1] = Math.round(clamp(g / a) * 255)
      out[o + 2] = Math.round(clamp(b / a) * 255)
    }
    out[o + 3] = Math.round((a / n) * 255)
  }
}

// 组装 PNG（每行前置 filter byte 0）
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`icon written: ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`)
