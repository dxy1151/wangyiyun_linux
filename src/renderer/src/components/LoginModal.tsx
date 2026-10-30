import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Cookie, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { toast } from '@/components/Toast'
import { authAvailable, openExternal } from '@/hooks/useBridge'
import type { QrState } from '@/store/auth'
import { createQr, pollQr, useAuth } from '@/store/auth'
import { QR_STATUS_TEXT } from '@/store/authTypes'
import { cx } from '@/utils/format'
import './LoginModal.css'

export type LoginTab = 'qr' | 'cookie'

export interface LoginModalProps {
  open: boolean
  onClose: () => void
  /** 默认打开的 Tab */
  defaultTab?: LoginTab
  /** 登录成功回调 */
  onSuccess?: () => void
}

/** 登录弹窗：扫码登录 / Cookie 登录 */
export function LoginModal({ open, onClose, defaultTab = 'qr', onSuccess }: LoginModalProps): JSX.Element {
  const [tab, setTab] = useState<LoginTab>(defaultTab)
  const available = authAvailable()

  // 打开时重置 tab
  useEffect(() => {
    if (open) setTab(defaultTab)
  }, [open, defaultTab])

  const handleSuccess = useCallback(() => {
    onSuccess?.()
    onClose()
  }, [onSuccess, onClose])

  return (
    <Modal open={open} onClose={onClose} width={420} closable title={null} className="nt-login-modal">
      <div className="nt-login">
        {/* 顶部品牌区 */}
        <div className="nt-login__hero">
          <div className="nt-login__logo" aria-hidden="true">
            ♪
          </div>
          <h2 className="nt-login__title">登录网易云音乐</h2>
          <p className="nt-login__subtitle">登录后可同步歌单、收藏与听歌记录</p>
        </div>

        {!available && (
          <div className="nt-login__warn">
            当前环境未启用账号功能（主进程登录 IPC 尚未就绪），界面可预览但无法真实登录。
          </div>
        )}

        {/* Tab 切换 */}
        <div className="nt-login__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'qr'}
            className={cx('nt-login__tab', tab === 'qr' && 'is-active')}
            onClick={() => setTab('qr')}
          >
            <QrCode size={15} />
            扫码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'cookie'}
            className={cx('nt-login__tab', tab === 'cookie' && 'is-active')}
            onClick={() => setTab('cookie')}
          >
            <Cookie size={15} />
            Cookie 登录
          </button>
        </div>

        {tab === 'qr' ? (
          <QrLogin onSuccess={handleSuccess} available={available} />
        ) : (
          <CookieLogin onSuccess={handleSuccess} />
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 扫码登录                                                             */
/* ------------------------------------------------------------------ */

function QrLogin({ onSuccess, available }: { onSuccess: () => void; available: boolean }): JSX.Element {
  const applyLoggedIn = useAuth(s => s.applyLoggedIn)
  const [qr, setQr] = useState<QrState>({
    qrDataUrl: null,
    unikey: null,
    status: null,
    message: '',
    creating: true
  })
  const [refreshing, setRefreshing] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const doneRef = useRef(false)

  const load = useCallback(async () => {
    doneRef.current = false
    setRefreshing(true)
    const next = await createQr()
    setQr(next)
    setRefreshing(false)
  }, [])

  // 首次加载二维码
  useEffect(() => {
    if (!available) {
      setQr({ qrDataUrl: null, unikey: null, status: null, message: '当前环境不支持扫码登录', creating: false })
      return
    }
    void load()
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [available, load])

  // 轮询二维码状态
  useEffect(() => {
    if (!qr.unikey || doneRef.current) return
    // 803 成功后不再轮询
    if (qr.status === 803) return

    timerRef.current = window.setInterval(async () => {
      const res = await pollQr(qr.unikey as string)
      if (!res) return
      setQr(prev => ({ ...prev, status: res.status, message: res.message || QR_STATUS_TEXT[res.status] }))

      if (res.status === 803 && !doneRef.current) {
        doneRef.current = true
        if (timerRef.current) window.clearInterval(timerRef.current)
        if (res.user) {
          await applyLoggedIn(res.user)
          toast.success(`登录成功，欢迎回来，${res.user.nickname}`)
          onSuccess()
        } else {
          // 后端没带 user 时，重新拉一次会话
          await useAuth.getState().refreshSession()
          toast.success('登录成功')
          onSuccess()
        }
      }
      // 过期后停止轮询，等用户点刷新
      if (res.status === 800) {
        if (timerRef.current) window.clearInterval(timerRef.current)
      }
    }, 2000)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [qr.unikey, qr.status, applyLoggedIn, onSuccess])

  const expired = qr.status === 800
  const waiting = qr.creating || refreshing

  return (
    <div className="nt-qr">
      <div className={cx('nt-qr__frame', expired && 'is-expired')}>
        {qr.qrDataUrl && !expired ? (
          <img className="nt-qr__img" src={qr.qrDataUrl} alt="扫码登录二维码" draggable={false} />
        ) : (
          <div className="nt-qr__placeholder">
            {waiting ? (
              <RefreshCw size={26} className="nt-qr__spinner" />
            ) : (
              <button type="button" className="nt-qr__refresh" onClick={() => void load()}>
                <RefreshCw size={20} />
                刷新二维码
              </button>
            )}
          </div>
        )}

        {/* 扫过后覆盖提示 */}
        {qr.status === 802 && (
          <div className="nt-qr__overlay">
            <CheckCircle2 size={26} />
            <span>扫描成功</span>
            <span className="nt-qr__overlay-sub">请在手机上确认登录</span>
          </div>
        )}
        {expired && (
          <div className="nt-qr__overlay is-expired">
            <span>二维码已过期</span>
            <button type="button" className="nt-btn nt-btn--primary nt-btn--sm" onClick={() => void load()}>
              点击刷新
            </button>
          </div>
        )}
      </div>

      <p className={cx('nt-qr__status', qr.status === 803 && 'is-success')}>
        {qr.message || QR_STATUS_TEXT[801]}
      </p>

      <div className="nt-qr__tips">
        <Smartphone size={13} />
        <span>打开网易云音乐 App → 左上角菜单 → 扫一扫</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cookie 登录                                                          */
/* ------------------------------------------------------------------ */

function CookieLogin({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const loginByCookie = useAuth(s => s.loginByCookie)
  const [cookie, setCookie] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const submit = async (): Promise<void> => {
    const value = cookie.trim()
    if (!value) {
      toast.warning('请先粘贴 Cookie')
      return
    }
    if (!/MUSIC_U=|MUSIC_A=/.test(value)) {
      toast.warning('Cookie 中未找到 MUSIC_U 字段，请确认复制完整')
    }
    setSubmitting(true)
    const res = await loginByCookie(value)
    setSubmitting(false)
    if (res.ok) {
      toast.success('登录成功')
      onSuccess()
    } else {
      toast.error(res.error ?? '登录失败')
    }
  }

  return (
    <div className="nt-cookie">
      <div className="nt-cookie__help-toggle">
        <button type="button" className="nt-cookie__help-btn" onClick={() => setShowHelp(v => !v)}>
          {showHelp ? '收起说明' : '如何获取 Cookie？'}
        </button>
      </div>

      {showHelp && (
        <ol className="nt-cookie__steps">
          <li>
            在浏览器打开{' '}
            <button
              type="button"
              className="nt-cookie__link"
              onClick={() => openExternal('https://music.163.com')}
            >
              music.163.com
            </button>{' '}
            并登录
          </li>
          <li>按 F12 打开开发者工具，切到「应用 / Application」→「Cookie」</li>
          <li>选中 https://music.163.com，找到 MUSIC_U 这一项</li>
          <li>
            复制整行或只复制 <code>MUSIC_U=xxxxx</code> 部分，粘贴到下方
          </li>
        </ol>
      )}

      <label className="nt-cookie__label" htmlFor="nt-cookie-input">
        Cookie 内容
      </label>
      <textarea
        id="nt-cookie-input"
        className="nt-cookie__input"
        placeholder="粘贴 Cookie，例如：MUSIC_U=xxxxx; __csrf=xxxxx"
        value={cookie}
        onChange={e => setCookie(e.target.value)}
        spellCheck={false}
        rows={5}
      />

      <div className="nt-cookie__actions">
        <button
          type="button"
          className={cx('nt-btn nt-btn--primary', submitting && 'is-loading')}
          onClick={() => void submit()}
          disabled={submitting || !cookie.trim()}
        >
          {submitting ? '登录中…' : '登录'}
        </button>
        <button type="button" className="nt-btn nt-btn--ghost" onClick={() => setCookie('')} disabled={!cookie}>
          清空
        </button>
      </div>

      <p className="nt-cookie__privacy">Cookie 仅保存在本机，用于维持登录态，不会上传到任何第三方服务器。</p>
    </div>
  )
}
