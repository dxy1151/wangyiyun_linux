/**
 * 网易云账号登录（主进程实现）
 *
 * 支持两种方式：
 *   1. 二维码登录（扫码）：unikey → 渲染层生成二维码 → 轮询扫码状态 → 803 成功后
 *      从同一 session 的 cookie 拿 MUSIC_U，再查账号信息。
 *   2. Cookie 导入登录：用户从浏览器复制 cookie 粘贴进来，校验后写入 session。
 *
 * 为什么放在主进程：
 *  - 登录态本质是 cookie，放在 Electron 的 session 里才能被后续所有请求自动携带、
 *    并在 app 重启后由 Chromium 自动持久化到 userData。
 *  - 渲染层的 fetch 属于同一个 session，因此登录后 api 层无需任何改动即可带登录态。
 *
 * 依赖：仅 Node/Electron 内置能力 + qrcode（渲染层用），无原生模块。
 */
import { createHash } from 'node:crypto'
import { session } from 'electron'
import type { AuthSession, AuthUser, QrPollResult, UserPlaylist } from '../shared/types'
import { createLogger, errorText } from './logger'

const log = createLogger('auth')

const OEM = 'https://music.163.com'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 构造网易云请求所需的公共头 */
function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: `${OEM}/`,
    Origin: OEM,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra
  }
}

function ses(): Electron.Session {
  return session.defaultSession
}

/**
 * 带 cookie 的 GET（自动读写 defaultSession 的 cookie jar）。
 * 用 net.request + session 保证 cookie 在同一 jar 内持久化。
 */
async function requestJson(
  url: string,
  opts: { method?: 'GET' | 'POST'; body?: string } = {}
): Promise<unknown> {
  const { net } = await import('electron')
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: opts.method ?? 'GET', session: ses() })
    const headers = baseHeaders(
      opts.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}
    )
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        try {
          req.abort()
        } catch {
          /* ignore */
        }
        reject(new Error('请求超时'))
      })
    }, 12_000)

    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        finish(() => {
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error(`响应非 JSON：${text.slice(0, 120)}`))
          }
        })
      })
      res.on('error', (err) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))))
    })
    req.on('error', (err) => finish(() => reject(err instanceof Error ? err : new Error(String(err)))))
    req.end(opts.body)
  })
}

/* --------------------------------- 用户信息 --------------------------------- */

interface RawProfile {
  userId?: number
  nickname?: string
  avatarUrl?: string
  vipType?: number
  signature?: string
  backgroundUrl?: string
}

function toUser(p: RawProfile | null | undefined): AuthUser | null {
  if (!p || !p.userId) return null
  return {
    id: Number(p.userId),
    nickname: String(p.nickname ?? ''),
    avatarUrl: String(p.avatarUrl ?? ''),
    vipType: Number(p.vipType ?? 0),
    signature: String(p.signature ?? '')
  }
}

/** 读取当前登录态（会话 cookie 里有没有 MUSIC_U） */
export async function getSession(): Promise<AuthSession> {
  try {
    const cookies = await ses().cookies.get({ domain: '.music.163.com' })
    const hasMusicU = cookies.some((c) => c.name === 'MUSIC_U' && !!c.value)
    if (!hasMusicU) return { loggedIn: false }

    const data = (await requestJson(`${OEM}/api/nuser/account/get`)) as {
      account?: RawProfile | null
      profile?: RawProfile | null
    }
    const user = toUser(data?.profile) ?? toUser(data?.account)
    if (!user) {
      // cookie 失效：清掉避免反复失败
      await logout()
      return { loggedIn: false }
    }
    return { loggedIn: true, user }
  } catch (err) {
    log.warn('getSession failed:', errorText(err))
    return { loggedIn: false, error: errorText(err) }
  }
}

/* --------------------------------- 二维码登录 --------------------------------- */

