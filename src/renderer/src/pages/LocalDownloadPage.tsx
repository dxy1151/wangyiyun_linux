import { FolderOpen, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Page, PageTitle, Section } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { toast } from '@/components/Toast'
import { usePlayerView } from '@/hooks/usePlayerView'
import { player } from '@/hooks/usePlayerView'
import { useUi } from '@/store/ui'
import { openExternal, pickFolder } from '@/hooks/useBridge'
import { formatDuration } from '@/utils/format'

/** 本地与下载：已缓存/已下载歌曲 */
export function LocalDownloadPage(): JSX.Element {
  const { queue } = usePlayerView()
  const downloadDir = useUi(s => s.settings.downloadDir)
  const setSetting = useUi(s => s.setSetting)

  // 缓存标记为 cached 的歌曲（播放引擎回填）
  const cached = queue.filter(s => s.cached)

  return (
    <ScrollArea padding={0}>
      <Page>
        <PageTitle title="本地与下载" subtitle="管理下载目录与本地缓存" />

        <Section title="下载设置">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <FolderOpen size={16} />
                <div>
                  <span className="nt-settings-row__title">下载目录</span>
                  <span className="nt-settings-row__desc">歌曲将保存到此文件夹</span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <code className="nt-settings-path nt-ellipsis" title={downloadDir}>
                  {downloadDir}
                </code>
                <button
                  type="button"
                  className="nt-btn nt-btn--soft nt-btn--sm"
                  onClick={() => {
                    void pickFolder().then(dir => {
                      if (dir) {
                        setSetting('downloadDir', dir)
                        toast.success('下载目录已更新')
                      } else {
                        toast.info('未选择目录（或当前环境不支持）')
                      }
                    })
                  }}
                >
                  更改
                </button>
                <button
                  type="button"
                  className="nt-btn nt-btn--ghost nt-btn--sm"
                  onClick={() => {
                    openExternal('file://' + downloadDir)
                  }}
                >
                  打开
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="本地缓存">
          <div className="nt-settings-card">
            <div className="nt-settings-row">
              <div className="nt-settings-row__label">
                <HardDrive size={16} />
                <div>
                  <span className="nt-settings-row__title">播放队列中已缓存</span>
                  <span className="nt-settings-row__desc">
                    {cached.length} 首 · 总时长 {formatDuration(cached.reduce((s, x) => s + (x.duration || 0), 0))}
                  </span>
                </div>
              </div>
              <div className="nt-settings-row__control">
                <button
                  type="button"
                  className="nt-btn nt-btn--soft nt-btn--sm"
                  onClick={() => {
                    player.setQueue(queue)
                    toast.success('已刷新播放队列缓存')
                  }}
                >
                  <RefreshCw size={13} />
                  刷新
                </button>
                <button
                  type="button"
                  className="nt-btn nt-btn--ghost nt-btn--sm"
                  onClick={() => toast.info('请到「设置」页清理音频缓存')}
                >
                  <Trash2 size={13} />
                  清理
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="已缓存歌曲">
          {cached.length === 0 ? (
            <EmptyState
              kind="empty"
              title="还没有缓存的歌曲"
              description="播放过的歌曲会自动缓存到本地，离线也能听"
              compact
            />
          ) : (
            <div className="nt-local__cached">
              {cached.map(song => (
                <div className="nt-local__cached-item" key={song.id}>
                  <span className="nt-local__cached-name nt-ellipsis">{song.name}</span>
                  <span className="nt-local__cached-artist nt-ellipsis">
                    {song.artistText || song.artists?.map(a => a.name).join(' / ')}
                  </span>
                  <span className="nt-local__cached-badge">已缓存</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </Page>
    </ScrollArea>
  )
}
