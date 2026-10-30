import type { ReactNode } from 'react'
import { CloudOff, Disc3, Heart, ListMusic, SearchX, WifiOff } from 'lucide-react'
import { cx } from '@/utils/format'
import './EmptyState.css'

export type EmptyKind = 'empty' | 'search' | 'error' | 'heart' | 'playlist' | 'offline'

export interface EmptyStateProps {
  kind?: EmptyKind
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}

const PRESET: Record<EmptyKind, { icon: ReactNode; title: string; description: string }> = {
  empty: {
    icon: <Disc3 size={44} strokeWidth={1.3} />,
    title: '这里空空如也',
    description: '去发现页逛逛吧'
  },
  search: {
    icon: <SearchX size={44} strokeWidth={1.3} />,
    title: '没有找到相关内容',
    description: '换个关键词试试，或者检查一下拼写'
  },
  error: {
    icon: <CloudOff size={44} strokeWidth={1.3} />,
    title: '加载失败',
    description: '网络似乎开小差了，请稍后重试'
  },
  heart: {
    icon: <Heart size={44} strokeWidth={1.3} />,
    title: '我喜欢的音乐还是空的',
    description: '在歌曲上点一下红心，就会收藏到这里'
  },
  playlist: {
    icon: <ListMusic size={44} strokeWidth={1.3} />,
    title: '播放列表是空的',
    description: '双击歌曲即可开始播放'
  },
  offline: {
    icon: <WifiOff size={44} strokeWidth={1.3} />,
    title: '网络连接不可用',
    description: '请检查网络设置后重试'
  }
}

export function EmptyState({
  kind = 'empty',
  title,
  description,
  action,
  className,
  compact = false
}: EmptyStateProps): JSX.Element {
  const preset = PRESET[kind]
  return (
    <div className={cx('nt-empty', compact && 'is-compact', className)} role="status">
      <div className="nt-empty__icon" aria-hidden="true">
        {preset.icon}
      </div>
      <h3 className="nt-empty__title">{title ?? preset.title}</h3>
      <p className="nt-empty__desc">{description ?? preset.description}</p>
      {action && <div className="nt-empty__action">{action}</div>}
    </div>
  )
}