/**
 * 申请扫码登录的 unikey。
 * 渲染层用返回的 qrContent 自行生成二维码（内容必须是官方扫码链接）。
 */
export async function qrCreate(): Promise<{ unikey: string; qrContent: string; qrDataUrl: string }> {
  const data = (await requestJson(`${OEM}/api/login/qrcode/unikey?type=1`)) as {
    code?: number
    unikey?: string
  }
  if (data?.code !== 200 || !data.unikey) {
    throw new Error(`获取二维码失败（code=${data?.code ?? '?'}）`)
  }
  const unikey = data.unikey
  const qrContent = `${OEM}/login?codekey=${unikey}`
  // 在主进程生成二维码 PNG dataURL（qrcode 为纯 JS，无原生依赖）
  let qrDataUrl = ''
  try {
    const QR = await import('qrcode')
    qrDataUrl = await QR.toDataURL(qrContent, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch (err) {
    log.warn('二维码生成失败（渲染层可自行生成）:', errorText(err))
  }
  return { unikey, qrContent, qrDataUrl }
}

/**
 * 轮询扫码状态。
 * 800 二维码过期 / 801 等待扫码 / 802 待确认 / 803 授权成功
 */
export async function qrPoll(unikey: string): Promise<QrPollResult> {
  if (!unikey || typeof unikey !== 'string') {
    return { status: 800, message: '无效的二维码' }
  }
  try {
    const data = (await requestJson(
      `${OEM}/api/login/qrcode/client/login?type=1&key=${encodeURIComponent(unikey)}`
    )) as { code?: number; message?: string; nickname?: string }
    const status = Number(data?.code ?? 801)
    if (status === 803) {
      // 授权成功：cookie 已写入 session，拉一次用户信息
      const info = await getSession()
      return {
        status: 803,
        message: '登录成功',
        user: info.user
      }
    }
    const messages: Record<number, string> = {
      800: '二维码已过期，请刷新',
      801: '等待扫码',
      802: '已扫描，请在手机上确认登录'
    }
    return { status: (status as 800 | 801 | 802), message: messages[status] ?? data?.message ?? '' }
  } catch (err) {
    log.warn('qrPoll failed:', errorText(err))
    return { status: 801, message: `轮询失败：${errorText(err)}` }
  }
}

/* -------------------------------- Cookie 登录 -------------------------------- */

/** 解析用户粘贴的 cookie 字符串（支持 `a=1; b=2` 或带前缀的整段） */
function parseCookieString(raw: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const part of raw.replace(/\s*;\s*/g, ';').split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq <= 0) continue
    const name = seg.slice(0, eq).trim()
    const value = seg.slice(eq + 1).trim()
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue
    out.push({ name, value })
  }
  return out
}

/**
 * 用 cookie 字符串登录（兜底方案，最可靠）。
 * 成功后把 cookie 写入 session，并返回用户信息。
 */
export async function loginWithCookie(raw: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const list = parseCookieString(raw)
  const hasMusicU = list.some((c) => c.name === 'MUSIC_U' && c.value)
  if (!hasMusicU) {
    return { ok: false, error: '缺少 MUSIC_U 字段，请确认复制了完整的 cookie' }
  }

  try {
    // 先清空旧登录 cookie，避免脏数据
    await logout()

    for (const c of list) {
      await ses().cookies.set({
        url: OEM,
        name: c.name,
        value: c.value,
        domain: '.music.163.com',
        path: '/',
        secure: true,
        sameSite: 'no_restriction'
      })
    }
    const info = await getSession()
    if (info.loggedIn && info.user) {
      log.info(`cookie 登录成功：${info.user.nickname}`)
      return { ok: true, user: info.user }
    }
    await logout()
    return { ok: false, error: 'cookie 无效或已过期，请重新从浏览器复制' }
  } catch (err) {
    log.warn('loginWithCookie failed:', errorText(err))
    return { ok: false, error: errorText(err) }
  }
}

