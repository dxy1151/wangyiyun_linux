import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ListMusic, Play, Trash2, X } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { EmptyState } from '@/components/EmptyState'
import { IconButton } from '@/components/IconButton'
import { openContextMenu } from '@/components/ContextMenu'
import { toast } from '@/components/Toast'
import { player, usePlayerView } from '@/hooks/usePlayerView'
import { useUi } from '@/store/ui'
import { cx, formatDuration, joinArtists } from '@/utils/format'
import './QueuePanel.css'

/** 播放队列抽屉：当前列表 + 清空 + 定位当前曲目 */
export function QueuePanel(): JSX.Element | null {
  const open = useUi(s => s.queueOpen)
  const setQueueOpen = useUi(s => s.setQueueOpen)
  const { queue, current, isPlaying } = usePlayerView()
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef<HTMLDivElement | null>(null)

  // 打开时滚动到当前曲目
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setQueueOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setQueueOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return queue.map((song, index) => ({ song, index }))
    return queue
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => {
        const artist = song.artistText || joinArtists(song.artists)
        return song.name.toLowerCase().includes(q) || artist.toLowerCase().includes(q)
      })
  }, [queue, query])

  const totalDuration = useMemo(() => queue.reduce((sum, s) => sum + (s.duration || 0), 0), [queue])

  if (!open) return null

  return (
    <>
      <div className="nt-queue__backdrop" onClick={() => setQueueOpen(false)} aria-hidden="true" />
      <aside className="nt-queue" role="dialog" aria-label="播放队列" aria-modal="false">
        <header className="nt-queue__head">
          <div className="nt-queue__title-row">
            <ListMusic size={16} />
            <h2 className="nt-queue__title">当前播放</h2>
            <span className="nt-queue__count">{queue.length} 首</span>
          </div>
          <div className="nt-queue__actions">
            <IconButton
              label="清空列表"
              disabled={!queue.length}
              onClick={() => {
                player.clearQueue()
                toast.success('已清空播放列表')
              }}
            >
              <Trash2 size={15} />
            </IconButton>
            <IconButton label="关闭" onClick={() => setQueueOpen(false)}>
              <X size={16} />
            </IconButton>
          </div>
        </header>

        <div className="nt-queue__search">
          <input
            type="text"
            className="nt-queue__input"
            placeholder="在列表中搜索"
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        {queue.length === 0 ? (
          <EmptyState kind="playlist" compact title="播放列表是空的" description="双击任意歌曲开始播放" />
        ) : (
          <>
            <div className="nt-queue__list nt-scroll" ref={listRef}>
              {filtered.map(({ song, index }) => {
                const active = current?.id === song.id
                const artist = song.artistText || joinArtists(song.artists)
                return (
                  <div
                    key={`${song.id}-${index}`}
                    ref={active ? currentRef : undefined}
                    className={cx('nt-queue__item', active && 'is-active')}
                    onDoubleClick={() => player.playQueue(queue, index)}
                    onContextMenu={e =>
                      openContextMenu(e, [
                        { key: 'play', label: '播放', icon: <Play size={14} />, onClick: () => player.playQueue(queue, index) },
                        { key: 'next', label: '下一首播放', icon: <ArrowDownUp size={14} />, onClick: () => player.addNext(song) },
                        { key: 'divider', label: '', divider: true },
                        {
                          key: 'remove',
                          label: '从列表移除',
                          danger: true,
                          icon: <X size={14} />,
                          onClick: () => player.removeFromQueue(index)
                        }
                      ])
                    }
                    title={`${song.name} - ${artist}`}
                  >
                    <Cover src={song.picUrl || song.album?.picUrl} seed={song.id} size={32} radius={5} iconSize={12} />
                    <div className="nt-queue__item-meta">
                      <span className="nt-queue__item-name nt-ellipsis">{song.name}</span>
                      <span className="nt-queue__item-artist nt-ellipsis">{artist}</span>
                    </div>
                    {active && (
                      <span className={cx('nt-eq', isPlaying && 'is-playing')} aria-label="正在播放">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                    <span className="nt-queue__item-dur">{formatDuration(song.duration)}</span>
                    <button
                      type="button"
                      className="nt-queue__item-remove"
                      aria-label="移除此曲"
                      title="移除此曲"
                      onClick={e => {
                        e.stopPropagation()
                        player.removeFromQueue(index)
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="nt-queue__noresult">没有匹配的歌曲</p>}
            </div>
            <footer className="nt-queue__foot">
              共 {queue.length} 首 · 总时长 {formatDuration(totalDuration)}
            </footer>
          </>
        )}
      </aside>
    </>
  )
}
