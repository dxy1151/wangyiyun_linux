import { useEffect, useMemo, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { AlbumCard, ArtistCard, PlaylistCard } from '@/components/Cards'
import { EmptyState } from '@/components/EmptyState'
import { CardGrid, Page, PageTitle } from '@/components/Page'
import { ScrollArea } from '@/components/ScrollArea'
import { SkeletonGrid, SkeletonRows } from '@/components/Skeleton'
import { SongList } from '@/components/SongList'
import { fetchSearchAll } from '@/hooks/data'
import { useAsync } from '@/hooks/useAsync'
import { useRoute } from '@/hooks/useRoute'
import { useUi } from '@/store/ui'
import { cx } from '@/utils/format'
import './Search.css'

type TabKey = 'songs' | 'artists' | 'albums' | 'playlists'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'songs', label: '单曲' },
  { key: 'artists', label: '歌手' },
  { key: 'albums', label: '专辑' },
  { key: 'playlists', label: '歌单' }
]

const HOT_WORDS = ['周杰伦', '陈奕迅', '林俊杰', '薛之谦', '华语流行', '轻音乐', '纯音乐', '摇滚', '民谣', '古风', '爵士', '电子']

/** 搜索结果页：单曲 / 歌手 / 专辑 / 歌单 四个 Tab */
export function SearchPage(): JSX.Element {
  const route = useRoute()
  const keyword = route.query.get('k') ?? ''
  const [tab, setTab] = useState<TabKey>('songs')
  const requestFocusSearch = useUi(s => s.requestFocusSearch)

  const { data, loading, error, reload } = useAsync(() => fetchSearchAll(keyword), [keyword], keyword.trim().length > 0)

  // 关键词变化：重置到单曲页签
  useEffect(() => {
    setTab('songs')
  }, [keyword])

  const counts = useMemo(
    () => ({
      songs: data?.songs?.length ?? 0,
      artists: data?.artists?.length ?? 0,
      albums: data?.albums?.length ?? 0,
      playlists: data?.playlists?.length ?? 0
    }),
    [data]
  )

  const total = counts.songs + counts.artists + counts.albums + counts.playlists

  /* 未输入关键词：热搜词 */
  if (!keyword.trim()) {
    return (
      <ScrollArea padding={0}>
        <Page>
          <PageTitle title="搜索" subtitle="输入关键词，找到你想听的歌" />
          <section className="nt-search-page__hotwords">
            <h2 className="nt-search-page__hotwords-title">热门搜索</h2>
            <div className="nt-search-page__chips">
              {HOT_WORDS.map(word => (
                <button
                  key={word}
                  type="button"
                  className="nt-search-page__chip"
                  onClick={() => {
                    window.location.hash = `#/search?k=${encodeURIComponent(word)}`
                  }}
                >
                  {word}
                </button>
              ))}
            </div>
            <button type="button" className="nt-search-page__focus-btn" onClick={requestFocusSearch}>
              <SearchIcon size={14} />
              聚焦搜索框（Ctrl + K）
            </button>
          </section>
        </Page>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea padding={0}>
      <Page>
        <PageTitle
          title={`搜索：${keyword}`}
          subtitle={loading ? '正在搜索…' : error ? '搜索失败' : total === 0 ? '没有找到结果' : `找到 ${total} 条相关结果`}
        />

        {/* Tab 栏 */}
        <div className="nt-search-page__tabs" role="tablist" aria-label="搜索结果分类">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={cx('nt-search-page__tab', tab === t.key && 'is-active')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {!loading && counts[t.key] > 0 && <span className="nt-search-page__tab-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {/* 结果 */}
        {loading ? (
          tab === 'songs' ? (
            <SkeletonRows count={10} />
          ) : (
            <SkeletonGrid count={10} />
          )
        ) : error ? (
          <EmptyState
            kind="error"
            action={
              <button type="button" className="nt-btn nt-btn--soft nt-btn--sm" onClick={reload}>
                重新搜索
              </button>
            }
          />
        ) : total === 0 ? (
          <EmptyState kind="search" />
        ) : (
          <>
            {tab === 'songs' && (
              <SongList songs={data?.songs ?? []} showAlbum showCover showHeader emptyText="没有找到单曲" />
            )}

            {tab === 'artists' && (
              <CardGrid minWidth={130}>
                {(data?.artists ?? []).map(a => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </CardGrid>
            )}

            {tab === 'albums' && (
              <CardGrid>
                {(data?.albums ?? []).map(a => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </CardGrid>
            )}

            {tab === 'playlists' && (
              <CardGrid>
                {(data?.playlists ?? []).map(p => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </CardGrid>
            )}
          </>
        )}
      </Page>
    </ScrollArea>
  )
}
