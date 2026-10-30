import { useCallback } from 'react'
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { Cover } from '@/components/Cover'
import { player, useFavoriteIds, usePlayerView } from '@/hooks/usePlayerView'
import { setWindowMode, winAction } from '@/hooks/useBridge'
import { useUi } from '@/store/ui'
import { cx, joinArtists } from '@/utils/format'
import './MiniPlayer.css'

/**
 * 迷你播放器（320x120 窗口模式）
 * - 整窗可拖拽，按钮区 no-drag
 * - 双行歌词 + 细进度条 + 播放控制
 * - 右上角：还原普通模式 / 关闭
 */
export function MiniPlayer(): JSX.Element {
  const { current, isPlaying, progress, duration, lyricIndex, lyrics, isBuffering } = usePlayerView()
  const favoriteIds = useFavoriteIds()
  const setWindowModeState = useUi(s => s.setWindowMode)
  const liked = !!current && favoriteIds.has(current.id)

  const restore = useCallback(() => {
    setWindowMode('normal')
    setWindowModeState('normal')
  }, [setWindowModeState])

  const close = useCallback(() => {
    winAction('close')
  }, [])

  const artist = current ? current.artistText || joinArtists(current.artists) : '暂无播放'
  const currentLyric = lyricIndex >= 0 && lyrics[lyricIndex] ? lyrics[lyricIndex].text : ''
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0

  return (
    <div className="nt-mini nt-drag" onDoubleClick={restore}>
      {/* 背景：封面取色模糊 */}
      <div
        className="nt-mini__bg"
        style={current?.picUrl || current?.album?.picUrl ? { backgroundImage: `url("${current.picUrl || current.album?.picUrl}")` } : undefined}
        aria-hidden="true"
      />

      {/* 顶部操作 */}
      <div className="nt-mini__topbar nt-no-drag">
        <span className="nt-mini__brand">网易云音乐</span>
        <div className="nt-mini__wbtn-group">
          <button type="button" className="nt-mini__wbtn" aria-label="还原窗口" title="还原" onClick={restore}>
            <Maximize2 size={12} />
          </button>
          <button type="button" className="nt-mini__wbtn is-close" aria-label="关闭" title="关闭" onClick={close}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="nt-mini__body">
        {/* 封面 */}
        <button
          type="button"
          className={cx('nt-mini__cover-wrap nt-no-drag', isPlaying && 'is-playing')}
          onClick={restore}
          aria-label="还原窗口"
          title="还原"
        >
          <div className="nt-mini__disc">
            <Cover
              src={current?.picUrl || current?.album?.picUrl}
              seed={current?.id ?? 'none'}
              round
              radius={999}
              size={54}
              iconSize={18}
              alt={current?.name ?? '封面'}
            />
          </div>
          {isBuffering && <span className="nt-mini__spinner" aria-label="缓冲中" />}
        </button>

        {/* 信息 + 歌词 */}
        <div className="nt-mini__info">
          <div className="nt-mini__title-row">
            <span className="nt-mini__title nt-ellipsis" title={current?.name}>
              {current ? current.name : '暂无播放'}
            </span>
            {current && (
              <button
                type="button"
                className={cx('nt-mini__like nt-no-drag', liked && 'is-liked')}
                aria-label={liked ? '取消喜欢' : '喜欢'}
                title={liked ? '取消喜欢' : '喜欢'}
                onClick={() => player.toggleFavorite(current)}
              >
                <Heart size={12} fill={liked ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>
          <span className="nt-mini__artist nt-ellipsis" title={artist}>
            {artist}
          </span>
          <span className="nt-mini__lyric nt-ellipsis" title={currentLyric}>
            {currentLyric || (lyrics.length === 0 && current ? '纯音乐，请欣赏' : '')}
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div
        className="nt-mini__progress nt-no-drag"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(progress)}
        onClick={e => {
          if (duration <= 0) return
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          player.seek(ratio * duration)
        }}
      >
        <div className="nt-mini__progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* 控制按钮 */}
      <div className="nt-mini__controls nt-no-drag">
        <button type="button" className="nt-mini__ctrl" aria-label="上一首" title="上一首" onClick={() => player.prev()} disabled={!current}>
          <SkipBack size={15} fill="currentColor" />
        </button>
        <button
          type="button"
          className="nt-mini__ctrl is-primary"
          aria-label={isPlaying ? '暂停' : '播放'}
          title={isPlaying ? '暂停' : '播放'}
          onClick={() => player.toggle()}
          disabled={!current}
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <button type="button" className="nt-mini__ctrl" aria-label="下一首" title="下一首" onClick={() => player.next()} disabled={!current}>
          <SkipForward size={15} fill="currentColor" />
        </button>
      </div>
    </div>
  )
}
