import { useMemo, useState } from 'react'
import { Clock3, Heart, ListMusic, Play, Plus, Shuffle, Trash2 } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { EmptyState } from '@/components/EmptyState'
import { ScrollArea } from '@/components/ScrollArea'
import { SongList } from '@/components/SongList'
import { toast } from '@/components/Toast'
import { usePlayerView } from '@/hooks/usePlayerView'
import { player } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { cx, formatDuration } from '@/utils/format'
import './MyMusic.css'

type LibraryTab = 'favorites' | 'recent'

/** 我的音乐：我喜欢的音乐 + 最近播放 */
export function MyMusicPage(): JSX.Element {
  const { favorites, recent } = usePlayerView()
  const [tab, setTab] = useState<LibraryTab>('favorites')

  const list = tab === 'favorites' ? favorites : recent
  const totalDuration = useMemo(() => list.reduce((s, x) => s + (x.duration || 0), 0), [list])
  // 收藏封面拼贴：取前 4 首封面
  const coverOf = favorites[0]?.picUrl || favorites[0]?.album?.picUrl
  const palette = useCoverPalette(coverOf, 'favorites')

  const playAll = (): void => {
    if (!list.length) {
      toast.warning(tab === 'favorites' ? '还没有喜欢的歌曲' : '还没有播放记录')
      return
    }
    player.playQueue(list, 0)
    toast.success(tab === 'favorites' ? '开始播放我喜欢的音乐' : '开始播放最近播放')
  }

  const shuffleAll = (): void => {
    if (!list.length) return
    const shuffled = [...list]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    player.playQueue(shuffled, 0)
    toast.success('随机播放中')
  }

  return (
    <ScrollArea padding={0}>
      <div className="nt-detail">
        {/* 头部 */}
        <header
          className="nt-detail__header nt-mymusic__header"
          style={{
            background:
              tab === 'favorites' ? palette.gradient : 'linear-gradient(140deg, #3a4a6b, #1d2740)'
          }}
        >
          <div className="nt-detail__backdrop" aria-hidden="true">
            {tab === 'favorites' && coverOf && (
              <div className="nt-detail__backdrop-img" style={{ backgroundImage: `url("${coverOf}")` }} />
            )}
          </div>
          <div className="nt-detail__header-inner">
            <div className={cx('nt-mymusic__cover', tab === 'recent' && 'is-recent')}>
              {tab === 'favorites' ? (
                favorites.length > 0 ? (
                  <div className="nt-mymusic__collage">
                    {favorites.slice(0, 4).map((s, i) => (
                      <Cover key={`${s.id}-${i}`} src={s.picUrl || s.album?.picUrl} seed={s.id} radius={0} iconSize={16} />
                    ))}
                    {favorites.length < 4 &&
                      Array.from({ length: 4 - favorites.length }).map((_, i) => (
                        <div className="nt-mymusic__collage-empty" key={`e-${i}`}>
                          <Heart size={14} />
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="nt-mymusic__cover-empty">
                    <Heart size={44} strokeWidth={1.3} />
                  </div>
                )
              ) : (
                <div className="nt-mymusic__cover-empty is-recent">
                  <Clock3 size={44} strokeWidth={1.3} />
                </div>
              )}
            </div>

            <div className="nt-detail__info">
              <span className="nt-detail__badge">歌单</span>
              <h1 className="nt-detail__title">{tab === 'favorites' ? '我喜欢的音乐' : '最近播放'}</h1>
              <div className="nt-detail__stats">
                <span className="nt-detail__stat">
                  <strong>{list.length}</strong> 首歌曲
                </span>
                <span className="nt-detail__stat">
                  总时长 <strong>{formatDuration(totalDuration)}</strong>
                </span>
              </div>
              <div className="nt-detail__actions">
                <button type="button" className="nt-btn nt-btn--primary nt-detail__playall" onClick={playAll}>
                  <Play size={15} fill="currentColor" />
                  播放全部
                </button>
                <button type="button" className="nt-btn nt-btn--ghost" onClick={shuffleAll} disabled={!list.length}>
                  <Shuffle size={15} />
                  随机播放
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Tab + 列表 */}
        <section className="nt-detail__body">
          <div className="nt-mymusic__tabs" role="tablist" aria-label="我的音乐分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'favorites'}
              className={cx('nt-mymusic__tab', tab === 'favorites' && 'is-active')}
              onClick={() => setTab('favorites')}
            >
              <Heart size={14} fill={tab === 'favorites' ? 'currentColor' : 'none'} />
              我喜欢的音乐
              <span className="nt-mymusic__tab-count">{favorites.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recent'}
              className={cx('nt-mymusic__tab', tab === 'recent' && 'is-active')}
              onClick={() => setTab('recent')}
            >
              <Clock3 size={14} />
              最近播放
              <span className="nt-mymusic__tab-count">{recent.length}</span>
            </button>
          </div>

          {list.length === 0 ? (
            tab === 'favorites' ? (
              <EmptyState
                kind="heart"
                action={
                  <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => navigate('/discover')}>
                    去发现音乐
                  </button>
                }
              />
            ) : (
              <EmptyState
                kind="empty"
                title="还没有播放记录"
                description="播放任意歌曲后，这里会记录你的足迹"
                action={
                  <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => navigate('/discover')}>
                    去发现音乐
                  </button>
                }
              />
            )
          ) : (
            <SongList
              songs={list}
              showAlbum
              showCover
              showHeader
              extraMenuFor={song => [
                {
                  key: 'add',
                  label: '加入播放列表',
                  icon: <Plus size={14} />,
                  onClick: () => {
                    player.addToQueue(song)
                    toast.success('已加入播放列表')
                  }
                }
              ]}
            />
          )}

          {tab === 'favorites' && favorites.length > 0 && (
            <div className="nt-mymusic__footer">
              <ListMusic size={13} />
              <span>收藏会保存在本地，关闭应用后依然存在</span>
              <button
                type="button"
                className="nt-mymusic__clear"
                onClick={() => {
                  favorites.forEach(s => player.toggleFavorite(s))
                  toast.success('已清空我喜欢的音乐')
                }}
              >
                <Trash2 size={12} />
                清空收藏
              </button>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}
