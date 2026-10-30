import { useCallback, useMemo } from 'react'
import {
  Heart,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { PlayMode } from '@/api/types'
import { Cover } from '@/components/Cover'
import { IconButton } from '@/components/IconButton'
import { ProgressSlider, VolumeControl } from '@/components/ProgressSlider'
import { openContextMenu } from '@/components/ContextMenu'
import { toast } from '@/components/Toast'
import { MiniLyrics } from '@/components/LyricsView'
import { player, usePlayerView } from '@/hooks/usePlayerView'
import { navigate } from '@/hooks/useRoute'
import { useUi } from '@/store/ui'
import { cx, formatDuration } from '@/utils/format'
import './PlayerBar.css'

const MODE_META: Record<PlayMode, { label: string; icon: JSX.Element }> = {
  loop: { label: '列表循环', icon: <Repeat size={16} /> },
  order: { label: '顺序播放', icon: <Repeat size={16} /> },
  'repeat-one': { label: '单曲循环', icon: <Repeat1 size={16} /> },
  shuffle: { label: '随机播放', icon: <Shuffle size={16} /> }
}

const MODE_ORDER: PlayMode[] = ['loop', 'order', 'repeat-one', 'shuffle']

/** 底部播放栏：旋转封面 + 歌曲信息 + 控制区 + 进度 + 音量 + 播放列表 */
export function PlayerBar(): JSX.Element {
  const view = usePlayerView()
  const { current, isPlaying, progress, duration, volume, mode, favorites } = view
  const queueOpen = useUi(s => s.queueOpen)
  const toggleQueue = useUi(s => s.toggleQueue)

  const liked = useMemo(() => !!current && favorites.some(f => f.id === current.id), [favorites, current])
  const modeMeta = MODE_META[mode] ?? MODE_META.loop

  const togglePlay = useCallback(() => player.toggle(), [])
  const cycleMode = useCallback(() => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
    player.setMode(next)
    toast.info(`播放模式：${MODE_META[next].label}`)
  }, [mode])

  const volumeIcon =
    volume <= 0.001 ? <VolumeX size={17} /> : volume < 0.5 ? <Volume1 size={17} /> : <Volume2 size={17} />

  const artistText = current
    ? current.artistText || current.artists?.map(a => a.name).join(' / ') || '未知歌手'
    : ''

  const onCoverContextMenu = (e: React.MouseEvent): void => {
    if (!current) return
    openContextMenu(e, [
      { key: 'page', label: '进入播放页', icon: <Maximize2 size={14} />, onClick: () => navigate('/player') },
      { key: 'artist', label: '查看歌手', onClick: () => current.artists?.[0] && navigate(`/artist/${current.artists[0].id}`) },
      { key: 'album', label: '查看专辑', onClick: () => current.album?.id && navigate(`/album/${current.album.id}`) }
    ])
  }

  return (
    <footer className={cx('nt-playerbar', queueOpen && 'has-queue')}>
      {/* 顶部细进度条（不经 hover 也能感知） */}
      <div className="nt-playerbar__topline">
        <div
          className="nt-playerbar__topline-fill"
          style={{ width: `${duration > 0 ? Math.min(100, (progress / duration) * 100) : 0}%` }}
        />
      </div>

      <div className="nt-playerbar__inner">
        {/* 左：封面 + 歌曲信息 + 收藏 */}
        <div className="nt-playerbar__left">
          <button
            type="button"
            className={cx('nt-playerbar__cover-btn', isPlaying && 'is-playing')}
            onClick={() => navigate('/player')}
            onContextMenu={onCoverContextMenu}
            aria-label={current ? `打开播放页：${current.name}` : '暂无播放'}
            title={current ? '打开播放页' : '暂无播放'}
          >
            <div className="nt-playerbar__disc">
              <Cover
                src={current?.picUrl || current?.album?.picUrl}
                seed={current?.id ?? 'none'}
                round
                radius={999}
                size={52}
                iconSize={20}
                alt={current?.name ?? '封面'}
              />
              <span className="nt-playerbar__needle" aria-hidden="true" />
            </div>
          </button>

          <div className="nt-playerbar__meta">
            <div className="nt-playerbar__titleline">
              <span className="nt-playerbar__title nt-ellipsis" title={current?.name}>
                {current ? current.name : '暂无播放'}
              </span>
              {current && (
                <button
                  type="button"
                  className={cx('nt-playerbar__like', liked && 'is-liked')}
                  aria-label={liked ? '取消喜欢' : '喜欢'}
                  title={liked ? '取消喜欢' : '喜欢'}
                  onClick={() => {
                    player.toggleFavorite(current)
                    toast.success(liked ? '已取消喜欢' : '已添加到我喜欢的音乐')
                  }}
                >
                  <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
            <div className="nt-playerbar__subline">
              {current ? (
                <>
                  <span
                    className="nt-playerbar__artist nt-ellipsis"
                    role="link"
                    tabIndex={0}
                    onClick={() => current.artists?.[0] && navigate(`/artist/${current.artists[0].id}`)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && current.artists?.[0]) navigate(`/artist/${current.artists[0].id}`)
                    }}
                    title={artistText}
                  >
                    {artistText}
                  </span>
                  <MiniLyrics className="nt-playerbar__lyrics" />
                </>
              ) : (
                <span className="nt-playerbar__hint">选择一首歌开始收听</span>
              )}
            </div>
          </div>
        </div>

        {/* 中：控制 + 进度 */}
        <div className="nt-playerbar__center">
          <div className="nt-playerbar__controls">
            <IconButton
              label={modeMeta.label}
              onClick={cycleMode}
              active={mode === 'shuffle' || mode === 'repeat-one'}
              className="nt-playerbar__mode"
            >
              {modeMeta.icon}
            </IconButton>

            <IconButton label="上一首" onClick={() => player.prev()} disabled={!current}>
              <SkipBack size={18} fill="currentColor" />
            </IconButton>

            <button
              type="button"
              className="nt-playerbar__play"
              aria-label={isPlaying ? '暂停' : '播放'}
              title={isPlaying ? '暂停' : '播放'}
              onClick={togglePlay}
              disabled={!current}
            >
              {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            </button>

            <IconButton label="下一首" onClick={() => player.next()} disabled={!current}>
              <SkipForward size={18} fill="currentColor" />
            </IconButton>

            <IconButton label="打开播放页" onClick={() => navigate('/player')}>
              <Maximize2 size={16} />
            </IconButton>
          </div>

          <div className="nt-playerbar__progress">
            <span className="nt-playerbar__time">{formatDuration(progress)}</span>
            <ProgressSlider
              value={progress}
              max={duration}
              onSeek={ms => player.seek(ms)}
              disabled={!current}
              ariaLabel="播放进度"
            />
            <span className="nt-playerbar__time">{formatDuration(duration)}</span>
          </div>
        </div>

        {/* 右：音量 + 播放列表 */}
        <div className="nt-playerbar__right">
          <div className="nt-playerbar__volume">
            <IconButton
              label={volume > 0 ? '静音' : '取消静音'}
              onClick={() => player.setVolume(volume > 0 ? 0 : 0.8)}
            >
              {volumeIcon}
            </IconButton>
            <VolumeControl value={volume} onChange={v => player.setVolume(v)} />
          </div>

          <IconButton
            label="播放列表"
            active={queueOpen}
            onClick={toggleQueue}
            className="nt-playerbar__queue-btn"
          >
            <ListMusic size={18} />
          </IconButton>
        </div>
      </div>
    </footer>
  )
}
