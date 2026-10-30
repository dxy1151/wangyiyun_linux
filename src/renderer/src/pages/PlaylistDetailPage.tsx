import { useState } from 'react'
import { CalendarDays, Heart, ListMusic, Play, Plus, Share2, User } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonDetailHeader, SkeletonRows } from '@/components/Skeleton'
import { SongList } from '@/components/SongList'
import { ScrollArea } from '@/components/ScrollArea'
import { toast } from '@/components/Toast'
import { fetchPlaylist, fetchToplist } from '@/hooks/data'
import { useAsync } from '@/hooks/useAsync'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { player, usePlayerView } from '@/hooks/usePlayerView'
import { navigate, useRoute } from '@/hooks/useRoute'
import { formatCount, formatDate, plainText } from '@/utils/format'
import { cx } from '@/utils/format'
import './Detail.css'

/** 歌单详情页（也用于榜单详情） */
export function PlaylistDetailPage(): JSX.Element {
  const route = useRoute()
  const id = route.segments[1] ?? route.query.get('id') ?? ''
  const isToplist = route.query.get('type') === 'toplist'
  const { favorites, queue } = usePlayerView()
  const [descExpanded, setDescExpanded] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () => (isToplist ? fetchToplist(id) : fetchPlaylist(id)),
    [id, isToplist],
    !!id
  )

  const palette = useCoverPalette(data?.coverImgUrl, id)

  const tracks = data?.tracks ?? []
  const isAllFavorited = tracks.length > 0 && tracks.every(t => favorites.some(f => f.id === t.id))
  const inQueue = queue.length > 0 && tracks.length > 0 && queue[0]?.id === tracks[0]?.id

  const playAll = (): void => {
    if (!tracks.length) {
      toast.warning('该歌单暂无可播放歌曲')
      return
    }
    player.playQueue(tracks, 0)
    toast.success(`开始播放：${data?.name ?? '歌单'}`)
  }

  const toggleFavoriteAll = (): void => {
    if (!tracks.length) return
    if (isAllFavorited) {
      toast.info('请到「我喜欢的音乐」中逐首取消')
      return
    }
    let added = 0
    tracks.forEach(t => {
      if (!favorites.some(f => f.id === t.id)) {
        player.toggleFavorite(t)
        added++
      }
    })
    toast.success(added > 0 ? `已收藏 ${added} 首歌曲` : '歌曲都已在收藏中')
  }

  if (!id) {
    return (
      <ScrollArea padding={0}>
        <EmptyState kind="error" title="缺少歌单 ID" />
      </ScrollArea>
    )
  }

  if (loading) {
    return (
      <ScrollArea padding={0}>
        <div className="nt-detail">
          <SkeletonDetailHeader />
          <SkeletonRows count={10} />
        </div>
      </ScrollArea>
    )
  }

  if (error || !data) {
    return (
      <ScrollArea padding={0}>
        <EmptyState
          kind="error"
          title="歌单加载失败"
          description={error?.message || '请稍后重试'}
          action={
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="nt-btn nt-btn--soft nt-btn--sm" onClick={reload}>
                重新加载
              </button>
              <button type="button" className="nt-btn nt-btn--ghost nt-btn--sm" onClick={() => navigate('/discover')}>
                返回发现
              </button>
            </div>
          }
        />
      </ScrollArea>
    )
  }

  const desc = plainText(data.description)

  return (
    <ScrollArea padding={0}>
      <div className="nt-detail">
        {/* 头部：模糊封面背景 */}
        <header className="nt-detail__header" style={{ background: palette.gradient }}>
          <div className="nt-detail__backdrop" aria-hidden="true">
            {data.coverImgUrl && (
              <div className="nt-detail__backdrop-img" style={{ backgroundImage: `url("${data.coverImgUrl}")` }} />
            )}
          </div>

          <div className="nt-detail__header-inner">
            <Cover
              src={data.coverImgUrl}
              seed={data.id}
              size={188}
              radius={14}
              iconSize={40}
              shadow
              alt={data.name}
              className="nt-detail__cover"
            />
            <div className="nt-detail__info">
              <span className="nt-detail__badge">{isToplist ? '排行榜' : '歌单'}</span>
              <h1 className="nt-detail__title" title={data.name}>
                {data.name}
              </h1>

              {/* 创建者 */}
              {data.creator?.nickname && (
                <div className="nt-detail__creator">
                  <Cover
                    src={data.creator.avatarUrl}
                    seed={data.creator.id}
                    size={22}
                    round
                    radius={999}
                    iconSize={10}
                  />
                  <span
                    className="nt-detail__creator-name"
                    role="link"
                    tabIndex={0}
                    onClick={() => data.creator?.id && navigate(`/artist/${data.creator.id}`)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && data.creator?.id) navigate(`/artist/${data.creator.id}`)
                    }}
                  >
                    {data.creator.nickname}
                  </span>
                  {data.updateTime ? <span className="nt-detail__dot">·</span> : null}
                  {data.updateTime ? (
                    <span className="nt-detail__meta-item">
                      <CalendarDays size={12} />
                      {formatDate(data.updateTime)} 更新
                    </span>
                  ) : null}
                </div>
              )}

              {/* 标签 */}
              {data.tags && data.tags.length > 0 && (
                <div className="nt-detail__tags">
                  {data.tags.slice(0, 5).map(tag => (
                    <span className="nt-detail__tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* 简介 */}
              {desc && (
                <p
                  className={cx('nt-detail__desc', !descExpanded && 'is-clamped')}
                  onClick={() => setDescExpanded(v => !v)}
                  title={descExpanded ? '收起简介' : '展开简介'}
                >
                  {desc}
                </p>
              )}

              {/* 统计 */}
              <div className="nt-detail__stats">
                <span className="nt-detail__stat">
                  <strong>{data.trackCount || tracks.length}</strong> 首歌曲
                </span>
                <span className="nt-detail__stat">
                  <strong>{formatCount(data.playCount)}</strong> 次播放
                </span>
                {inQueue && <span className="nt-detail__playing-badge">正在播放</span>}
              </div>

              {/* 操作按钮 */}
              <div className="nt-detail__actions">
                <button type="button" className="nt-btn nt-btn--primary nt-detail__playall" onClick={playAll}>
                  <Play size={15} fill="currentColor" />
                  播放全部
                </button>
                <button
                  type="button"
                  className={cx('nt-btn nt-btn--ghost', isAllFavorited && 'is-fav')}
                  onClick={toggleFavoriteAll}
                >
                  <Heart size={15} fill={isAllFavorited ? 'currentColor' : 'none'} />
                  {isAllFavorited ? '已收藏' : '收藏'}
                </button>
                <button
                  type="button"
                  className="nt-btn nt-btn--ghost"
                  onClick={() => {
                    if (!tracks.length) return
                    const next = [...tracks]
                    player.setQueue(next)
                    toast.success('已加入播放列表')
                  }}
                >
                  <ListMusic size={15} />
                  加入列表
                </button>
                <button
                  type="button"
                  className="nt-btn nt-btn--ghost"
                  title="复制歌单链接"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`https://music.163.com/#/playlist?id=${data.id}`)
                    toast.success('歌单链接已复制')
                  }}
                >
                  <Share2 size={15} />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* 歌曲列表 */}
        <section className="nt-detail__body">
          <div className="nt-detail__list-head">
            <h2 className="nt-detail__list-title">歌曲列表</h2>
            <span className="nt-detail__list-count">{tracks.length} 首歌</span>
          </div>
          <SongList
            songs={tracks}
            listId={data.id}
            showAlbum
            showCover
            showHeader
            emptyText="该歌单暂无歌曲"
            extraMenuFor={song => [
              {
                key: 'artist-all',
                label: '查看歌手主页',
                icon: <User size={14} />,
                disabled: !song.artists?.[0],
                onClick: () => song.artists?.[0] && navigate(`/artist/${song.artists[0].id}`)
              },
              {
                key: 'append',
                label: '添加到播放列表',
                icon: <Plus size={14} />,
                onClick: () => {
                  player.addToQueue(song)
                  toast.success('已添加到播放列表')
                }
              }
            ]}
          />
        </section>
      </div>
    </ScrollArea>
  )
}
