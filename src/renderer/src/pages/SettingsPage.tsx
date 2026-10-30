import { useEffect, useState } from 'react'
import {
  Bell,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Keyboard,
  Moon,
  Palette,
  RotateCcw,
  Sun,
  Trash2,
  Volume2,
  Wifi
} from 'lucide-react'
import { ConfirmDialog } from '@/components/Modal'
import { Page, PageTitle, Section } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { toast } from '@/components/Toast'
import type { AudioQuality } from '@/store/ui'
import { useUi } from '@/store/ui'
import { appVersion, clearCache, isElectron, pickFolder } from '@/hooks/useBridge'
import { usePlayerView } from '@/hooks/usePlayerView'
import { PLAY_MODE_LABEL, audioCacheStats, clearAudioCache } from '@/store/player'
import { formatCount, cx } from '@/utils/format'
import './Settings.css'

const QUALITY_OPTIONS: Array<{ key: AudioQuality; label: string; desc: string }> = [
  { key: 'standard', label: '标准', desc: '128 kbps · 省流量' },
  { key: 'higher', label: '较高', desc: '192 kbps · 均衡' },
  { key: 'exhigh', label: '极高', desc: '320 kbps · 推荐' },
  { key: 'lossless', label: '无损', desc: '取决于音源' }
]

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: 'Space', desc: '播放 / 暂停' },
  { keys: 'Ctrl →', desc: '下一首' },
  { keys: 'Ctrl ←', desc: '上一首' },
  { keys: 'Ctrl ↑ / ↓', desc: '音量增减' },
  { keys: 'Ctrl K', desc: '聚焦搜索框' },
  { keys: 'Ctrl 1-5', desc: '切换主导航' },
  { keys: 'Ctrl Shift M', desc: '切换迷你播放器' },
  { keys: 'Esc', desc: '关闭弹层 / 退出播放页' }
]