/* ---------------------------------- 退出登录 --------------------------------- */

/** 清空登录 cookie（保留设备标识类 cookie 以减少风控） */
export async function logout(): Promise<void> {
  try {
    const s = ses()
    const all = await s.cookies.get({ domain: '.music.163.com' })
    s.cookies.flushStore
    await Promise.all(
      all.map((c) =>
        s.cookies
          .remove(OEM, c.name)
          .catch(() => {
            /* 某些 cookie 需要带路径删除，忽略失败 */
          })
      )
    )
    // 兜底：再删一次根路径
    for (const name of ['MUSIC_U', '__csrf', 'MUSIC_A_T', 'MUSIC_R_T']) {
      await s.cookies.remove(`${OEM}/`, name).catch(() => {})
    }
    await s.cookies.flushStore()
    log.info('已退出登录')
  } catch (err) {
    log.warn('logout failed:', errorText(err))
  }
}

/* --------------------------------- 我的歌单 --------------------------------- */

interface RawPlaylist {
  id?: number
  name?: string
  coverImgUrl?: string
  trackCount?: number
  playCount?: number
  subscribed?: boolean
  creator?: { userId?: number; nickname?: string }
}

function toPlaylist(p: RawPlaylist): UserPlaylist | null {
  if (!p?.id) return null
  return {
    id: Number(p.id),
    name: String(p.name ?? ''),
    coverImgUrl: String(p.coverImgUrl ?? ''),
    trackCount: Number(p.trackCount ?? 0),
    playCount: Number(p.playCount ?? 0),
    subscribed: !!p.subscribed,
    creator: {
      id: Number(p.creator?.userId ?? 0),
      nickname: String(p.creator?.nickname ?? '')
    }
  }
}

/** 拉取"我创建的歌单"与"我收藏的歌单" */
export async function myPlaylists(): Promise<{ created: UserPlaylist[]; subscribed: UserPlaylist[] }> {
  const info = await getSession()
  if (!info.loggedIn || !info.user) return { created: [], subscribed: [] }
  try {
    const data = (await requestJson(
      `${OEM}/api/user/playlist?uid=${info.user.id}&limit=1000&offset=0`
    )) as { playlist?: RawPlaylist[] }
    const list = (data?.playlist ?? []).map(toPlaylist).filter((p): p is UserPlaylist => !!p)
    const created: UserPlaylist[] = []
    const subscribed: UserPlaylist[] = []
    for (const pl of list) {
      if (pl.creator.id === info.user.id) created.push(pl)
      else subscribed.push(pl)
    }
    return { created, subscribed }
  } catch (err) {
    log.warn('myPlaylists failed:', errorText(err))
    return { created: [], subscribed: [] }
  }
}

/* ------------------------------ 每日推荐（登录后可用） ------------------------------ */

/**
 * 每日推荐歌曲。需要登录态，且官方接口对未登录用户返回 301。
 * 失败返回空数组，UI 自动降级。
 */
export async function dailyRecommend(): Promise<unknown | null> {
  try {
    return await requestJson(`${OEM}/api/v1/discovery/recommend/songs`)
  } catch (err) {
    log.debug('dailyRecommend failed:', errorText(err))
    return null
  }
}

/** 调试用：cookie 指纹（不泄露内容，仅帮助排查登录态） */
export async function cookieFingerprint(): Promise<string> {
  try {
    const cookies = await ses().cookies.get({ domain: '.music.163.com' })
    const names = cookies
      .map((c) => c.name)
      .filter((n) => /MUSIC_U|MUSIC_A|csrf/i.test(n))
      .sort()
    if (!names.length) return 'none'
    const joined = cookies
      .filter((c) => names.includes(c.name))
      .map((c) => `${c.name}:${c.value.length}`)
      .join(',')
    return createHash('md5').update(joined).digest('hex').slice(0, 8)
  } catch {
    return 'error'
  }
}
