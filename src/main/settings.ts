/**
 * 设置持久化：userData/settings.json
 *  - 读取时与 DEFAULT_SETTINGS 合并（缺字段自动补默认值）
 *  - 写入时与当前值合并 + 原子写（tmp 文件 + rename，避免断电/崩溃写坏文件）
 *  - downloadDir 默认 `app.getPath('music')/网易云音乐`
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { PlayMode, Settings, ThemeMode } from '../shared/types'
import { createLogger, errorText } from './logger'

const log = createLogger('settings')

/** 默认下载子目录名（与平台音乐目录拼接） */
export const DEFAULT_DOWNLOAD_SUBDIR = '网易云音乐'

const PLAY_MODES: readonly PlayMode[] = ['order', 'repeat-one', 'shuffle', 'loop']
const THEMES: readonly ThemeMode[] = ['dark', 'light']

let cache: Settings | null = null
let writeLocked = false

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 默认下载目录 */
export function defaultDownloadDir(): string {
  return join(app.getPath('music'), DEFAULT_DOWNLOAD_SUBDIR)
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 把任意来源（磁盘 / 渲染层）的数据收敛成合法 Settings，非法字段丢弃 */
function sanitize(raw: Partial<Settings> | null | undefined, base: Settings): Settings {
  const out: Settings = { ...base }
  if (!raw || typeof raw !== 'object') return out

  if (typeof raw.theme === 'string' && THEMES.includes(raw.theme)) out.theme = raw.theme
  if (typeof raw.volume === 'number') out.volume = clamp(raw.volume, 0, 1, base.volume)
  if (typeof raw.playMode === 'string' && PLAY_MODES.includes(raw.playMode)) out.playMode = raw.playMode
  if (typeof raw.downloadDir === 'string' && raw.downloadDir.trim()) out.downloadDir = raw.downloadDir.trim()
  if (typeof raw.closeToTray === 'boolean') out.closeToTray = raw.closeToTray
  if (typeof raw.cacheLimitMB === 'number') out.cacheLimitMB = Math.round(clamp(raw.cacheLimitMB, 0, 1024 * 64, base.cacheLimitMB))

  if (!out.downloadDir) out.downloadDir = defaultDownloadDir()
  return out
}

function defaults(): Settings {
  return { ...DEFAULT_SETTINGS, downloadDir: defaultDownloadDir() }
}

function load(): Settings {
  const fallback = defaults()
  const file = settingsFile()
  try {
    if (!existsSync(file)) return fallback
    const text = readFileSync(file, 'utf-8')
    const parsed: unknown = JSON.parse(text)
    // 迁移：旧版本可能把 downloadDir 写成空串 → 回落到默认
    return sanitize(parsed as Partial<Settings>, fallback)
  } catch (err) {
    log.warn('read failed, fallback to defaults:', errorText(err))
    return fallback
  }
}

function save(next: Settings): boolean {
  if (writeLocked) return false
  let tmp = ''
  try {
    const file = settingsFile()
    mkdirSync(app.getPath('userData'), { recursive: true })
    tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
    renameSync(tmp, file)
    return true
  } catch (err) {
    writeLocked = true
    log.error('write failed (settings will only live in memory):', errorText(err))
    if (tmp) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        // ignore
      }
    }
    return false
  }
}

/** 读取设置（深拷贝，调用方可随意修改返回值） */
export function getSettings(): Settings {
  if (!cache) cache = load()
  return { ...cache }
}

/**
 * 局部更新设置，返回合并后的完整设置。
 * `beforeWrite` 在落盘前调用（窗口模块用它把 bounds 一并写进文件）。
 */
export function setSettings(patch: Partial<Settings>, beforeWrite?: (next: Settings) => void): Settings {
  const current = getSettings()
  const next = sanitize(patch, current)
  cache = next
  try {
    beforeWrite?.(next)
  } catch (err) {
    log.warn('beforeWrite hook failed:', errorText(err))
  }
  if (!save(next)) {
    // 落盘失败时允许下次再试（writeLocked 只防止日志风暴）
    writeLocked = false
  }
  return { ...next }
}

/** 直接替换缓存（窗口模块恢复 bounds 后同步用） */
export function primeSettings(s: Settings): void {
  cache = s
}

/** 当前设置文件的绝对路径（调试用） */
export function settingsPath(): string {
  return settingsFile()
}
