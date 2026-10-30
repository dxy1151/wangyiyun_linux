import { useCallback } from 'react'
import { Headphones, ListMusic, Play } from 'lucide-react'
import type { Playlist } from '@/api/types'
import { Cover } from '@/components/Cover'
import { openContextMenu } from '@/components/ContextMenu'
import { player } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { toast } from '@/components/Toast'
import { cx, formatCount } from '@/utils/format'
import './Cards.css'

export interface PlaylistCardProps {
  playlist: Playlist
  /** 是否显示播放量 */
  showPlayCount?: boolean
  className?: string
  /** 尺寸变体 */
  variant?: 'grid' | 'row'
}

/** 歌单卡片：封面 + 播放按钮 + 播放量 + 标题 */
export function PlaylistCard({ playlist, showPlayCount = true, className, variant = 'grid' }: PlaylistCardProps): JSX.Element {
  const toDetail = useCallback(() => navigate(`/playlist/${playlist.id}`), [playlist.id])

  const onPlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const tracks = playlist.tracks ?? []
      if (tracks.length) {
        player.playQueue(tracks, 0)
        toast.success(`开始播放：${playlist.name}`)
      } else {
        toDetail()
      }
    },
    [playlist, toDetail]
  )

  const onContextMenu = (e: React.MouseEvent): void => {
    openContextMenu(e, [
      { key: 'open', label: '查看歌单', icon: <ListMusic size={14} />, onClick: toDetail },
      {
        key: 'play',
        label: '播放',
        icon: <Play size={14} />,
        disabled: !(playlist.tracks ?? []).length,
        onClick: () => {
          const tracks = playlist.tracks ?? []
          if (tracks.length) player.playQueue(tracks, 0)
        }
      }
    ])
  }

  return (
    <article
      className={cx('nt-card', 'nt-playlist-card', `is-${variant}`, className)}
      onClick={toDetail}
      onContextMenu={onContextMenu}
      onKeyDown={e => {
        if (e.key === 'Enter') toDetail()
      }}
      role="link"
      tabIndex={0}
      title={playlist.name}
    >
      <div className="nt-card__cover-wrap">
        <Cover
          src={playlist.coverImgUrl}
          seed={playlist.id}
          radius={12}
          className="nt-card__cover"
          iconSize={34}
          alt={playlist.name}
        />
        {showPlayCount && (
          <span className="nt-card__count">
            <Headphones size={11} />
            {formatCount(playlist.playCount)}
          </span>
        )}
        <button type="button" className="nt-card__play" aria-label={`播放 ${playlist.name}`} onClick={onPlay}>
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <div className="nt-card__info">
        <h3 className="nt-card__title nt-clamp-2">{playlist.name}</h3>
        {playlist.copywriter && <p className="nt-card__sub nt-ellipsis">{playlist.copywriter}</p>}
        {!playlist.copywriter && playlist.creator?.nickname && (
          <p className="nt-card__sub nt-ellipsis">by {playlist.creator.nickname}</p>
        )}
      </div>
    </article>
  )
}

export interface RankCardProps {
  chart: {
    id: number
    name: string
    coverImgUrl: string
    updateFrequency?: string
  }
  top?: Array<{ name: string; artistText?: string }>
  className?: string
}

/** 排行榜卡片：榜单封面 + 前三首预览 */
export function RankCard({ chart, top = [], className }: RankCardProps): JSX.Element {
  const open = (): void => navigate(`/playlist/${chart.id}?type=toplist`)
  return (
    <article
      className={cx('nt-rank-card', className)}
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter') open()
      }}
    >
      <div className="nt-rank-card__top">
        <Cover src={chart.coverImgUrl} seed={chart.id} size={64} radius={10} iconSize={22} alt={chart.name} />
        <div className="nt-rank-card__head">
          <h3 className="nt-rank-card__name nt-ellipsis">{chart.name}</h3>
          {chart.updateFrequency && <p className="nt-rank-card__freq">{chart.updateFrequency}</p>}
        </div>
        <button
          type="button"
          className="nt-rank-card__play"
          aria-label={`查看 ${chart.name}`}
          onClick={e => {
            e.stopPropagation()
            open()
          }}
        >
          <Play size={13} fill="currentColor" />
        </button>
      </div>
      <ol className="nt-rank-card__list">
        {top.slice(0, 3).map((s, i) => (
          <li key={i} className="nt-rank-card__item">
            <span className={cx('nt-rank-card__idx', i < 3 && 'is-top')}>{i + 1}</span>
            <span className="nt-rank-card__song nt-ellipsis">
              {s.name}
              {s.artistText ? <span className="nt-rank-card__artist"> - {s.artistText}</span> : null}
            </span>
          </li>
        ))}
        {top.length === 0 && <li className="nt-rank-card__empty">暂无数据</li>}
      </ol>
    </article>
  )
}

/* ------------------------------ 歌手卡片 ------------------------------ */

export interface ArtistCardProps {
  artist: { id: number; name: string; picUrl?: string; alias?: string[]; albumSize?: number }
  className?: string
}

export function ArtistCard({ artist, className }: ArtistCardProps): JSX.Element {
  const open = (): void => navigate(`/artist/${artist.id}`)
  return (
    <article
      className={cx('nt-artist-card', className)}
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter') open()
      }}
      title={artist.name}
    >
      <div className="nt-artist-card__avatar">
        <Cover src={artist.picUrl} seed={artist.id} round radius={999} iconSize={28} alt={artist.name} scale={1.6} />
        <span className="nt-artist-card__ring" aria-hidden="true" />
      </div>
      <h3 className="nt-artist-card__name nt-ellipsis">{artist.name}</h3>
      {artist.alias?.[0] ? (
        <p className="nt-artist-card__alias nt-ellipsis">{artist.alias[0]}</p>
      ) : artist.albumSize ? (
        <p className="nt-artist-card__alias nt-ellipsis">{artist.albumSize} 张专辑</p>
      ) : (
        <p className="nt-artist-card__alias">歌手</p>
      )}
    </article>
  )
}

/* ------------------------------ 专辑卡片 ------------------------------ */

export interface AlbumCardProps {
  album: { id: number; name: string; picUrl?: string; artist?: { name: string }; publishTime?: number; size?: number }
  className?: string
}

export function AlbumCard({ album, className }: AlbumCardProps): JSX.Element {
  const open = (): void => navigate(`/album/${album.id}`)
  const year = album.publishTime ? new Date(album.publishTime).getFullYear() : undefined
  const validYear = year && year > 1900 && year < 2200 ? year : undefined

  return (
    <article
      className={cx('nt-card', 'nt-album-card', className)}
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter') open()
      }}
      title={album.name}
    >
      <div className="nt-card__cover-wrap">
        <Cover src={album.picUrl} seed={album.id} radius={12} className="nt-card__cover" iconSize={32} alt={album.name} />
        <span className="nt-card__badge">{validYear ? `${validYear} 年` : '专辑'}</span>
      </div>
      <div className="nt-card__info">
        <h3 className="nt-card__title nt-clamp-2">{album.name}</h3>
        <p className="nt-card__sub nt-ellipsis">{album.artist?.name ?? '未知歌手'}</p>
      </div>
    </article>
  )
}
