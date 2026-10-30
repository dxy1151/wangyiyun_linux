import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '@/utils/format'
import './Modal.css'

export interface ModalProps {
  open: boolean
  title?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  /** 宽度，默认 440 */
  width?: number | string
  /** 点击遮罩关闭 */
  maskClosable?: boolean
  /** 是否显示关闭按钮 */
  closable?: boolean
  className?: string
}

/** 通用模态框（遮罩 + 居中卡片 + Esc 关闭 + 焦点管理） */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 440,
  maskClosable = true,
  closable = true,
  className
}: ModalProps): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    // 打开后焦点移入对话框
    const timer = window.setTimeout(() => {
      const focusable = cardRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }, 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      lastFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="nt-modal-mask"
      onMouseDown={e => {
        if (maskClosable && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        className={cx('nt-modal', className)}
        role="dialog"
        aria-modal="true"
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      >
        {(title || closable) && (
          <header className="nt-modal__head">
            <h2 className="nt-modal__title">{title}</h2>
            {closable && (
              <button type="button" className="nt-modal__close" onClick={onClose} aria-label="关闭">
                <X size={17} />
              </button>
            )}
          </header>
        )}
        <div className="nt-modal__body">{children}</div>
        {footer && <footer className="nt-modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}

export interface ConfirmOptions {
  title?: React.ReactNode
  message: React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel?: () => void
}

/** 确认对话框（受控使用） */
export function ConfirmDialog({
  open,
  options,
  onClose
}: {
  open: boolean
  options: ConfirmOptions
  onClose: () => void
}): JSX.Element {
  return (
    <Modal
      open={open}
      title={options.title ?? '确认操作'}
      width={380}
      onClose={() => {
        options.onCancel?.()
        onClose()
      }}
      footer={
        <div className="nt-modal__actions">
          <button
            type="button"
            className="nt-btn nt-btn--ghost"
            onClick={() => {
              options.onCancel?.()
              onClose()
            }}
          >
            {options.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className={cx('nt-btn', options.danger ? 'nt-btn--danger' : 'nt-btn--primary')}
            onClick={() => {
              options.onConfirm()
              onClose()
            }}
          >
            {options.confirmText ?? '确定'}
          </button>
        </div>
      }
    >
      <p className="nt-modal__text">{options.message}</p>
    </Modal>
  )
}
