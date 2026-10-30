/**
 * 最小 D-Bus 消息编解码（纯 JS，零原生依赖 / 零 npm 依赖）
 *
 * 只实现 MPRIS 服务端需要的类型子集：
 *   y b n q i u x t d s o g v a（含 a{sv}）
 *
 * 关键格式（与 dbus-daemon 抓包逐字节核对过）：
 *   - STRING / OBJECT_PATH：u32 长度（4 字节对齐起点） + UTF-8 + NUL
 *   - SIGNATURE：          1 字节长度 + 内容 + NUL（不是 u32！）
 *   - VARIANT：            SIGNATURE + 值；整体 1 字节对齐
 *   - struct / dict-entry：起点 8 字节对齐
 *   - 数组：               u32 长度（4 对齐） + 元素
 *
 * 消息头（固定 16 字节）：[0]=字节序 'l' [1]=类型 [2]=flags [3]=版本(1)
 *   [4-7]=body 长度 [8-11]=serial [12-15]=header fields(a(yv)) 长度
 *   字段区之后补 0 到 8 字节边界，才是 body。
 */

export const MSG_TYPE = {
  METHOD_CALL: 1,
  METHOD_RETURN: 2,
  ERROR: 3,
  SIGNAL: 4
} as const

export const FLAG = {
  NO_REPLY_EXPECTED: 0x1
} as const

export const HDR = {
  PATH: 1,
  INTERFACE: 2,
  MEMBER: 3,
  ERROR_NAME: 4,
  REPLY_SERIAL: 5,
  DESTINATION: 6,
  SENDER: 7,
  SIGNATURE: 8,
  UNIX_FDS: 9
} as const

export interface DbusMessage {
  type: number
  flags: number
  serial: number
  path?: string
  interface?: string
  member?: string
  errorName?: string
  replySerial?: number
  destination?: string
  sender?: string
  signature: string
  body: unknown[]
}

/** 带签名的值（D-Bus VARIANT） */
export interface VariantValue {
  signature: string
  value: unknown
}

export function variant(signature: string, value: unknown): VariantValue {
  return { signature, value }
}

const BASIC = 'ybnqiuxtdsog'

