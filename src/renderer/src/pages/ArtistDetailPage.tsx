import { useEffect, useState } from 'react'
import { Mic2, Play } from 'lucide-react'
import { AlbumCard } from '@/components/Cards'
import { Cover } from '@/components/Cover'
import { EmptyState } from '@/components/EmptyState'
import { CardGrid, Section } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { SkeletonDetailHeader, SkeletonRows } from '@/components/Skeleton'
import { SongList } from '@/components/SongList'
import { toast } from '@/components/Toast'
import { fetchArtist } from '@/hooks/data'
import { useAsync } from '@/hooks/useAsync'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { player } from '@/hooks/usePlayerView'
import { useRoute } from '@/hooks/useRoute'
import { cx, plainText } from '@/utils/format'
import './Detail.css'
import './Artist.css'

type ArtistTab = 'songs' | 'albums' | 'desc'

/** 歌手详情页：简介 + 热门歌曲 + 专辑 */
export function ArtistDetailPage(): JSX.Element {
  const route = useRoute()
  const id = route.segments[1] ?? ''
  const [tab, setTab] = useState<ArtistTab>('songs')
  const { data, loading, error, reload } = useAsync(() => fetchArtist(id), [id], !!id)
  const palette = useCoverPalette(data?.picUrl, id)

  useEffect(() => {
    setTab('songs')
  }, [id])

  if (!id) {
    return (
      <ScrollArea padding={0}>
        <EmptyState kind="error" title="缺少歌手 ID" />
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
          title="歌手加载失败"
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

  const hotSongs = data.hotSongs ?? []
  const albums = data.albums ?? []
  const brief = plainText(data.briefDesc)

  const playHot = (): void => {
    if (!hotSongs.length) {
      toast.warning('暂无热门歌曲')
      return
    }
    player.playQueue(hotSongs, 0)
    toast.success(`开始播放：${data.name} 热门歌曲`)
  }

  const tabs: Array<{ key: ArtistTab; label: string; count?: number }> = [
    { key: 'songs', label: '热门歌曲', count: hotSongs.length },
    { key: 'albums', label: '专辑', count: albums.length },
    { key: 'desc', label: '歌手简介' }
  ]

  return (
    <ScrollArea padding={0}>
      <div className="nt-detail">
        <header className="nt-detail__header nt-artist-head" style={{ background: palette.gradient }}>
          <div className="nt-detail__backdrop" aria-hidden="true">
            {data.picUrl && (
              <div className="nt-detail__backdrop-img" style={{ backgroundImage: `url("${data.picUrl}")` }} />
            )}
          </div>

          <div className="nt-detail__header-inner nt-artist-head__inner">
            <div className="nt-artist-head__avatar">
              <Cover
                src={data.picUrl}
                seed={data.id}
                round
                radius={999}
                size={172}
                iconSize={48}
                shadow
                alt={data.name}
                scale={2}
              />
            </div>
            <div className="nt-detail__info">
              <span className="nt-detail__badge">歌手</span>
              <h1 className="nt-detail__title">{data.name}</h1>
              {data.alias && data.alias.length > 0 && (
                <p className="nt-artist-head__alias">{data.alias.join(' / ')}</p>
              )}

              <div className="nt-detail__stats">
                {data.musicSize ? (
                  <span className="nt-detail__stat">
                    <strong>{data.musicSize}</strong> 首单曲
                  </span>
                ) : null}
                <span className="nt-detail__stat">
                  <strong>{data.albumSize ?? albums.length}</strong> 张专辑
                </span>
                {hotSongs.length > 0 && <span className="nt-detail__stat">热门歌曲 {hotSongs.length} 首</span>}
              </div>

              {brief && <p className={cx('nt-detail__desc', 'nt-artist-head__brief')}>{brief}</p>}

              <div className="nt-detail__actions">
                <button type="button" className="nt-btn nt-btn--primary nt-detail__playall" onClick={playHot}>
                  <Play size={15} fill="currentColor" />
                  播放热门歌曲
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="nt-detail__body">
          <div className="nt-artist-tabs" role="tablist" aria-label="歌手内容分类">
            {tabs.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={cx('nt-artist-tabs__tab', tab === t.key && 'is-active')}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {typeof t.count === 'number' && t.count > 0 && (
                  <span className="nt-artist-tabs__count">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'songs' && (
            <SongList songs={hotSongs} showAlbum showCover showHeader emptyText="暂无热门歌曲" />
          )}

          {tab === 'albums' &&
            (albums.length === 0 ? (
              <EmptyState kind="empty" title="暂无专辑" compact />
            ) : (
              <CardGrid>
                {albums.map(a => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </CardGrid>
            ))}

          {tab === 'desc' && (
            <Section title="歌手简介">
              {brief ? (
                <p className="nt-artist-bio">{brief}</p>
              ) : (
                <EmptyState
                  kind="empty"
                  compact
                  title="暂无简介"
                  description="这位歌手还没有填写简介"
                />
              )}
              <div className="nt-artist-bio__meta">
                <Mic2 size={13} />
                <span>数据来自网易云音乐</span>
              </div>
            </Section>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}
