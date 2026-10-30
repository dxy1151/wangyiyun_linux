import { useCallback, useMemo, useState } from 'react'
import {
  ChevronDown,
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { PlayMode } from '@/api/types'
import { Cover } from '@/components/Cover'
import { IconButton } from '@/components/IconButton'
import { LyricsView } from '@/components/LyricsView'
import { ProgressSlider, VolumeControl } from '@/components/ProgressSlider'
import { EmptyState } from '@/components/EmptyState'
import { toast } from '@/components/Toast'
import { useCoverPalette } from '@/hooks/useCoverPalette'
import { player, useFavoriteIds, usePlayerView } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { useUi } from '@/store/ui'
import { PLAY_MODE_LABEL } from '@/store/player'
import { withAlpha } from '@/utils/format'
import { cx, formatDuration, joinArtists } from '@/utils/format'
import './PlayerPage.css'

const MODE_ICON: Record<PlayMode, JSX.Element> = {
  loop: <Repeat size={16} />,
  order: <Repeat size={16} />,
  'repeat-one': <Repeat1 size={16} />,
  shuffle: <Shuffle size={16} />
}

const MODE_ORDER: PlayMode[] = ['loop', 'order', 'repeat-one', 'shuffle']

/** 全屏播放页：模糊封面背景 + 黑胶唱片 + 卡拉OK歌词 */
export function PlayerPage(): JSX.Element {
  const { current, isPlaying, progress, duration, volume, mode, lyrics, isBuffering } = usePlayerView()
  const favoriteIds = useFavoriteIds()
  const toggleQueue = useUi(s => s.toggleQueue)
  const [showTranslation, setShowTranslation] = useState(true)

  const palette = useCoverPalette(current?.picUrl || current?.album?.picUrl, current?.id)
  const liked = !!current && favoriteIds.has(current.id)
  const artist = current ? current.artistText || joinArtists(current.artists) : ''

  const bassColor = useMemo(() => withAlpha(palette.color, 0.5), [palette.color])
  const bassColor2 = useMemo(() => withAlpha(palette.color2, 0.34), [palette.color2])

  const close = useCallback(() => {
    if (window.history.length > 1) window.history.back()
    else navigate('/discover', { replace: true })
  }, [])

  const cycleMode = useCallback(() => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
    player.setMode(next)
    toast.info(`播放模式：${PLAY_MODE_LABEL[next]}`)
  }, [mode])

  const volumeIcon = volume <= 0.001 ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />

  if (!current) {
    return (
      <div className="nt-ppage nt-ppage--empty">
        <button type="button" className="nt-ppage__close" onClick={close} aria-label="返回" title="返回">
          <ChevronDown size={22} />
        </button>
        <EmptyState
          kind="empty"
          title="还没有正在播放的歌曲"
          description="去发现页挑一首歌开始播放吧"
          action={
            <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => navigate('/discover')}>
              去发现音乐
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="nt-ppage" style={{ ['--accent' as string]: palette.color, ['--accent2' as string]: palette.color2 }}>
      {/* 背景：封面模糊 + 取色渐变 */}
      <div className="nt-ppage__bg" aria-hidden="true">
        {(current.picUrl || current.album?.picUrl) && (
          <div
            className="nt-ppage__bg-img"
            style={{ backgroundImage: `url("${current.picUrl || current.album?.picUrl}")` }}
          />
        )}
        <div
          className="nt-ppage__bg-tint"
          style={{ background: `radial-gradient(ellipse at 24% 34%, ${bassColor}, transparent 62%), radial-gradient(ellipse at 78% 68%, ${bassColor2}, transparent 58%)` }}
        />
      </div>

      {/* 顶栏 */}
      <header className="nt-ppage__topbar">
        <button type="button" className="nt-ppage__close" onClick={close} aria-label="收起播放页" title="收起（Esc）">
          <ChevronDown size={24} />
        </button>
        <span className="nt-ppage__topbar-title">正在播放</span>
        <div className="nt-ppage__topbar-right">
          <IconButton
            label={showTranslation ? '隐藏译文' : '显示译文'}
            active={showTranslation}
            onClick={() => setShowTranslation(v => !v)}
          >
            <Mic2 size={17} />
          </IconButton>
          <IconButton label="播放列表" onClick={toggleQueue}>
            <ListMusic size={17} />
          </IconButton>
        </div>
      </header>

      {/* 主体：左唱片 / 右歌词 */}
      <main className="nt-ppage__main">
        <section className="nt-ppage__left">
          {/* 黑胶唱片 */}
          <div className={cx('nt-ppage__disc-wrap', isPlaying && 'is-playing')}>
            <div className="nt-ppage__disc">
              {/* 唱片纹路 */}
              <div className="nt-ppage__grooves" aria-hidden="true" />
              <div className="nt-ppage__disc-cover">
                <Cover
                  src={current.picUrl || current.album?.picUrl}
                  seed={current.id}
                  round
                  radius={999}
                  size="100%"
                  iconSize={40}
                  alt={current.name}
                  scale={2}
                />
              </div>
              <span className="nt-ppage__disc-hole" aria-hidden="true" />
            </div>
            {isBuffering && <span className="nt-ppage__buffering" aria-label="缓冲中" />}
          </div>

          {/* 歌曲信息 */}
          <div className="nt-ppage__meta">
            <div className="nt-ppage__title-row">
              <h1 className="nt-ppage__title nt-ellipsis" title={current.name}>
                {current.name}
              </h1>
              <button
                type="button"
                className={cx('nt-ppage__like', liked && 'is-liked')}
                aria-label={liked ? '取消喜欢' : '喜欢'}
                title={liked ? '取消喜欢' : '喜欢'}
                onClick={() => {
                  player.toggleFavorite(current)
                  toast.success(liked ? '已取消喜欢' : '已添加到我喜欢的音乐')
                }}
              >
                <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
              </button>
            </div>

            <div className="nt-ppage__submeta">
              <span
                className="nt-ppage__artist-link"
                role="link"
                tabIndex={0}
                onClick={() => current.artists?.[0] && navigate(`/artist/${current.artists[0].id}`)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && current.artists?.[0]) navigate(`/artist/${current.artists[0].id}`)
                }}
              >
                {artist}
              </span>
              {current.album?.name && (
                <>
                  <span className="nt-ppage__sep">·</span>
                  <span
                    className="nt-ppage__album-link"
                    role="link"
                    tabIndex={0}
                    onClick={() => current.album?.id && navigate(`/album/${current.album.id}`)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && current.album?.id) navigate(`/album/${current.album.id}`)
                    }}
                  >
                    专辑《{current.album.name}》
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        {/* 歌词区 */}
        <section className="nt-ppage__lyrics-wrap">
          <LyricsView
            lines={lyrics}
            progress={progress}
            align="center"
            showTranslation={showTranslation}
            scale={1.1}
            onSeekLine={ms => player.seek(ms)}
            emptyText="纯音乐，请欣赏"
            className="nt-ppage__lyrics"
          />
        </section>
      </main>

      {/* 底部控制条 */}
      <footer className="nt-ppage__footer">
        <div className="nt-ppage__progress-row">
          <span className="nt-ppage__time">{formatDuration(progress)}</span>
          <ProgressSlider value={progress} max={duration} onSeek={ms => player.seek(ms)} ariaLabel="播放进度" />
          <span className="nt-ppage__time">{formatDuration(duration)}</span>
        </div>

        <div className="nt-ppage__controls">
          <div className="nt-ppage__controls-left">
            <IconButton label={PLAY_MODE_LABEL[mode]} onClick={cycleMode} active={mode === 'shuffle' || mode === 'repeat-one'}>
              {MODE_ICON[mode]}
            </IconButton>
          </div>

          <div className="nt-ppage__controls-center">
            <IconButton label="上一首" onClick={() => player.prev()} dimension={40}>
              <SkipBack size={22} fill="currentColor" />
            </IconButton>
            <button
              type="button"
              className="nt-ppage__play"
              aria-label={isPlaying ? '暂停' : '播放'}
              onClick={() => player.toggle()}
            >
              {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
            </button>
            <IconButton label="下一首" onClick={() => player.next()} dimension={40}>
              <SkipForward size={22} fill="currentColor" />
            </IconButton>
          </div>

          <div className="nt-ppage__controls-right">
            <IconButton label={volume > 0 ? '静音' : '取消静音'} onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)}>
              {volumeIcon}
            </IconButton>
            <VolumeControl value={volume} onChange={v => player.setVolume(v)} />
            <IconButton label="关闭播放页" onClick={close}>
              <X size={17} />
            </IconButton>
          </div>
        </div>
      </footer>
    </div>
  )
}
