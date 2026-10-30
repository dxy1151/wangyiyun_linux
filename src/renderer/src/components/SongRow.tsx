import { memo, useCallback } from 'react'
import { Heart, MoreHorizontal, Play, Volume2 } from 'lucide-react'
import type { Song } from '@/api/types'
import { Cover } from '@/components/Cover'
import { openContextMenu } from '@/components/ContextMenu'
import type { MenuItem } from '@/components/ContextMenu'
import { toast } from '@/components/Toast'
import { player, useFavoriteIds } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { cx, formatDuration, joinArtists } from '@/utils/format'
import './SongRow.css'

export interface SongRowProps {
  song: Song
  /** 列表内下标（1 起显示序号） */
  index: number
  /** 是否正在播放这首 */
  active?: boolean
  /** 是否暂停中（active 时有效） */
  paused?: boolean
  /** 双击 / 点击播放 */
  onPlay?: () => void
  /** 是否显示专辑列 */
  showAlbum?: boolean
  /** 是否显示封面缩略图 */
  showCover?: boolean
  /** 右键额外菜单 */
  extraMenu?: MenuItem[]
  /** 紧凑模式 */
  dense?: boolean
  /** 是否允许删除（队列面板用） */
  onRemove?: () => void
}

function artistOf(song: Song): string {
  if (song.artistText) return song.artistText
  return joinArtists(song.artists)
}

function albumOf(song: Song): string {
  return song.albumName || song.album?.name || ''
}

/** 单曲行：序号/播放动效 + 封面 + 标题 + 歌手 + 专辑 + 时长 + 操作 */
export const SongRow = memo(function SongRow({
  song,
  index,
  active = false,
  paused = false,
  onPlay,
  showAlbum = true,
  showCover = true,
  extraMenu,
  dense = false,
  onRemove
}: SongRowProps): JSX.Element {
  // 只订阅收藏 id 集合，避免播放进度刷新导致每行重渲染
  const favoriteIds = useFavoriteIds()
  const liked = favoriteIds.has(song.id)

  const handlePlay = useCallback(() => {
    if (onPlay) {
      onPlay()
      return
    }
    player.playQueue([song], 0)
  }, [onPlay, song])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const items: MenuItem[] = [
        { key: 'play', label: '播放', icon: <Play size={14} />, onClick: handlePlay },
        { key: 'next', label: '下一首播放', onClick: () => player.addNext(song) },
        { key: 'divider-1', label: '', divider: true },
        {
          key: 'fav',
          label: liked ? '取消喜欢' : '添加到我喜欢的音乐',
          icon: <Heart size={14} />,
          onClick: () => player.toggleFavorite(song)
        },
        {
          key: 'artist',
          label: '查看歌手',
          onClick: () => {
            const first = song.artists?.[0]
            if (first) navigate(`/artist/${first.id}`)
            else toast.info('未知歌手')
          }
        },
        {
          key: 'album',
          label: '查看专辑',
          disabled: !song.album?.id,
          onClick: () => song.album?.id && navigate(`/album/${song.album.id}`)
        },
        { key: 'divider-2', label: '', divider: true },
        {
          key: 'download',
          label: '下载',
          disabled: true,
          hint: '敬请期待',
          onClick: () => toast.info('下载功能开发中')
        }
      ]
      if (extraMenu?.length) items.push({ key: 'divider-3', label: '', divider: true }, ...extraMenu)
      if (onRemove) {
        items.push({ key: 'divider-4', label: '', divider: true }, {
          key: 'remove',
          label: '从列表移除',
          danger: true,
          onClick: onRemove
        })
      }
      openContextMenu(e, items)
    },
    [handlePlay, song, liked, extraMenu, onRemove]
  )

  const tooLongTitle = song.name.length > 40
  const showAlias = Array.isArray(song.alia) && song.alia.length > 0 && song.alia[0]

  return (
    <div
      className={cx('nt-songrow', active && 'is-active', dense && 'is-dense')}
      onDoubleClick={handlePlay}
      onContextMenu={handleContextMenu}
      role="row"
      aria-selected={active}
      title={`${song.name} - ${artistOf(song)}`}
    >
      {/* 序号 / 播放动效 */}
      <div className="nt-songrow__idx">
        {active ? (
          <span className={cx('nt-eq', !paused && 'is-playing')} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="nt-songrow__num">{index}</span>
        )}
        <button type="button" className="nt-songrow__play" aria-label="播放" onClick={handlePlay}>
          <Play size={13} fill="currentColor" />
        </button>
      </div>

      {/* 封面 */}
      {showCover && (
        <div className="nt-songrow__cover">
          <Cover src={song.picUrl || song.album?.picUrl} seed={song.id} size={36} radius={6} iconSize={14} />
        </div>
      )}

      {/* 标题 */}
      <div className="nt-songrow__title">
        <span className="nt-songrow__name nt-ellipsis">
          {song.name}
          {tooLongTitle ? '' : ''}
        </span>
        {showAlias && <span className="nt-songrow__alias nt-ellipsis">（{showAlias}）</span>}
      </div>

      {/* 歌手 */}
      <div className="nt-songrow__artist nt-ellipsis">
        {(song.artists ?? []).length > 0 ? (
          song.artists.map((a, i) => (
            <span
              key={a.id ?? i}
              className="nt-songrow__artist-link"
              role="link"
              tabIndex={0}
              onClick={e => {
                e.stopPropagation()
                navigate(`/artist/${a.id}`)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') navigate(`/artist/${a.id}`)
              }}
            >
              {a.name}
              {i < song.artists.length - 1 ? ' / ' : ''}
            </span>
          ))
        ) : (
          <span>{artistOf(song)}</span>
        )}
      </div>

      {/* 专辑 */}
      {showAlbum && (
        <div
          className="nt-songrow__album nt-ellipsis"
          role="link"
          tabIndex={song.album?.id ? 0 : -1}
          onClick={e => {
            e.stopPropagation()
            if (song.album?.id) navigate(`/album/${song.album.id}`)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && song.album?.id) navigate(`/album/${song.album.id}`)
          }}
        >
          {albumOf(song) || '—'}
        </div>
      )}

      {/* 时长 */}
      <div className="nt-songrow__duration">{formatDuration(song.duration)}</div>

      {/* 操作 */}
      <div className="nt-songrow__actions">
        <button
          type="button"
          className={cx('nt-songrow__act', liked && 'is-liked')}
          aria-label={liked ? '取消喜欢' : '喜欢'}
          title={liked ? '取消喜欢' : '喜欢'}
          onClick={e => {
            e.stopPropagation()
            player.toggleFavorite(song)
            toast.success(liked ? '已取消喜欢' : '已添加到我喜欢的音乐')
          }}
        >
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="nt-songrow__act"
          aria-label="更多"
          title="更多"
          onClick={e => {
            e.stopPropagation()
            handleContextMenu(e as unknown as React.MouseEvent)
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  )
})
