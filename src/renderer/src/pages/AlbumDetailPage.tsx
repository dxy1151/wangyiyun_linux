import { Play } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { EmptyState } from '@/components/EmptyState'
import { ScrollArea } from '@/components/ScrollArea'
import { SkeletonDetailHeader, SkeletonRows } from '@/components/Skeleton'
import { SongList } from '@/components/SongList'
import { toast } from '@/components/Toast'
import { fetchAlbum } from '@/hooks/data'
import { useAsync } from '@/hooks/useAsync'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { player } from '@/hooks/usePlayerView'
import { navigate, useRoute } from '@/hooks/useRoute'
import { formatDate, plainText } from '@/utils/format'
import { cx } from '@/utils/format'
import './Detail.css'

/** 专辑详情页 */
export function AlbumDetailPage(): JSX.Element {
  const route = useRoute()
  const id = route.segments[1] ?? ''
  const { data, loading, error, reload } = useAsync(() => fetchAlbum(id), [id], !!id)
  const palette = useCoverPalette(data?.picUrl, id)

  if (!id) {
    return (
      <ScrollArea padding={0}>
        <EmptyState kind="error" title="缺少专辑 ID" />
      </ScrollArea>
    )
  }

  if (loading) {
    return (
      <ScrollArea padding={0}>
        <div className="nt-detail">
          <SkeletonDetailHeader />
          <SkeletonRows count={8} />
        </div>
      </ScrollArea>
    )
  }

  if (error || !data) {
    return (
      <ScrollArea padding={0}>
        <EmptyState
          kind="error"
          title="专辑加载失败"
          description={error?.message}
          action={
            <button type="button" className="nt-btn nt-btn--soft nt-btn--sm" onClick={reload}>
              重新加载
            </button>
          }
        />
      </ScrollArea>
    )
  }

  const songs = data.songs ?? []
  const desc = plainText(data.description)

  const playAll = (): void => {
    if (!songs.length) {
      toast.warning('该专辑暂无可播放歌曲')
      return
    }
    player.playQueue(songs, 0)
    toast.success(`开始播放：${data.name}`)
  }

  return (
    <ScrollArea padding={0}>
      <div className="nt-detail">
        <header className="nt-detail__header" style={{ background: palette.gradient }}>
          <div className="nt-detail__backdrop" aria-hidden="true">
            {data.picUrl && (
              <div className="nt-detail__backdrop-img" style={{ backgroundImage: `url("${data.picUrl}")` }} />
            )}
          </div>

          <div className="nt-detail__header-inner">
            <Cover
              src={data.picUrl}
              seed={data.id}
              size={188}
              radius={14}
              iconSize={40}
              shadow
              alt={data.name}
              className="nt-detail__cover"
            />
            <div className="nt-detail__info">
              <span className="nt-detail__badge">专辑</span>
              <h1 className="nt-detail__title">{data.name}</h1>

              <div className="nt-detail__creator">
                <span>歌手：</span>
                <span
                  className="nt-detail__creator-name"
                  role="link"
                  tabIndex={0}
                  onClick={() => data.artist?.id && navigate(`/artist/${data.artist.id}`)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && data.artist?.id) navigate(`/artist/${data.artist.id}`)
                  }}
                >
                  {data.artist?.name ?? '未知歌手'}
                </span>
                {data.publishTime ? <span className="nt-detail__dot">·</span> : null}
                {data.publishTime ? <span className="nt-detail__meta-item">发行于 {formatDate(data.publishTime)}</span> : null}
              </div>

              {data.company && <div className="nt-detail__creator">发行公司：{data.company}</div>}

              {desc && <p className="nt-detail__desc">{desc}</p>}

              <div className="nt-detail__stats">
                <span className="nt-detail__stat">
                  <strong>{data.size || songs.length}</strong> 首歌曲
                </span>
              </div>

              <div className="nt-detail__actions">
                <button type="button" className="nt-btn nt-btn--primary nt-detail__playall" onClick={playAll}>
                  <Play size={15} fill="currentColor" />
                  播放全部
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="nt-detail__body">
          <div className="nt-detail__list-head">
            <h2 className="nt-detail__list-title">专辑曲目</h2>
            <span className="nt-detail__list-count">{songs.length} 首</span>
          </div>
          <SongList songs={songs} showAlbum={false} showCover showHeader emptyText="专辑暂无曲目" />
        </section>
      </div>
    </ScrollArea>
  )
}

export interface ArtistPageExtraProps {
  /** 由 ArtistDetailPage 传入的当前 Tab 样式钩子 */
  className?: string
}

/** 歌手热门歌曲区（供歌手页复用） */
export function ArtistHotSongs({ songs }: { songs: Parameters<typeof SongList>[0]['songs'] }): JSX.Element {
  return <SongList songs={songs} showAlbum showCover showHeader dense={false} emptyText="暂无热门歌曲" className={cx('nt-artist__hot')} />
}
