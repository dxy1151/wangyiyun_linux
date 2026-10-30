/**
 * MPRIS 服务（org.mpris.MediaPlayer2 / org.mpris.MediaPlayer2.Player）
 *
 * 纯 JS：直接用 node:net 连接会话总线（见 dbus-client.ts），不依赖任何原生模块。
 * 实现的方法：
 *   根接口：Raise / Quit
 *   Player：Play / Pause / PlayPause / Stop / Next / Previous / Seek / SetPosition
 *   属性：org.freedesktop.DBus.Properties 的 Get / GetAll / Set
 *   信号：PropertiesChanged / Seeked
 *
 * 启动失败（无 dbus / 名被占用 / 编解码异常）一律降级为"无 MPRIS"，绝不影响主进程启动。
 */
import { EventEmitter } from 'node:events'
import type { MprisAction, MprisState, PlayMode } from '../../shared/types'
import { createLogger, errorText } from '../logger'
import { DbusConnection } from './dbus-client'
import { MSG_TYPE, variant } from './dbus-codec'
import type { DbusMessage, VariantValue } from './dbus-codec'

const log = createLogger('mpris')

export const MPRIS_BUS_NAME = 'org.mpris.MediaPlayer2.netease-cloud-music'
export const MPRIS_OBJECT_PATH = '/org/mpris/MediaPlayer2'
export const IFACE_ROOT = 'org.mpris.MediaPlayer2'
export const IFACE_PLAYER = 'org.mpris.MediaPlayer2.Player'
export const IFACE_PROPS = 'org.freedesktop.DBus.Properties'
export const IFACE_INTROSPECT = 'org.freedesktop.DBus.Introspectable'
export const IFACE_PEER = 'org.freedesktop.DBus.Peer'

const IDENTITY = '网易云音乐'
const DESKTOP_ENTRY = 'netease-cloud-music'

type LoopStatus = 'None' | 'Track' | 'Playlist'

interface PropDef {
  signature: string
  access: 'read' | 'readwrite'
}

/** 两个接口的属性表（同时用于 Introspect 与 GetAll） */
const ROOT_PROPS: Record<string, PropDef> = {
  CanQuit: { signature: 'b', access: 'read' },
  CanRaise: { signature: 'b', access: 'read' },
  HasTrackList: { signature: 'b', access: 'read' },
  Identity: { signature: 's', access: 'read' },
  DesktopEntry: { signature: 's', access: 'read' },
  SupportedUriSchemes: { signature: 'as', access: 'read' },
  SupportedMimeTypes: { signature: 'as', access: 'read' }
}

const PLAYER_PROPS: Record<string, PropDef> = {
  PlaybackStatus: { signature: 's', access: 'read' },
  LoopStatus: { signature: 's', access: 'readwrite' },
  Rate: { signature: 'd', access: 'readwrite' },
  Shuffle: { signature: 'b', access: 'readwrite' },
  Metadata: { signature: 'a{sv}', access: 'read' },
  Volume: { signature: 'd', access: 'readwrite' },
  Position: { signature: 'x', access: 'read' },
  MinimumRate: { signature: 'd', access: 'read' },
  MaximumRate: { signature: 'd', access: 'read' },
  CanGoNext: { signature: 'b', access: 'read' },
  CanGoPrevious: { signature: 'b', access: 'read' },
  CanPlay: { signature: 'b', access: 'read' },
  CanPause: { signature: 'b', access: 'read' },
  CanSeek: { signature: 'b', access: 'read' },
  CanControl: { signature: 'b', access: 'read' }
}

const ROOT_METHODS: Record<string, { in: string }> = {
  Raise: { in: '' },
  Quit: { in: '' }
}

const PLAYER_METHODS: Record<string, { in: string }> = {
  Next: { in: '' },
  Previous: { in: '' },
  Pause: { in: '' },
  PlayPause: { in: '' },
  Stop: { in: '' },
  Play: { in: '' },
  Seek: { in: 'x' },
  SetPosition: { in: 'ox' },
  OpenUri: { in: 's' }
}

