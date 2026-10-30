/**
 * 极简 D-Bus 客户端（SOCK_STREAM over unix socket），足够承载 MPRIS 服务端。
 *
 * - 连接：解析 DBUS_SESSION_BUS_ADDRESS（支持 unix:path= / unix:abstract=，多个地址用 ; 分隔）
 * - 握手：Hello → 拿到 unique name（:1.x）
 * - API：call() 发方法调用并等回复；丢消息时静默（NO_REPLY_EXPECTED）
 * - 大端（'B'）消息在解析时按需转换：本文件只处理本机小端总线，收到大端直接丢弃
 */
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import { homedir } from 'node:os'
import { FLAG, MSG_TYPE, frameLength, marshal, parseMessage } from './dbus-codec'
import type { DbusMessage } from './dbus-codec'

export interface BusAddress {
  path?: string
  abstract?: string
}

/** 解析 DBUS_SESSION_BUS_ADDRESS，返回可用的 unix socket 地址列表 */
export function parseBusAddress(env: string | undefined = process.env['DBUS_SESSION_BUS_ADDRESS']): BusAddress[] {
  const out: BusAddress[] = []
  if (!env) {
    // 回退：dbus-launch 的约定路径
    const guess = `${homedir()}/.dbus/session-bus`
    void guess
    return out
  }
  const entries = env.split(';').filter(Boolean)
  for (const entry of entries) {
    const [kind, rest] = entry.split(':')
    if (kind !== 'unix' || !rest) continue
    const params = rest.split(',')
    const addr: BusAddress = {}
    for (const p of params) {
      const idx = p.indexOf('=')
      if (idx < 0) continue
      const k = p.slice(0, idx)
      let v = p.slice(idx + 1)
      // dbus 地址里 %XX 转义（%2C 逗号 / %3D 等号）
      try {
        v = decodeURIComponent(v)
      } catch {
        // 保留原值
      }
      if (k === 'path') addr.path = v
      else if (k === 'abstract') addr.abstract = v
    }
    if (addr.path || addr.abstract) out.push(addr)
  }
  return out
}

export type MessageHandler = (msg: DbusMessage) => void

interface Pending {
  resolve: (msg: DbusMessage) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class DbusConnection {
  private socket: Socket | null = null
  private buf: Buffer = Buffer.alloc(0)
  private serial = 0
  private pending = new Map<number, Pending>()
  private handler: MessageHandler | null = null
  private closed = false
  uniqueName = ''
  private readonly address: BusAddress

  constructor(address: BusAddress) {
    this.address = address
  }

  /** 建立连接 + Hello */
  static async connect(opts?: { timeoutMs?: number }): Promise<DbusConnection> {
    const addresses = parseBusAddress()
    if (addresses.length === 0) {
      throw new Error('DBUS_SESSION_BUS_ADDRESS is empty or has no unix transport')
    }
    let lastErr: unknown = null
    for (const addr of addresses) {
      const conn = new DbusConnection(addr)
      try {
        await conn.open()
        return conn
      } catch (err) {
        lastErr = err
        conn.destroy()
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('failed to connect to session bus')
  }

  /**
   * 连接 + SASL 认证 + Hello。
   *
   * D-Bus 总线在收到任何二进制消息之前，要求客户端先完成文本 SASL 握手
   * （否则直接断开连接，表现为 ECONNRESET）：
   *   1) 发送 "\0AUTH EXTERNAL <hex(uid)>\r\n"
   *   2) 读到一行 "OK <guid>"（REJECTED 则回退 AUTH ANONYMOUS）
   *   3) 可选 "NEGOTIATE_UNIX_FD" → "AGREE_UNIX_FD" / "ERROR"
   *   4) 发送 "BEGIN\r\n"，之后才切换到二进制消息
   */
  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      let sock: Socket
      try {
        sock =
          this.address.path !== undefined
            ? createConnection({ path: this.address.path })
            : createConnection({ path: `\0${this.address.abstract}` })
        this.socket = sock
      } catch (err) {
        fail(err)
        return
      }
      sock.once('error', fail)
      sock.once('connect', () => {
        sock.off('error', fail)
        this.authenticate(sock, () => {
          // BEGIN 已发出、SASL 监听器已摘除：切换到二进制消息处理
          sock.on('data', (chunk: Buffer) => this.onData(chunk))
          sock.on('error', (err: Error) => this.onFatal(err))
          sock.on('close', () => this.onFatal(new Error('bus connection closed')))
        }).then(
          () => {
            this.hello().then(
              () => {
                if (settled) return
                settled = true
                resolve()
              },
              (err) => fail(err)
            )
          },
          (err) => fail(err)
        )
      })
    })
  }