/** 设置页：主题 / 音质 / 下载 / 托盘 / 缓存 / 快捷键 */
export function SettingsPage(): JSX.Element {
  const settings = useUi(s => s.settings)
  const setSetting = useUi(s => s.setSetting)
  const resetSettings = useUi(s => s.resetSettings)
  const { networkBanner, demoMode, audioSource, volume, mode } = usePlayerView()

  const [cacheStats, setCacheStats] = useState<{ count: number; bytes: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // 读取音频缓存统计
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const stats = await audioCacheStats()
        if (alive) setCacheStats(stats)
      } catch {
        /* 统计不可用则隐藏 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const cacheMb = cacheStats ? cacheStats.bytes / (1024 * 1024) : 0

  const doClearCache = async (): Promise<void> => {
    let ok = false
    try {
      await clearAudioCache()
      ok = true
    } catch {
      /* ignore */
    }
    // 同时尝试清理网络层（localStorage）缓存
    try {
      const ok2 = await clearCache()
      ok = ok || ok2
    } catch {
      /* ignore */
    }
    setCacheStats({ count: 0, bytes: 0 })
    toast[ok ? 'success' : 'info'](ok ? '缓存已清理' : '当前环境无可清理缓存')
  }

  return (
    <ScrollArea padding={0}>
      <Page className="nt-settings">
        <PageTitle title="设置" subtitle="个性化你的网易云音乐" />

        {/* 主题 */}
        <Section title="外观">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Palette size={16} />
                <div>
                  <span className="nt-settings-row__title">主题</span>
                  <span className="nt-settings-row__desc">切换深色 / 浅色配色</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <div className="nt-seg">
                  <button
                    type="button"
                    className={cx('nt-seg__item', settings.theme === 'dark' && 'is-active')}
                    onClick={() => setSetting('theme', 'dark')}
                  >
                    <Moon size={14} />
                    深色
                  </button>
                  <button
                    type="button"
                    className={cx('nt-seg__item', settings.theme === 'light' && 'is-active')}
                    onClick={() => setSetting('theme', 'light')}
                  >
                    <Sun size={14} />
                    浅色
                  </button>
                </div>
              </div>
            </div>

            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Palette size={16} />
                <div>
                  <span className="nt-settings-row__title">折叠侧栏</span>
                  <span className="nt-settings-row__desc">只显示图标，获得更大内容区</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <Switch
                  checked={settings.sidebarCollapsed}
                  onChange={v => setSetting('sidebarCollapsed', v)}
                  label="折叠侧栏"
                />
              </div>
            </div>
          </div>
        </Section>

        {/* 播放 */}
        <Section title="播放">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Volume2 size={16} />
                <div>
                  <span className="nt-settings-row__title">音质</span>
                  <span className="nt-settings-row__desc">音质越高，消耗流量越多</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <div className="nt-seg nt-seg--wrap">
                  {QUALITY_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      title={opt.desc}
                      className={cx('nt-seg__item', settings.quality === opt.key && 'is-active')}
                      onClick={() => {
                        setSetting('quality', opt.key)
                        toast.success(`音质已设为「${opt.label}」`)
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Bell size={16} />
                <div>
                  <span className="nt-settings-row__title">歌曲切换通知</span>
                  <span className="nt-settings-row__desc">切歌时显示系统通知</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <Switch
                  checked={settings.notifications}
                  onChange={v => setSetting('notifications', v)}
                  label="歌曲切换通知"
                />
              </div>
            </div>

            <div className="nt-settings-row nt-settings-row--info">
              <span className="nt-settings-row__desc">
                当前播放模式：<strong>{PLAY_MODE_LABEL[mode] ?? mode}</strong> · 音量：<strong>{Math.round(volume * 100)}%</strong>
              </span>
            </div>
          </div>
        </Section>

        {/* 窗口与托盘 */}
        <Section title="窗口与托盘">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Download size={16} />
                <div>
                  <span className="nt-settings-row__title">关闭时最小化到托盘</span>
                  <span className="nt-settings-row__desc">点击关闭按钮时隐藏到系统托盘，而不是退出应用</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <Switch
                  checked={settings.closeToTray}
                  onChange={v => setSetting('closeToTray', v)}
                  label="关闭时最小化到托盘"
                />
              </div>
            </div>

            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <FolderOpen size={16} />
                <div>
                  <span className="nt-settings-row__title">下载目录</span>
                  <span className="nt-settings-row__desc nt-ellipsis" title={settings.downloadDir}>
                    {settings.downloadDir}
                  </span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <button
                  type="button"
                  className="nt-btn nt-btn--soft nt-btn--sm"
                  onClick={() => {
                    void pickFolder().then(dir => {
                      if (dir) {
                        setSetting('downloadDir', dir)
                        toast.success('下载目录已更新')
                      } else {
                        toast.info('未选择目录')
                      }
                    })
                  }}
                >
                  选择目录
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* 缓存 */}
        <Section title="缓存">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <HardDrive size={16} />
                <div>
                  <span className="nt-settings-row__title">音频与封面缓存</span>
                  <span className="nt-settings-row__desc">
                    {cacheStats
                      ? `${cacheStats.count} 个文件 · ${cacheMb >= 1 ? cacheMb.toFixed(1) + ' MB' : formatCount(cacheStats.bytes) + ' B'}`
                      : '正在统计…'}
                  </span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <button type="button" className="nt-btn nt-btn--danger nt-btn--sm" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={13} />
                  清除缓存
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* 网络诊断 */}
        <Section title="网络状态">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <Wifi size={16} />
                <div>
                  <span className="nt-settings-row__title">音源连通性</span>
                  <span className="nt-settings-row__desc">
                    {networkBanner
                      ? networkBanner
                      : demoMode
                        ? '当前处于演示模式，音频可能无法播放'
                        : `正常${audioSource ? ` · 来源：${audioSource}` : ''}`}
                  </span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <span className={cx('nt-settings__dot', networkBanner || demoMode ? 'is-warn' : 'is-ok')} />
                <span className="nt-settings__status">
                  {networkBanner || demoMode ? '受限' : '良好'}
                </span>
              </div>
            </div>
          </div>
        </Section>

        {/* 快捷键 */}
        <Section title="快捷键">
          <div className="nt-settings-card">
            <div className="nt-shortcuts">
              {SHORTCUTS.map(s => (
                <div className="nt-shortcuts__row" key={s.keys}>
                  <kbd className="nt-shortcuts__kbd">{s.keys}</kbd>
                  <span className="nt-shortcuts__desc">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* 关于 */}
        <Section title="关于">
          <div className="nt-settings-card">
            <div className="nt-about">
              <div className="nt-about__logo">♪</div>
              <div className="nt-about__info">
                <h3 className="nt-about__name">网易云音乐 Linux 客户端</h3>
                <p className="nt-about__ver">
                  版本 {appVersion()} · Electron · {isElectron() ? '桌面模式' : '浏览器预览'}
                </p>
                <p className="nt-about__tips">
                  非官方开源客户端，仅供学习交流使用。音乐版权归网易云音乐及版权方所有。
                </p>
              </div>
              <button type="button" className="nt-btn nt-btn--ghost nt-btn--sm" onClick={() => setConfirmReset(true)}>
                <RotateCcw size={13} />
                恢复默认设置
              </button>
            </div>
            <div className="nt-settings__credits">
              <Keyboard size={13} />
              <span>使用 React 18 · TypeScript · zustand · lucide-react 构建</span>
            </div>
          </div>
        </Section>
      </Page>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        options={{
          title: '清除缓存',
          message: '将清除已缓存的音频与封面数据。清除后再次播放需要重新下载，确定继续吗？',
          confirmText: '清除',
          danger: true,
          onConfirm: () => void doClearCache()
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        options={{
          title: '恢复默认设置',
          message: '将把主题、侧栏、音质等设置恢复为默认值（不会删除收藏与播放记录）。',
          confirmText: '恢复',
          onConfirm: () => {
            resetSettings()
            toast.success('已恢复默认设置')
          }
        }}
      />
    </ScrollArea>
  )
}

/** 开关组件 */
function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('nt-switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="nt-switch__thumb">{checked ? <Check size={10} strokeWidth={3} /> : null}</span>
    </button>
  )
}