/** 把签名串拆成完整类型：'as' -> ['as']、'sa{sv}as' -> ['s','a{sv}','as'] */
export function splitSignature(sig: string): string[] {
  const out: string[] = []
  let i = 0
  const readOne = (): string => {
    const ch = sig[i++]
    if (ch === 'a') return 'a' + readOne()
    if (ch === '(') {
      let depth = 1
      let inner = ''
      while (i < sig.length && depth > 0) {
        const c = sig[i++]
        if (c === '(') depth++
        else if (c === ')') depth--
        if (depth > 0) inner += c
      }
      return '(' + inner + ')'
    }
    if (ch === '{') {
      let inner = ''
      while (i < sig.length && sig[i] !== '}') inner += sig[i++]
      i++ // 跳过 '}'
      return '{' + inner + '}'
    }
    return ch
  }
  while (i < sig.length) {
    const t = readOne()
    if (t) out.push(t)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

export class Writer {
  buf: Buffer
  pos = 0

  constructor(size = 512) {
    this.buf = Buffer.alloc(size)
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.pos + n) size *= 2
    const next = Buffer.alloc(size)
    this.buf.copy(next, 0, 0, this.pos)
    this.buf = next
  }

  align(n: number): void {
    const pad = (n - (this.pos % n)) % n
    if (pad === 0) return
    this.ensure(pad)
    this.buf.fill(0, this.pos, this.pos + pad)
    this.pos += pad
  }

  byte(v: number): void {
    this.ensure(1)
    this.buf.writeUInt8(v & 0xff, this.pos++)
  }

  u16(v: number): void {
    this.align(2)
    this.ensure(2)
    this.buf.writeUInt16LE(v & 0xffff, this.pos)
    this.pos += 2
  }

  i16(v: number): void {
    this.align(2)
    this.ensure(2)
    this.buf.writeInt16LE(v | 0, this.pos)
    this.pos += 2
  }

  u32(v: number): void {
    this.align(4)
    this.ensure(4)
    this.buf.writeUInt32LE(v >>> 0, this.pos)
    this.pos += 4
  }

  i32(v: number): void {
    this.align(4)
    this.ensure(4)
    this.buf.writeInt32LE(v | 0, this.pos)
    this.pos += 4
  }

  u64(v: number): void {
    this.align(8)
    this.ensure(8)
    this.buf.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(v))), this.pos)
    this.pos += 8
  }

  i64(v: number): void {
    this.align(8)
    this.ensure(8)
    this.buf.writeBigInt64LE(BigInt(Math.trunc(v)), this.pos)
    this.pos += 8
  }

  dbl(v: number): void {
    this.align(8)
    this.ensure(8)
    this.buf.writeDoubleLE(v, this.pos)
    this.pos += 8
  }

  /** BOOLEAN：u32(0/1)，4 字节对齐 */
  bool(v: boolean): void {
    this.u32(v ? 1 : 0)
  }

  /** STRING / OBJECT_PATH：u32 长度(4 对齐) + UTF-8 + NUL */
  str(v: string): void {
    const b = Buffer.from(v ?? '', 'utf-8')
    this.u32(b.length)
    this.ensure(b.length + 1)
    b.copy(this.buf, this.pos)
    this.pos += b.length
    this.byte(0)
  }

  /** SIGNATURE：1 字节长度 + 内容 + NUL */
  sig(v: string): void {
    const b = Buffer.from(v ?? '', 'utf-8')
    this.ensure(1 + b.length + 1)
    this.byte(b.length)
    b.copy(this.buf, this.pos)
    this.pos += b.length
    this.byte(0)
  }

  /** VARIANT：直接在当前偏移写 SIGNATURE，再写值 */
  variant(v: VariantValue): void {
    this.sig(v.signature)
    this.write(v.signature, v.value)
  }

  /** 写单字符签名的值（以 'a' 开头的数组签名也走这里） */
  write(signature: string, value: unknown): void {
    if (signature.startsWith('a')) {
      this.array(signature.slice(1), (value as unknown[]) ?? [])
      return
    }
    switch (signature) {
      case 'y':
        this.byte(Number(value) || 0)
        return
      case 'b':
        this.bool(Boolean(value))
        return
      case 'n':
        this.i16(Number(value) || 0)
        return
      case 'q':
        this.u16(Number(value) || 0)
        return
      case 'i':
        this.i32(Number(value) || 0)
        return
      case 'u':
        this.u32(Number(value) || 0)
        return
      case 'x':
        this.i64(Number(value) || 0)
        return
      case 't':
        this.u64(Number(value) || 0)
        return
      case 'd':
        this.dbl(Number(value) || 0)
        return
      case 's':
        this.str(String(value ?? ''))
        return
      case 'o':
        this.str(String(value ?? '/'))
        return
      case 'g':
        this.sig(String(value ?? ''))
        return
      case 'v':
        this.variant(value as VariantValue)
        return
      default:
        throw new Error(`encode: unsupported signature '${signature}'`)
    }
  }

  /**
   * 数组：u32 长度（4 对齐） + 元素内容。
   * 数组内容起点按元素自身对齐；dict-entry('{sv}') 在数组内部同样从内容起点开始
   * （实测 dbus-daemon 帧：a{sv} 的第一个 entry 紧跟长度字段，没有额外 8 字节填充）。
   */
  array(elemSig: string, items: unknown[]): void {
    this.u32(0)
    const lenPos = this.pos - 4
    // 数组内容起点按【元素对齐】对齐（libdbus 实测：a{sv} 的长度字段后补 4 字节到 8 对齐）
    const elemAlign =
      elemSig === '{sv}' ||
      elemSig === 'd' ||
      elemSig === 'x' ||
      elemSig === 't' ||
      elemSig.startsWith('(') ||
      elemSig.startsWith('a')
        ? 8
        : elemSig === 'v'
          ? 1
          : elemSig === 's' || elemSig === 'o' || elemSig === 'g'
            ? 4
            : elemSig === 'y'
              ? 1
              : elemSig === 'n' || elemSig === 'q'
                ? 2
                : 4
    this.align(elemAlign)
    const start = this.pos
    for (const item of items) {
      if (elemSig === '{sv}') {
        // 每个 dict-entry 起点 8 字节对齐（libdbus 实测；第一个 entry 已由上方 align 就位）
        this.align(8)
        const [k, v] = item as [string, VariantValue]
        this.str(k)
        this.variant(v)
      } else if (elemSig === 'v') {
        this.variant(item as VariantValue)
      } else if (elemSig.startsWith('a')) {
        this.array(elemSig.slice(1), (item as unknown[]) ?? [])
      } else if (elemSig.length === 1 && BASIC.includes(elemSig)) {
        this.write(elemSig, item)
      } else {
        throw new Error(`encode: unsupported array element '${elemSig}'`)
      }
    }
    this.buf.writeUInt32LE(this.pos - start, lenPos)
  }

  /** a{sv} */
  dict(entries: Array<[string, VariantValue]>): void {
    this.array('{sv}', entries)
  }

  result(): Buffer {
    return this.buf.subarray(0, this.pos)
  }
}

