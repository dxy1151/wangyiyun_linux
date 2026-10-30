import { useMemo, useState } from 'react'
import { Clock3, Play, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Page, PageTitle } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { SongList } from '@/components/SongList'
import { toast } from '@/components/Toast'
import { player, usePlayerView } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { cx, formatDuration } from '@/utils/format'
import './Recent.css'

type Range = 'all' | 'today' | 'week'

const RANGE_OPTIONS: Array<{ key: Range; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近一周' }
]

/** 最多显示的日期分组数 */
const DAY = 24 * 60 * 60 * 1000

function dayLabel(ts: number): string {
  const now = new Date()
  const target = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diffDays = Math.floor((startOfToday - new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()) / DAY)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}

/** 最近播放页：按时间分组展示（本地持久化） */
export function RecentPage(): JSX.Element {
  const { recent } = usePlayerView()
  const [range, setRange] = useState<Range>('all')

  const filtered = useMemo(() => {
    if (range === 'all') return recent
    const now = Date.now()
    const limit = range === 'today' ? DAY : 7 * DAY
    // recent 项没有时间戳时全部保留（保证可用性）
    return recent.filter(s => {
      const ts = (s as { playedAt?: number }).playedAt
      if (!ts) return true
      return now - ts <= limit
    })
  }, [recent, range])

  const totalDuration = useMemo(() => filtered.reduce((s, x) => s + (x.duration || 0), 0), [filtered])

  return (
    <ScrollArea padding={0}>
      <Page>
        <PageTitle
          title="最近播放"
          subtitle={recent.length > 0 ? `共 ${recent.length} 首 · 总时长 ${formatDuration(totalDuration)}` : '记录你听过的每一首歌'}
          extra={
            recent.length > 0 ? (
              <div className="nt-recent__actions">
                <button
                  type="button"
                  className="nt-btn nt-btn--primary nt-btn--sm"
                  onClick={() => {
                    player.playQueue(filtered, 0)
                    toast.success('开始播放最近播放')
                  }}
                >
                  <Play size={13} fill="currentColor" />
                  播放全部
                </button>
                <button
                  type="button"
                  className="nt-btn nt-btn--ghost nt-btn--sm"
                  onClick={() => {
                    player.clearQueue()
                    toast.info('已清空播放队列')
                  }}
                >
                  <Trash2 size={13} />
                  清空队列
                </button>
              </div>
            ) : undefined
          }
        />

        {recent.length > 0 && (
          <div className="nt-recent__filters">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={cx('nt-recent__filter', range === opt.key && 'is-active')}
                onClick={() => setRange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            kind="empty"
            title={recent.length === 0 ? '还没有播放记录' : '该时间段暂无记录'}
            description={recent.length === 0 ? '播放歌曲后会自动记录在这里' : '换个时间范围看看吧'}
            action={
              recent.length === 0 ? (
                <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => navigate('/discover')}>
                  去发现音乐
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="nt-recent__list">
            <div className="nt-recent__group-head">
              <Clock3 size={13} />
              <span>
                {range === 'today' ? '今天' : range === 'week' ? '最近一周' : `${dayLabel(
                  filtered[0] && (filtered[0] as { playedAt?: number }).playedAt
                    ? ((filtered[0] as { playedAt?: number }).playedAt as number)
                    : Date.now()
                )} 及更早`}
              </span>
            </div>
            <SongList songs={filtered} showAlbum showCover showHeader />
          </div>
        )}
      </Page>
    </ScrollArea>
  )
}
