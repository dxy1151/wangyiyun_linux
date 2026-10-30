import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cx } from '@/utils/format'
import './Toast.css'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  /** 毫秒，0 表示不自动关闭 */
  duration: number
}

interface ToastStore {
  items: ToastItem[]
  push: (message: string, kind?: ToastKind, duration?: number) => number
  dismiss: (id: number) => void
}

let seq = 0

const useToastStore = create<ToastStore>()((set, get) => ({
  items: [],
  push: (message, kind = 'info', duration = 2400) => {
    const id = ++seq
    // 最多同时显示 4 条
    const next = [...get().items, { id, kind, message, duration }]
    set({ items: next.slice(-4) })
    return id
  },
  dismiss: id => set({ items: get().items.filter(t => t.id !== id) })
}))

/** 命令式调用：toast.success('已收藏') */
export const toast = {
  show: (message: string, kind: ToastKind = 'info', duration = 2400): number =>
    useToastStore.getState().push(message, kind, duration),
  info: (message: string, duration?: number): number => useToastStore.getState().push(message, 'info', duration),
  success: (message: string, duration?: number): number => useToastStore.getState().push(message, 'success', duration),
  error: (message: string, duration?: number): number => useToastStore.getState().push(message, 'error', duration),
  warning: (message: string, duration?: number): number => useToastStore.getState().push(message, 'warning', duration),
  dismiss: (id: number): void => useToastStore.getState().dismiss(id)
}

const ICONS: Record<ToastKind, JSX.Element> = {
  info: <Info size={18} />,
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />
}

function ToastEntry({ item }: { item: ToastItem }): JSX.Element {
  const dismiss = useToastStore(s => s.dismiss)
  const [leaving, setLeaving] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  const close = (): void => {
    setLeaving(true)
    window.setTimeout(() => dismiss(item.id), 200)
  }

  useEffect(() => {
    if (!item.duration) return
    timerRef.current = window.setTimeout(close, item.duration)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.duration])

  return (
    <div
      className={cx('nt-toast', `nt-toast--${item.kind}`, leaving && 'is-leaving')}
      role={item.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="nt-toast__icon">{ICONS[item.kind]}</span>
      <span className="nt-toast__msg">{item.message}</span>
      <button type="button" className="nt-toast__close" onClick={close} aria-label="关闭提示">
        <X size={13} />
      </button>
    </div>
  )
}

/** Toast 容器：在 App 根部渲染一次 */
export function ToastContainer(): JSX.Element {
  const items = useToastStore(s => s.items)
  return (
    <div className="nt-toast-host" aria-live="polite" aria-atomic="false">
      {items.map(item => (
        <ToastEntry key={item.id} item={item} />
      ))}
    </div>
  )
}