/** 当前 MPRIS 可见状态 */
interface Status {
  playbackStatus: 'Playing' | 'Paused' | 'Stopped'
  title: string
  artist: string
  album: string
  artUrl: string
  /** 微秒 */
  position: number
  /** 微秒 */
  duration: number
  volume: number
  canGoNext: boolean
  canGoPrevious: boolean
  canPlay: boolean
  canPause: boolean
  canSeek: boolean
  loopStatus: LoopStatus
  shuffle: boolean
  trackId: string
}

function defaults(): Status {
  return {
    playbackStatus: 'Stopped',
    title: '',
    artist: '',
    album: '',
    artUrl: '',
    position: 0,
    duration: 0,
    volume: 1,
    canGoNext: true,
    canGoPrevious: true,
    canPlay: true,
    canPause: true,
    canSeek: true,
    loopStatus: 'None',
    shuffle: false,
    trackId: '/org/mpris/MediaPlayer2/TrackList/NoTrack'
  }
}

/** 规范化轨道 id 为合法 object path */
function trackPath(raw: string | undefined): string {
  const s = (raw ?? '').replace(/[^A-Za-z0-9_]/g, '')
  return s ? `/org/mpris/MediaPlayer2/netease/track/${s}` : '/org/mpris/MediaPlayer2/TrackList/NoTrack'
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

function buildIntrospection(): string {
  const prop = (name: string, d: PropDef): string => {
    const acc = d.access === 'readwrite' ? 'readwrite' : 'read'
    return `    <property name="${name}" type="${escapeXml(d.signature)}" access="${acc}"/>`
  }
  const method = (name: string, inSig: string): string =>
    inSig
      ? `    <method name="${name}"><arg direction="in" type="${escapeXml(inSig)}"/></method>`
      : `    <method name="${name}"/>`

  const lines: string[] = []
  lines.push(`<node>`)
  lines.push(`  <interface name="${IFACE_ROOT}">`)
  for (const [n, m] of Object.entries(ROOT_METHODS)) lines.push(method(n, m.in))
  for (const [n, d] of Object.entries(ROOT_PROPS)) lines.push(prop(n, d))
  lines.push(`  </interface>`)
  lines.push(`  <interface name="${IFACE_PLAYER}">`)
  for (const [n, m] of Object.entries(PLAYER_METHODS)) lines.push(method(n, m.in))
  lines.push(`    <signal name="Seeked"><arg type="x"/></signal>`)
  for (const [n, d] of Object.entries(PLAYER_PROPS)) lines.push(prop(n, d))
  lines.push(`  </interface>`)
  lines.push(`  <interface name="${IFACE_PROPS}">`)
  lines.push(
    `    <method name="Get"><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="out" type="v"/></method>`
  )
  lines.push(
    `    <method name="GetAll"><arg direction="in" type="s"/><arg direction="out" type="a{sv}"/></method>`
  )
  lines.push(
    `    <method name="Set"><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="in" type="v"/></method>`
  )
  lines.push(`    <signal name="PropertiesChanged">`)
  lines.push(`      <arg type="s"/>`)
  lines.push(`      <arg type="a{sv}"/>`)
  lines.push(`      <arg type="as"/>`)
  lines.push(`    </signal>`)
  lines.push(`  </interface>`)
  lines.push(`  <interface name="${IFACE_INTROSPECT}">`)
  lines.push(`    <method name="Introspect"><arg direction="out" type="s"/></method>`)
  lines.push(`  </interface>`)
  lines.push(`  <interface name="${IFACE_PEER}">`)
  lines.push(`    <method name="Ping"/>`)
  lines.push(`    <method name="GetMachineId"><arg direction="out" type="s"/></method>`)
  lines.push(`  </interface>`)
  lines.push(`</node>`)
  return lines.join('\n')
}

/** 解析失败的消息在 client 层以 type = MALFORMED_TYPE 上报（而不污染 DbusMessage） */
export const MALFORMED_TYPE = 0

export interface MprisServiceOptions {
  /** 渲染层指令回调（由 index.ts 转发到 webContents.send('mpris:cmd')） */
  onCommand?: (action: MprisAction, value?: number) => void
  /** Raise：显示主窗口 */
  onRaise?: () => void
  /** Quit：退出应用 */
  onQuit?: () => void
}

/**
 * MPRIS 服务。`start()` 永远不 throw：失败时 isRunning() 为 false，其余代码无感知。
 */
export class MprisService extends EventEmitter {
  private conn: DbusConnection | null = null
  private status: Status = defaults()
  private opts: MprisServiceOptions
  private started = false
  private introspectXml = buildIntrospection()
  /** 进度推进的基准：更新时间戳 + 位置，用于回答 Position 查询 */
  private positionBaseAt = Date.now()

  constructor(opts: MprisServiceOptions = {}) {
    super()
    this.opts = opts
  }

  isRunning(): boolean {
    return this.started && !!this.conn?.connected
  }

  getBusName(): string {
    return MPRIS_BUS_NAME
  }

  /** 启动并注册总线名；永不抛出 */
  async start(): Promise<boolean> {
    if (this.started) return this.isRunning()
    try {
      const conn = await DbusConnection.connect()
      this.conn = conn
      const reply = await conn.requestName(MPRIS_BUS_NAME, 0x4 /* DO_NOT_QUEUE */)
      // 1=PRIMARY_OWNER 4=ALREADY_OWNER；2=IN_QUEUE 3=EXISTS
      if (reply !== 1 && reply !== 4) {
        log.warn(`RequestName(${MPRIS_BUS_NAME}) returned ${reply} — another player owns it, MPRIS disabled`)
        conn.destroy()
        this.conn = null
        return false
      }
      conn.onMessage((msg) => this.onMessage(msg))
      conn.onDisconnect = (err) => {
        log.warn('bus disconnected, MPRIS stopped:', errorText(err))
        this.started = false
      }
      this.started = true
      log.info(`registered ${MPRIS_BUS_NAME} (unique=${conn.uniqueName})`)
      return true
    } catch (err) {
      log.warn('MPRIS unavailable (app keeps running without it):', errorText(err))
      try {
        this.conn?.destroy()
      } catch {
        // ignore
      }
      this.conn = null
      this.started = false
      return false
    }
  }

  async stop(): Promise<void> {
    if (!this.conn) return
    try {
      if (this.started) await this.conn.releaseName(MPRIS_BUS_NAME)
    } catch {
      // 退出路径上忽略
    }
    this.conn.destroy()
    this.conn = null
    this.started = false
    log.info('MPRIS service stopped')
  }

  /* ---------------------------------------------------------------- */
  /* 状态同步                                                          */
  /* ---------------------------------------------------------------- */

  /** 渲染层推送的播放状态（mpris:update） */
  update(partial: MprisState | null | undefined): void {
    if (!partial || typeof partial !== 'object') return
    const prev = this.status
    const next: Status = { ...prev }
    const changed: Array<[string, VariantValue]> = []

    const set = <K extends keyof Status>(key: K, value: Status[K]): void => {
      if (prev[key] === value) return
      next[key] = value
      changed.push([String(key), this.encodeProp(String(key), value)])
    }

    if (partial.playbackStatus === 'Playing' || partial.playbackStatus === 'Paused' || partial.playbackStatus === 'Stopped') {
      set('playbackStatus', partial.playbackStatus)
    }
    if (typeof partial.title === 'string') set('title', partial.title)
    if (typeof partial.artist === 'string') set('artist', partial.artist)
    if (typeof partial.album === 'string') set('album', partial.album)
    if (typeof partial.volume === 'number' && Number.isFinite(partial.volume)) {
      set('volume', Math.min(1, Math.max(0, partial.volume)))
    }
    if (typeof partial.duration === 'number' && Number.isFinite(partial.duration)) {
      set('duration', Math.max(0, Math.round(partial.duration * 1e6)))
    }
    if (typeof partial.canGoNext === 'boolean') set('canGoNext', partial.canGoNext)
    if (typeof partial.canGoPrevious === 'boolean') set('canGoPrevious', partial.canGoPrevious)
    if (typeof partial.canPlay === 'boolean') set('canPlay', partial.canPlay)
    if (typeof partial.canPause === 'boolean') set('canPause', partial.canPause)
    if (typeof partial.position === 'number' && Number.isFinite(partial.position)) {
      this.status.position = Math.max(0, Math.round(partial.position * 1e6))
      this.positionBaseAt = Date.now()
      // Position 变化不通过 PropertiesChanged 通知（规范要求用 Seeked 信号）
    }

    // 曲目变化：metadata 整体重算 + trackId 更新
    const trackChanged = next.title !== prev.title || next.artist !== prev.artist || next.album !== prev.album
    if (trackChanged) {
      next.trackId = trackPath(`${next.title}-${next.artist}`)
      changed.push(['Metadata', this.encodeProp('Metadata', this.metadataOf(next))])
    }

    this.status = next
    if (changed.length) this.emitPropertiesChanged(IFACE_PLAYER, changed)
  }

  /** 应用播放模式 → MPRIS Shuffle/LoopStatus（设置变更时由 index.ts 调用） */
  setPlayMode(mode: PlayMode): void {
    const loopStatus: LoopStatus = mode === 'repeat-one' ? 'Track' : mode === 'loop' ? 'Playlist' : 'None'
    const shuffle = mode === 'shuffle'
    const changed: Array<[string, VariantValue]> = []
    if (this.status.loopStatus !== loopStatus) {
      this.status.loopStatus = loopStatus
      changed.push(['LoopStatus', variant('s', loopStatus)])
    }
    if (this.status.shuffle !== shuffle) {
      this.status.shuffle = shuffle
      changed.push(['Shuffle', variant('b', shuffle)])
    }
    if (changed.length) this.emitPropertiesChanged(IFACE_PLAYER, changed)
  }

  /** 本地 seek 发生时通知客户端（渲染层拖动进度条后调用） */
  notifySeeked(positionMicros: number): void {
    this.status.position = Math.max(0, Math.round(positionMicros))
    this.positionBaseAt = Date.now()
    try {
      this.conn?.emitSignal({
        path: MPRIS_OBJECT_PATH,
        interface: IFACE_PLAYER,
        member: 'Seeked',
        signature: 'x',
        body: [this.status.position]
      })
    } catch (err) {
      log.warn('Seeked signal failed:', errorText(err))
    }
  }

  /** 当前（带播放推进的）位置，微秒 */
  private currentPosition(): number {
    const s = this.status
    let pos = s.position
    if (s.playbackStatus === 'Playing') pos += Date.now() - this.positionBaseAt
    if (s.duration > 0) pos = Math.min(pos, s.duration)
    return Math.max(0, Math.round(pos))
  }

  private metadataOf(s: Status): Array<[string, VariantValue]> {
    const entries: Array<[string, VariantValue]> = [
      ['mpris:trackid', variant('o', s.trackId)]
    ]
    if (s.title) entries.push(['xesam:title', variant('s', s.title)])
    if (s.artist) entries.push(['xesam:artist', variant('as', [s.artist])])
    if (s.album) entries.push(['xesam:album', variant('s', s.album)])
    if (s.duration > 0) entries.push(['mpris:length', variant('x', s.duration)])
    if (s.artUrl) entries.push(['mpris:artUrl', variant('s', s.artUrl)])
    entries.push(['xesam:autoRating', variant('d', 0)])
    return entries
  }

  private encodeProp(name: string, value: unknown): VariantValue {
    switch (name) {
      case 'Metadata':
        return variant('a{sv}', value as Array<[string, VariantValue]>)
      case 'Position':
        return variant('x', this.currentPosition())
      case 'Volume':
      case 'Rate':
      case 'MinimumRate':
      case 'MaximumRate':
        return variant('d', Number(value))
      case 'Shuffle':
      case 'CanGoNext':
      case 'CanGoPrevious':
      case 'CanPlay':
      case 'CanPause':
      case 'CanSeek':
      case 'CanControl':
      case 'CanQuit':
      case 'CanRaise':
      case 'HasTrackList':
        return variant('b', Boolean(value))
      case 'SupportedUriSchemes':
      case 'SupportedMimeTypes':
        return variant('as', (value as string[]) ?? [])
      default:
        return variant('s', String(value ?? ''))
    }
  }

  /** 读取属性（供 Get / GetAll 用） */
  private getProp(iface: string, name: string): VariantValue | null {
    const s = this.status
    if (iface === IFACE_ROOT) {
      switch (name) {
        case 'CanQuit':
          return variant('b', true)
        case 'CanRaise':
          return variant('b', true)
        case 'HasTrackList':
          return variant('b', false)
        case 'Identity':
          return variant('s', IDENTITY)
        case 'DesktopEntry':
          return variant('s', DESKTOP_ENTRY)
        case 'SupportedUriSchemes':
          return variant('as', [])
        case 'SupportedMimeTypes':
          return variant('as', ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4'])
        default:
          return null
      }
    }
    if (iface === IFACE_PLAYER) {
      switch (name) {
        case 'PlaybackStatus':
          return variant('s', s.playbackStatus)
        case 'LoopStatus':
          return variant('s', s.loopStatus)
        case 'Rate':
          return variant('d', 1)
        case 'Shuffle':
          return variant('b', s.shuffle)
        case 'Metadata':
          return variant('a{sv}', this.metadataOf(s))
        case 'Volume':
          return variant('d', s.volume)
        case 'Position':
          return variant('x', this.currentPosition())
        case 'MinimumRate':
          return variant('d', 1)
        case 'MaximumRate':
          return variant('d', 1)
        case 'CanGoNext':
          return variant('b', s.canGoNext)
        case 'CanGoPrevious':
          return variant('b', s.canGoPrevious)
        case 'CanPlay':
          return variant('b', s.canPlay)
        case 'CanPause':
          return variant('b', s.canPause)
        case 'CanSeek':
          return variant('b', s.canSeek)
        case 'CanControl':
          return variant('b', true)
        default:
          return null
      }
    }
    return null
  }

  private allProps(iface: string): Array<[string, VariantValue]> {
    const table = iface === IFACE_ROOT ? ROOT_PROPS : iface === IFACE_PLAYER ? PLAYER_PROPS : null
    if (!table) return []
    const out: Array<[string, VariantValue]> = []
    for (const name of Object.keys(table)) {
      const v = this.getProp(iface, name)
      if (v) out.push([name, v])
    }
    return out
  }

  private emitPropertiesChanged(iface: string, changed: Array<[string, VariantValue]>): void {
    if (!this.conn || !changed.length) return
    try {
      this.conn.emitSignal({
        path: MPRIS_OBJECT_PATH,
        interface: IFACE_PROPS,
        member: 'PropertiesChanged',
        signature: 'sa{sv}as',
        body: [iface, changed, []]
      })
    } catch (err) {
      log.warn('PropertiesChanged failed:', errorText(err))
    }
  }

  /* ---------------------------------------------------------------- */
  /* 消息分发                                                          */
  /* ---------------------------------------------------------------- */

  private onMessage(msg: DbusMessage): void {
    // MALFORMED_TYPE(0) 不是合法 D-Bus 类型，必须先于 METHOD_CALL 判断
    if (msg.type === MALFORMED_TYPE) {
      log.warn('malformed incoming message (dropped):', errorText(msg.body[0]))
      return
    }
    if (msg.type !== MSG_TYPE.METHOD_CALL) return
    try {
      this.handleCall(msg)
    } catch (err) {
      log.error(`handle ${msg.interface}.${msg.member} failed:`, errorText(err))
      this.conn?.sendError(msg, 'org.freedesktop.DBus.Error.Failed', errorText(err))
    }
  }

  private handleCall(msg: DbusMessage): void {
    const conn = this.conn
    if (!conn) return
    if (msg.path !== MPRIS_OBJECT_PATH) {
      conn.sendError(msg, 'org.freedesktop.DBus.Error.UnknownObject', `no such object: ${msg.path}`)
      return
    }
    const iface = msg.interface ?? ''
    const member = msg.member ?? ''

    // 标准接口
    if (iface === IFACE_INTROSPECT && member === 'Introspect') {
      conn.sendReply(msg, 's', [this.introspectXml])
      return
    }
    if (iface === IFACE_PEER) {
      if (member === 'Ping') conn.sendReply(msg, '', [])
      else if (member === 'GetMachineId') conn.sendReply(msg, 's', ['00000000000000000000000000000000'])
      else conn.sendError(msg, 'org.freedesktop.DBus.Error.UnknownMethod', `unknown method ${member}`)
      return
    }
    if (iface === IFACE_PROPS) {
      this.handleProperties(conn, msg, member)
      return
    }
    if (iface === IFACE_ROOT && member in ROOT_METHODS) {
      this.handleRootMethod(msg, member)
      return
    }
    if (iface === IFACE_PLAYER && member in PLAYER_METHODS) {
      this.handlePlayerMethod(msg, member)
      return
    }
    conn.sendError(
      msg,
      'org.freedesktop.DBus.Error.UnknownMethod',
      `unknown method ${iface}.${member}`
    )
  }

  private handleProperties(conn: DbusConnection, msg: DbusMessage, member: string): void {
    if (member === 'Get') {
      const [iface, name] = msg.body as [string, string]
      const v = this.getProp(String(iface), String(name))
      if (!v) {
        conn.sendError(
          msg,
          'org.freedesktop.DBus.Error.InvalidArgs',
          `no such property '${String(name)}' on ${String(iface)}`
        )
        return
      }
      conn.sendReply(msg, 'v', [v])
      return
    }
    if (member === 'GetAll') {
      const [iface] = msg.body as [string]
      conn.sendReply(msg, 'a{sv}', [this.allProps(String(iface))])
      return
    }
    if (member === 'Set') {
      const [iface, name, v] = msg.body as [string, string, VariantValue]
      this.handleSet(msg, String(iface), String(name), v)
      return
    }
    conn.sendError(msg, 'org.freedesktop.DBus.Error.UnknownMethod', `unknown Properties method ${member}`)
  }

  private handleSet(msg: DbusMessage, iface: string, name: string, v: VariantValue): void {
    const conn = this.conn
    if (!conn) return
    if (iface !== IFACE_PLAYER) {
      conn.sendError(msg, 'org.freedesktop.DBus.Error.PropertyReadOnly', `${iface}.${name} is read-only`)
      return
    }
    const def = PLAYER_PROPS[name]
    if (!def) {
      conn.sendError(msg, 'org.freedesktop.DBus.Error.InvalidArgs', `no such property ${name}`)
      return
    }
    if (def.access !== 'readwrite') {
      conn.sendError(msg, 'org.freedesktop.DBus.Error.PropertyReadOnly', `${name} is read-only`)
      return
    }
    const changed: Array<[string, VariantValue]> = []
    switch (name) {
      case 'Volume': {
        const vol = Math.min(1, Math.max(0, Number(v.value) || 0))
        this.status.volume = vol
        changed.push(['Volume', variant('d', vol)])
        this.opts.onCommand?.('volume', vol)
        break
      }
      case 'LoopStatus': {
        const raw = String(v.value)
        const loop: LoopStatus = raw === 'Track' ? 'Track' : raw === 'Playlist' ? 'Playlist' : 'None'
        this.status.loopStatus = loop
        changed.push(['LoopStatus', variant('s', loop)])
        // 映射到应用播放模式
        this.emit('loop-status', loop === 'Track' ? 'repeat-one' : loop === 'Playlist' ? 'loop' : 'order')
        break
      }
      case 'Shuffle': {
        const on = Boolean(v.value)
        this.status.shuffle = on
        changed.push(['Shuffle', variant('b', on)])
        this.emit('shuffle', on)
        break
      }
      default:
        conn.sendError(msg, 'org.freedesktop.DBus.Error.PropertyReadOnly', `${name} is read-only`)
        return
    }
    conn.sendReply(msg, '', [])
    this.emitPropertiesChanged(IFACE_PLAYER, changed)
  }

  private handleRootMethod(msg: DbusMessage, member: string): void {
    const conn = this.conn
    if (!conn) return
    conn.sendReply(msg, '', [])
    switch (member) {
      case 'Raise':
        try {
          this.opts.onRaise?.()
        } catch (err) {
          log.warn('Raise handler failed:', errorText(err))
        }
        break
      case 'Quit':
        log.info('MPRIS Quit requested')
        try {
          this.opts.onQuit?.()
        } catch (err) {
          log.warn('Quit handler failed:', errorText(err))
        }
        break
      default:
        break
    }
  }

  private handlePlayerMethod(msg: DbusMessage, member: string): void {
    const conn = this.conn
    if (!conn) return
    const s = this.status
    // 规范要求：Can* 为 false 时对应方法直接返回（成功但不做事）
    const send = (action: MprisAction, value?: number): void => {
      try {
        this.opts.onCommand?.(action, value)
      } catch (err) {
        log.warn(`command ${action} failed:`, errorText(err))
      }
    }

    switch (member) {
      case 'Play':
        if (!s.canPlay) break
        send('play-pause')
        break
      case 'Pause':
        if (!s.canPause) break
        send('play-pause')
        break
      case 'PlayPause':
        // Play/Pause 的语义差异由渲染层根据 playbackStatus 处理；这里用同一个动作
        send('play-pause')
        break
      case 'Stop':
        // MprisAction 只有 play-pause/next/prev/seek-to/volume（无 'stop'）：
        // 正在播放时转发一次 play-pause（暂停），随后把状态置为 Stopped 让客户端立即看到反馈。
        if (s.playbackStatus === 'Playing') send('play-pause')
        this.status.playbackStatus = 'Stopped'
        this.status.position = 0
        this.positionBaseAt = Date.now()
        this.emitPropertiesChanged(IFACE_PLAYER, [['PlaybackStatus', variant('s', 'Stopped')]])
        break
      case 'Next':
        if (!s.canGoNext) break
        send('next')
        break
      case 'Previous':
        if (!s.canGoPrevious) break
        send('prev')
        break
      case 'Seek': {
        if (!s.canSeek) break
        const offset = Number(msg.body[0]) || 0
        const target = Math.max(0, this.currentPosition() + offset)
        send('seek-to', target / 1e6)
        break
      }
      case 'SetPosition': {
        if (!s.canSeek) break
        const [, pos] = msg.body as [string, number]
        const target = Math.max(0, Number(pos) || 0)
        send('seek-to', target / 1e6)
        break
      }
      case 'OpenUri':
        log.info('OpenUri ignored:', msg.body[0])
        break
      default:
        break
    }
    conn.sendReply(msg, '', [])
  }
}
