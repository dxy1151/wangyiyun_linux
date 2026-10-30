import { useMemo } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import type { Song } from '@/api/types'
import { Carousel } from '@/components/Carousel'
import type { CarouselItem } from '@/components/Carousel'
import { PlaylistCard, RankCard } from '@/components/Cards'
import { EmptyState } from '@/components/EmptyState'
import { CardGrid, Page, PageTitle, Section } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { SkeletonGrid } from '@/components/Skeleton'
import { SongList } from '@/components/SongList'
import { IconButton } from '@/components/IconButton'
import { fetchHotCharts, fetchNewSongs, fetchRecommendPlaylists, fetchToplist } from '@/hooks/data'
import { useAsync } from '@/hooks/useAsync'
import { player } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { formatCount } from '@/utils/format'
import './Discover.css'

/** 发现音乐首页：轮播 + 推荐歌单 + 新歌速递 + 排行榜 */
export function DiscoverPage(): JSX.Element {
  const recommend = useAsync(() => fetchRecommendPlaylists(18), [])
  const newSongs = useAsync(() => fetchNewSongs(12), [])
  const charts = useAsync(() => fetchHotCharts(), [])

  const banners = useMemo<CarouselItem[]>(() => {
    const list = recommend.data ?? []
    return list.slice(0, 5).map(pl => ({
      id: pl.id,
      image: pl.coverImgUrl,
      title: pl.name,
      subtitle: pl.copywriter || (pl.creator?.nickname ? `by ${pl.creator.nickname}` : `${formatCount(pl.playCount)} 次播放`),
      href: `/playlist/${pl.id}`,
      onPlay: () => {
        const tracks = pl.tracks ?? []
        if (tracks.length) player.playQueue(tracks, 0)
        else navigate(`/playlist/${pl.id}`)
      }
    }))
  }, [recommend.data])

  // 取热歌榜前三首做预览
  const topChartId = charts.data?.[0]?.id
  const topPreview = useAsync(async () => {
    if (!topChartId) return []
    const pl = await fetchToplist(topChartId)
    return pl.tracks.slice(0, 3)
  }, [topChartId], !!topChartId)

  const reloadAll = (): void => {
    recommend.reload()
    newSongs.reload()
    charts.reload()
  }

  return (
    <ScrollArea padding={0}>
      <Page className="nt-discover">
        <PageTitle
          title="发现音乐"
          subtitle="每日为你推荐的好音乐"
          extra={
            <IconButton label="刷新推荐" onClick={reloadAll}>
              <RefreshCw size={16} />
            </IconButton>
          }
        />

        {/* 轮播 Banner */}
        {banners.length > 0 ? (
          <Carousel items={banners} height={210} />
        ) : recommend.loading ? (
          <div className="nt-discover__banner-skel">
            <div className="nt-skeleton" style={{ width: '100%', height: 210, borderRadius: 14 }} />
          </div>
        ) : (
          <div className="nt-discover__banner-empty">
            <Sparkles size={18} />
            <span>暂时无法获取推荐内容</span>
            <button type="button" className="nt-btn nt-btn--soft nt-btn--sm" onClick={reloadAll}>
              重试
            </button>
          </div>
        )}

        {/* 推荐歌单 */}
        <Section title="推荐歌单" actionText="查看全部" onAction={() => navigate('/discover/playlists')}>
          {recommend.loading ? (
            <SkeletonGrid count={10} />
          ) : recommend.error ? (
            <EmptyState kind="error" compact action={<button type="button" className="nt-btn nt-btn--soft nt-btn--sm" onClick={recommend.reload}>重试</button>} />
          ) : (recommend.data ?? []).length === 0 ? (
            <EmptyState kind="empty" compact title="暂无推荐歌单" />
          ) : (
            <CardGrid>
              {(recommend.data ?? []).slice(0, 10).map(pl => (
                <PlaylistCard key={pl.id} playlist={pl} />
              ))}
            </CardGrid>
          )}
        </Section>

        {/* 新歌 + 排行榜 双栏 */}
        <div className="nt-discover__grid">
          <Section title="新歌速递" actionText="更多" onAction={() => navigate('/discover/new')}>
            {newSongs.loading ? (
              <div className="nt-discover__list-skel">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="nt-discover__row-skel">
                    <div className="nt-skeleton" style={{ width: 36, height: 36, borderRadius: 6 }} />
                    <div style={{ flex: 1 }}>
                      <div className="nt-skeleton" style={{ width: '58%', height: 12, borderRadius: 4 }} />
                      <div className="nt-skeleton" style={{ width: '34%', height: 10, borderRadius: 4, marginTop: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <SongList
                songs={(newSongs.data ?? []).slice(0, 8)}
                showAlbum={false}
                showCover
                showHeader={false}
                dense
                emptyText="暂无新歌"
              />
            )}
          </Section>

          <Section title="排行榜" actionText="全部榜单" onAction={() => navigate('/discover/charts')}>
            {charts.loading ? (
              <div className="nt-discover__rank-skel">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="nt-skeleton" style={{ height: 112, borderRadius: 10 }} />
                ))}
              </div>
            ) : (charts.data ?? []).length === 0 ? (
              <EmptyState kind="empty" compact title="暂无榜单数据" />
            ) : (
              <div className="nt-discover__ranks">
                {(charts.data ?? []).slice(0, 4).map(chart => (
                  <RankCard
                    key={chart.id}
                    chart={chart}
                    top={
                      chart.id === topChartId
                        ? (topPreview.data ?? []).map((s: Song) => ({
                            name: s.name,
                            artistText: s.artistText || s.artists?.map(a => a.name).join(' / ')
                          }))
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      </Page>
    </ScrollArea>
  )
}