/** 序列化完整消息 */
export function marshal(msg: DbusMessage): Buffer {
  const bw = new Writer(512)
  const types = splitSignature(msg.signature)
  for (let i = 0; i < types.length; i++) bw.write(types[i], msg.body[i])
  const bodyBuf = Buffer.from(bw.result())

  const pairs: Array<[number, VariantValue]> = []
  if (msg.path !== undefined) pairs.push([HDR.PATH, variant('o', msg.path)])
  if (msg.interface !== undefined) pairs.push([HDR.INTERFACE, variant('s', msg.interface)])
  if (msg.member !== undefined) pairs.push([HDR.MEMBER, variant('s', msg.member)])
  if (msg.errorName !== undefined) pairs.push([HDR.ERROR_NAME, variant('s', msg.errorName)])
  if (msg.replySerial !== undefined) pairs.push([HDR.REPLY_SERIAL, variant('u', msg.replySerial)])
  if (msg.destination !== undefined) pairs.push([HDR.DESTINATION, variant('s', msg.destination)])
  if (msg.sender !== undefined) pairs.push([HDR.SENDER, variant('s', msg.sender)])
  if (msg.signature && bodyBuf.length > 0) pairs.push([HDR.SIGNATURE, variant('g', msg.signature)])

  const fw = new Writer(256)
  for (const [code, v] of pairs) {
    fw.align(8)
    fw.byte(code)
    fw.variant(v)
  }
  const fieldsBuf = Buffer.from(fw.result())

  const head = Buffer.alloc(16)
  head[0] = 0x6c
  head[1] = msg.type
  head[2] = msg.flags
  head[3] = 1
  head.writeUInt32LE(bodyBuf.length, 4)
  head.writeUInt32LE(msg.serial >>> 0, 8)
  head.writeUInt32LE(fieldsBuf.length, 12)

  const padLen = (8 - (fieldsBuf.length % 8)) % 8
  return Buffer.concat([head, fieldsBuf, Buffer.alloc(padLen), bodyBuf])
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export class Reader {
  buf: Buffer
  pos: number

  constructor(buf: Buffer, start = 0) {
    this.buf = buf
    this.pos = start
  }

  align(n: number): void {
    this.pos += (n - (this.pos % n)) % n
  }

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('decode: unexpected end of message')
    return this.buf.readUInt8(this.pos++)
  }

  u16(): number {
    this.align(2)
    const v = this.buf.readUInt16LE(this.pos)
    this.pos += 2
    return v
  }

  i16(): number {
    this.align(2)
    const v = this.buf.readInt16LE(this.pos)
    this.pos += 2
    return v
  }

  u32(): number {
    this.align(4)
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  i32(): number {
    this.align(4)
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }

  u64(): number {
    this.align(8)
    const v = Number(this.buf.readBigUInt64LE(this.pos))
    this.pos += 8
    return v
  }

  i64(): number {
    this.align(8)
    const v = Number(this.buf.readBigInt64LE(this.pos))
    this.pos += 8
    return v
  }

  dbl(): number {
    this.align(8)
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }

  bool(): boolean {
    return this.u32() !== 0
  }

  str(): string {
    const len = this.u32()
    const s = this.buf.toString('utf-8', this.pos, this.pos + len)
    this.pos += len + 1
    return s
  }

  sig(): string {
    const len = this.byte()
    const s = this.buf.toString('utf-8', this.pos, this.pos + len)
    this.pos += len + 1
    return s
  }

  read(signature: string): unknown {
    if (signature.startsWith('a')) return this.array(signature.slice(1))
    switch (signature) {
      case 'y':
        return this.byte()
      case 'b':
        return this.bool()
      case 'n':
        return this.i16()
      case 'q':
        return this.u16()
      case 'i':
        return this.i32()
      case 'u':
        return this.u32()
      case 'x':
        return this.i64()
      case 't':
        return this.u64()
      case 'd':
        return this.dbl()
      case 's':
      case 'o':
        return this.str()
      case 'g':
        return this.sig()
      case 'v':
        return this.readVariant()
      default:
        throw new Error(`decode: unsupported signature '${signature}'`)
    }
  }

  array(elemSig: string): unknown[] {
    if (elemSig.startsWith('a')) {
      const len0 = this.u32()
      const end0 = this.pos + len0
      const out0: unknown[] = []
      while (this.pos < end0) out0.push(this.array(elemSig.slice(1)))
      this.pos = end0
      return out0
    }
    const len = this.u32()
    // 数组内容起点按元素对齐（与编码侧一致；libdbus 实测 a{sv} 会补到 8 字节边界）
    const elemAlign =
      elemSig === '{sv}' || elemSig === 'd' || elemSig === 'x' || elemSig === 't'
        ? 8
        : elemSig === 'v'
          ? 1
          : elemSig === 's' || elemSig === 'o' || elemSig === 'g'
            ? 4
            : elemSig === 'y'
              ? 1
              : elemSig === 'n' || elemSig === 'q'
                ? 2
                : 4
    this.align(elemAlign)
    const end = this.pos + len
    const out: unknown[] = []
    if (elemSig === '{sv}') {
      // 每个 dict-entry 起点 8 对齐（第一个 entry 已由上面的 align(elemAlign) 就位）
      while (this.pos < end) {
        this.align(8)
        const key = this.str()
        out.push({ key, value: this.readVariant().value })
      }
    } else if (elemSig === 'v') {
      while (this.pos < end) out.push(this.readVariant())
    } else if (elemSig.length === 1 && BASIC.includes(elemSig)) {
      while (this.pos < end) out.push(this.read(elemSig))
    } else {
      this.pos = end
    }
    this.pos = end
    return out
  }

  readVariant(): VariantValue {
    const sig = this.sig()
    return { signature: sig, value: this.read(sig) }
  }
}

export interface ParsedMessage extends DbusMessage {
  bodyStart: number
}

/** 解析一条完整消息（调用方按 frameLength 切分数据流） */
export function parseMessage(buf: Buffer): ParsedMessage {
  if (buf.length < 16) throw new Error('message too short')
  if (buf[0] !== 0x6c) throw new Error('only little-endian messages are supported')
  const msg: ParsedMessage = {
    type: buf[1],
    flags: buf[2],
    serial: buf.readUInt32LE(8),
    signature: '',
    body: [],
    bodyStart: 0
  }
  const fieldsLen = buf.readUInt32LE(12)
  const fieldsEnd = 16 + fieldsLen

  const r = new Reader(buf, 16)
  while (r.pos < fieldsEnd) {
    r.align(8)
    if (r.pos >= fieldsEnd) break
    const code = r.byte()
    const v = r.readVariant()
    switch (code) {
      case HDR.PATH:
        msg.path = String(v.value)
        break
      case HDR.INTERFACE:
        msg.interface = String(v.value)
        break
      case HDR.MEMBER:
        msg.member = String(v.value)
        break
      case HDR.ERROR_NAME:
        msg.errorName = String(v.value)
        break
      case HDR.REPLY_SERIAL:
        msg.replySerial = Number(v.value)
        break
      case HDR.DESTINATION:
        msg.destination = String(v.value)
        break
      case HDR.SENDER:
        msg.sender = String(v.value)
        break
      case HDR.SIGNATURE:
        msg.signature = String(v.value)
        break
      default:
        break
    }
  }

  msg.bodyStart = (fieldsEnd + 7) & ~7
  const br = new Reader(buf, msg.bodyStart)
  for (const t of splitSignature(msg.signature)) msg.body.push(br.read(t))
  return msg
}

/** 数据流中一条完整消息的长度；不足 16 字节返回 0 */
export function frameLength(buf: Buffer): number {
  if (buf.length < 16) return 0
  if (buf[0] !== 0x6c) throw new Error('bad magic byte')
  const bodyLen = buf.readUInt32LE(4)
  const fieldsLen = buf.readUInt32LE(12)
  const bodyStart = (16 + fieldsLen + 7) & ~7
  return bodyStart + bodyLen
}
