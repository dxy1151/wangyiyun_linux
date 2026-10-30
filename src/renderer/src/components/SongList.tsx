import { useCallback, useMemo } from 'react'
import type { Song } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { SongRow } from '@/components/SongRow'
import { player, usePlayerView } from '@/hooks/usePlayerView'
import type { MenuItem } from '@/components/ContextMenu'
import { cx } from '@/utils/format'
import './SongList.css'

export interface SongListProps {
  songs: Song[]
  /** 列表标识（用于"正在播放"高亮，通常传歌单 id；不传则按 id 匹配 current） */
  listId?: number | string
  showAlbum?: boolean
  showCover?: boolean
  /** 是否显示表头 */
  showHeader?: boolean
  /** 序号是否连续（false 时用歌曲在原始列表中的顺序） */
  /** 行右键额外菜单 */
  extraMenuFor?: (song: Song, index: number) => MenuItem[]
  /** 队列模式：显示移除按钮 */
  onRemove?: (index: number) => void
  dense?: boolean
  className?: string
  emptyText?: string
  /** 仅渲染前 N 条（首页预览） */
  limit?: number
}

/**
 * 歌曲列表：
 * - 双击整行播放（队列 = 整个列表，保证连播顺序）
 * - 当前播放行高亮 + 律动条
 * - 表头显示歌曲数
 */
export function SongList({
  songs,
  showAlbum = true,
  showCover = true,
  showHeader = true,
  extraMenuFor,
  onRemove,
  dense = false,
  className,
  emptyText = '还没有歌曲',
  limit
}: SongListProps): JSX.Element {
  const view = usePlayerView()
  const currentId = view.current?.id

  const visible = useMemo(() => (limit ? songs.slice(0, limit) : songs), [songs, limit])

  /** 播放整张列表：队列就是当前列表，保证 next/prev 连贯 */
  const playAt = useCallback(
    (index: number) => {
      player.playQueue(songs, index)
    },
    [songs]
  )

  if (!songs.length) {
    return (
      <div className={cx('nt-songlist', className)}>
        <EmptyState kind="empty" title={emptyText} description="换一个歌单看看吧" compact />
      </div>
    )
  }

  return (
    <div className={cx('nt-songlist', dense && 'is-dense', className)}>
      {showHeader && (
        <div className="nt-songlist__head" role="row">
          <span className="nt-songlist__h-idx">#</span>
          {showCover && <span className="nt-songlist__h-cover" />}
          <span className="nt-songlist__h-title">标题</span>
          <span className="nt-songlist__h-artist">歌手</span>
          {showAlbum && <span className="nt-songlist__h-album">专辑</span>}
          <span className="nt-songlist__h-dur">时长</span>
          <span className="nt-songlist__h-actions">
            {songs.length > 1 && limit && limit < songs.length ? `共 ${songs.length} 首` : ''}
          </span>
        </div>
      )}

      <div className="nt-songlist__body" role="rowgroup">
        {visible.map((song, i) => (
          <SongRow
            key={`${song.id}-${i}`}
            song={song}
            index={i + 1}
            active={song.id === currentId}
            paused={!view.isPlaying}
            showAlbum={showAlbum}
            showCover={showCover}
            dense={dense}
            onPlay={() => playAt(i)}
            extraMenu={extraMenuFor?.(song, i)}
            onRemove={onRemove ? () => onRemove(i) : undefined}
          />
        ))}
      </div>
    </div>
  )
}