  /**
   * 文本 SASL 握手（按 
 逐行交互）。
   * 状态：AUTH → (OK) → NEGOTIATE_UNIX_FD → (AGREE_UNIX_FD | ERROR) → BEGIN → 完成
   */
  private authenticate(sock: Socket, onBegin: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let textBuf = ''
      let uidHex = ''
      try {
        const uid = process.getuid?.()
        uidHex = uid === undefined ? '' : Buffer.from(String(uid), 'utf-8').toString('hex')
      } catch {
        uidHex = ''
      }
      const authLine = uidHex ? `\0AUTH EXTERNAL ${uidHex}\r\n` : '\0AUTH EXTERNAL\r\n'
      let triedAnonymous = false
      let startedBefore = false
      let finished = false
      let timer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        timer = null
        sock.off('data', onData)
        finished = true
      }

      const write = (line: string): void => {
        if (finished) return
        try {
          sock.write(Buffer.from(line, 'utf-8'))
        } catch (err) {
          cleanup()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }

      const begin = (): void => {
        if (startedBefore) return
        startedBefore = true
        // 顺序很重要：
        //  1) 摘掉 SASL 文本监听器
        //  2) 装上二进制监听器（onBegin）
        //  3) ��发 BEGIN —— 此后总线回的消息才是二进制
        cleanup()
        onBegin()
        try {
          sock.write(Buffer.from('BEGIN\r\n', 'utf-8'))
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        resolve()
      }

      const onLine = (line: string): void => {
        const upper = line.trim().toUpperCase()
        if (upper.startsWith('OK ')) {
          // 认证通过 → 协商 unix fd（不支持时总线回 ERROR，仍然可以继续）
          write('NEGOTIATE_UNIX_FD\r\n')
          return
        }
        if (upper.startsWith('AGREE_UNIX_FD')) {
          begin()
          return
        }
        if (upper.startsWith('ERROR')) {
          // 不支持 fd 传递（或命令错误）：继续进入二进制模式即可
          begin()
          return
        }
        if (upper.startsWith('REJECTED')) {
          if (!triedAnonymous) {
            triedAnonymous = true
            write('AUTH ANONYMOUS\r\n')
            return
          }
          cleanup()
          reject(new Error(`dbus SASL rejected: ${line}`))
          return
        }
        if (upper.startsWith('DATA')) {
          // EXTERNAL 一般不会走 DATA；回空数据让服务端继续
          write('DATA\r\n')
          return
        }
        // 其它未知响应忽略
      }

      const onData = (chunk: Buffer): void => {
        textBuf += chunk.toString('utf-8')
        for (;;) {
          const idx = textBuf.indexOf('\r\n')
          if (idx < 0) break
          const line = textBuf.slice(0, idx)
          textBuf = textBuf.slice(idx + 2)
          if (line.trim() && !finished) onLine(line)
        }
      }

      sock.on('data', onData)
      sock.once('error', (err) => {
        if (finished) return
        cleanup()
        reject(err)
      })
      timer = setTimeout(() => {
        if (finished) return
        cleanup()
        reject(new Error('dbus SASL authentication timeout'))
      }, 10_000)
      timer.unref?.()

      write(authLine)
    })
  }

  private hello(): Promise<void> {
    return this.call(
      {
        path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus',
        member: 'Hello',
        destination: 'org.freedesktop.DBus',
        signature: '',
        body: []
      },
      60_000
    ).then(
      (reply) => {
        this.uniqueName = String(reply.body[0] ?? '')
      },
      (err: unknown) => {
        throw err instanceof Error ? err : new Error(String(err))
      }
    )
  }

  async requestName(name: string, flags = 0): Promise<number> {
    const reply = await this.call({
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'RequestName',
      destination: 'org.freedesktop.DBus',
      signature: 'su',
      body: [name, flags]
    })
    return Number(reply.body[0] ?? 0)
  }

  async releaseName(name: string): Promise<void> {
    await this.call({
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'ReleaseName',
      destination: 'org.freedesktop.DBus',
      signature: 's',
      body: [name]
    })
  }

  /** 发送方法调用并等待 METHOD_RETURN（若对端回 ERROR 则 reject） */
  call(msg: Omit<DbusMessage, 'type' | 'serial' | 'flags'>, timeoutMs = 10_000): Promise<DbusMessage> {
    return new Promise<DbusMessage>((resolve, reject) => {
      if (!this.socket || this.closed) {
        reject(new Error('bus not connected'))
        return
      }
      const serial = ++this.serial
      const timer = setTimeout(() => {
        this.pending.delete(serial)
        reject(new Error(`dbus call timeout: ${msg.member}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(serial, { resolve, reject, timer })
      const packet = marshal({
        ...msg,
        type: MSG_TYPE.METHOD_CALL,
        flags: 0,
        serial
      })
      try {
        this.socket.write(packet)
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(serial)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** 发信号（不发回复） */
  emitSignal(
    msg: Pick<DbusMessage, 'path' | 'interface' | 'member' | 'signature' | 'body' | 'destination'>
  ): void {
    if (!this.socket || this.closed) return
    const packet = marshal({ ...msg, type: MSG_TYPE.SIGNAL, flags: 0, serial: ++this.serial })
    this.safeWrite(packet)
  }

  /** 安全写 socket：对端关闭时不抛错（EPIPE 不应把整个服务带崩） */
  private safeWrite(packet: Buffer): boolean {
    if (!this.socket || this.closed) return false
    try {
      this.socket.write(packet)
      return true
    } catch (err) {
      return false
    }
  }

  /** 发送方法返回 */
  sendReply(replyTo: DbusMessage, outSignature: string, outBody: unknown[]): void {
    if (!this.socket || this.closed) return
    if (replyTo.flags & FLAG.NO_REPLY_EXPECTED) return
    const packet = marshal({
      type: MSG_TYPE.METHOD_RETURN,
      flags: 0,
      serial: ++this.serial,
      replySerial: replyTo.serial,
      destination: replyTo.sender,
      signature: outSignature,
      body: outBody
    })
    this.safeWrite(packet)
  }

  /** 发送方法错误返回 */
  sendError(replyTo: DbusMessage, errorName: string, text: string): void {
    if (!this.socket || this.closed) return
    if (replyTo.flags & FLAG.NO_REPLY_EXPECTED) return
    const packet = marshal({
      type: MSG_TYPE.ERROR,
      flags: 0,
      serial: ++this.serial,
      errorName,
      replySerial: replyTo.serial,
      destination: replyTo.sender,
      signature: 's',
      body: [text]
    })
    this.safeWrite(packet)
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  private onData(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    // 循环切分：一条 socket 数据可能包含多条消息
    for (;;) {
      let len = 0
      try {
        len = frameLength(this.buf)
      } catch (err) {
        this.onFatal(err instanceof Error ? err : new Error(String(err)))
        return
      }
      if (len === 0 || this.buf.length < len) return
      // 注意：必须复制，不能直接 subarray —— parseMessage 的对齐是相对消息起点计算的，
      // 而 subarray 会让 buf 的起始偏移不为 0，导致读越界。
      const frame = Buffer.from(this.buf.subarray(0, len))
      this.buf = this.buf.subarray(len)
      let msg: DbusMessage
      try {
        msg = parseMessage(frame)
      } catch (err) {
        // 单条消息解析失败不应拖垮整条连接：以 type=0（MALFORMED）交给服务层记录
        this.dispatch({
          type: 0,
          flags: 0,
          serial: 0,
          signature: '',
          body: [err instanceof Error ? err.message : String(err)]
        })
        continue
      }
      // 关键：回复/方法调用都走 dispatch，pending 里的 call() 才能收到结果
      this.dispatch(msg)
    }
  }

  private dispatch(msg: DbusMessage): void {
    if (msg.type === MSG_TYPE.METHOD_RETURN || msg.type === MSG_TYPE.ERROR) {
      const p = msg.replySerial !== undefined ? this.pending.get(msg.replySerial) : undefined
      if (p) {
        this.pending.delete(msg.replySerial!)
        clearTimeout(p.timer)
        if (msg.type === MSG_TYPE.ERROR) {
          p.reject(new Error(`${msg.errorName ?? 'dbus error'}: ${String(msg.body[0] ?? '')}`))
        } else {
          p.resolve(msg)
        }
        return
      }
    }
    try {
      this.handler?.(msg)
    } catch (err) {
      // handler 内部错误不应影响连接
      console.error('[dbus] message handler error:', err)
    }
  }

  private onFatal(err: Error): void {
    if (this.closed) return
    this.closed = true
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    this.onDisconnect?.(err)
  }

  onDisconnect: ((err: Error) => void) | null = null

  destroy(): void {
    this.closed = true
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('bus destroyed'))
    }
    this.pending.clear()
    try {
      this.socket?.destroy()
    } catch {
      // ignore
    }
    this.socket = null
  }

  get connected(): boolean {
    return this.socket !== null && !this.closed
  }
}
