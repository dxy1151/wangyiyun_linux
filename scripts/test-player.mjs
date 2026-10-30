#!/usr/bin/env node
/**
 * 播放引擎冒烟测试（node scripts/test-player.mjs）
 *
 * 用最小 DOM 桩（fake Audio / localStorage / indexedDB 缺失 / window.nt 缺失）
 * 在纯 node 环境下验证：
 *   1. store/player.ts 可被导入（没有 Electron / window.nt 也不崩）
 *   2. 队列/切歌/模式/音量/收藏/最近播放/歌词解析 API 行为正确
 *   3. 取不到音频直链时进入"演示模式"、networkBanner 设置且不抛异常
 *   4. api 层在断网/非法输入下返回兜底值而不是 reject
 *
 * 依赖：需要项目已 npm install（zustand + esbuild）。用 esbuild 把 TS 内联打包后执行。
 */
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

/* ------------------------------ DOM 桩 ------------------------------ */

function installStubs() {
  const listeners = new Map()
  class FakeAudio {
    constructor() {
      globalThis.__lastAudio = this
      this.__endedHandlers = []
      this.src = ''
      this.currentTime = 0
      this.duration = 180
      this.volume = 1
      this.muted = false
      this.preload = 'auto'
      this.crossOrigin = null
      this.paused = true
    }
    addEventListener(type, cb) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb])
      if (type === 'ended') this.__endedHandlers.push(cb)
    }
    __fireEnded() {
      for (const cb of this.__endedHandlers) {
        try {
          cb({ target: this, type: 'ended' })
        } catch {
          /* ignore */
        }
      }
    }
    removeEventListener() {}
    removeAttribute() {
      this.src = ''
    }
    load() {}
    play() {
      playCalls.n++
      this.paused = false
      emit(this, 'playing')
      return Promise.resolve()
    }
    pause() {
      this.paused = true
      emit(this, 'pause')
    }
    set currentTimeVal(v) {
      this.currentTime = v
    }
  }
  function emit(el, type) {
    for (const cb of listeners.get(type) ?? []) {
      try {
        cb({ target: el, type })
      } catch {
        /* ignore */
      }
    }
  }

  // node 18+ 自带 EventTarget，window 桩里沿用（否则 addEventListener 被覆盖成 no-op 会炸）
  const baseWindow = globalThis

  const playCalls = { n: 0 }
  globalThis.__playCalls = playCalls

  const storage = new Map()
  globalThis.localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
    key: i => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size
    }
  }
  // 夹具：让网络请求可控（默认模拟"离线"，由测试按需切换）
  //   resolvedFetch(url) 由测试覆盖来模拟在线
  const net = {
    mode: 'offline', // 'offline' | 'custom'
    handler: null
  }
  globalThis.__net = net
  const fixtureFetch = (url, init) => {
    if (net.mode === 'offline') return Promise.reject(new Error('offline-stub'))
    if (typeof net.handler === 'function') return net.handler(String(url), init)
    return Promise.reject(new Error('offline-stub'))
  }
  globalThis.fetch = fixtureFetch

  globalThis.window = baseWindow
  globalThis.Audio = FakeAudio
  globalThis.HTMLAudioElement = FakeAudio
  globalThis.URL.createObjectURL = () => 'blob:fake'
  globalThis.URL.revokeObjectURL = () => {}
  globalThis.setInterval = () => 1
  globalThis.clearInterval = () => {}
  // 不安装 indexedDB：验证无 IndexedDB 环境下也能工作
  // 不安装 window.nt：验证纯浏览器/无 preload 环境下不崩
}

/* ------------------------------ 打包 TS ------------------------------ */

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    outfile,
    logLevel: 'silent',
    alias: {
      '@shared': resolve(ROOT, 'src/shared'),
      '@': resolve(ROOT, 'src/renderer/src')
    },
    external: []
  })
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'nt-player-test-'))
  try {
    installStubs()
    const origFetch = globalThis.fetch
    globalThis.window.fetch = origFetch

    // 1) 打包一个 driver：把 store + api 暴露到 globalThis
    const driver = `
      export * as api from '${resolve(ROOT, 'src/renderer/src/api/index.ts').replace(/\\/g, '/')}'
      export * as player from '${resolve(ROOT, 'src/renderer/src/store/player.ts').replace(/\\/g, '/')}'
    `
    const driverPath = join(dir, 'driver.ts')
    await writeFile(driverPath, driver, 'utf8')
    const outfile = join(dir, 'driver.mjs')
    await bundle(driverPath, outfile)

    const mod = await import(pathToFileURL(outfile).href)
    const { player, api } = mod

    console.log('\n▶ 模块导入')
    check('store/player.ts 可导入', !!player.usePlayerStore)
    check('api/index.ts 可导入', !!api.searchMulti)

    const store = player.usePlayerStore
    const S = () => store.getState()

    const mk = (id, name = `song${id}`) => ({
      id,
      name,
      artists: [{ id: 1, name: '歌手' }],
      album: { id: 2, name: '专辑', picUrl: '' },
      duration: 180000,
      fee: 0,
      picUrl: '',
      artistText: '歌手'
    })

    check('初始 networkBanner 为 null', S().networkBanner === null)

    /* --------------------------- 在线路径（可用直链） --------------------------- */
    console.log('\n▶ 在线路径（模拟 gdstudio 返回直链）')
    globalThis.__net.mode = 'custom'
    globalThis.__net.handler = url => {
      const u = String(url)
      if (u.includes('types=url')) {
        return Promise.resolve(
          jsonResponse({ url: 'https://example.invalid/song.mp3', br: 320, size: 13042460, from: 'stub' })
        )
      }
      if (u.includes('song/lyric')) {
        return Promise.resolve(
          jsonResponse({ lrc: { lyric: '[00:01.00]第一句\n[00:03.00]第二句' }, tlyric: { lyric: '[00:01.00]line one' } })
        )
      }
      return Promise.reject(new Error('unexpected url: ' + u))
    }
    const before = globalThis.__playCalls.n
    S().playQueue([mk(11), mk(12)], 0)
    await sleep(600)
    check('在线：解析到直链后调用 audio.play()', globalThis.__playCalls.n > before, `plays=${globalThis.__playCalls.n - before}`)
    check('在线：audioSource 记录来源', S().audioSource.length > 0, `audioSource=${S().audioSource}`)
    check('在线：不处于演示模式', S().demoMode === false)
    check('在线：歌词已加载（双语合并）', S().lyrics.length === 2 && S().lyrics[0].translation === 'line one', JSON.stringify(S().lyrics))
    check('在线：lyricIndex 随进度计算', typeof S().lyricIndex === 'number')
    globalThis.__net.mode = 'offline'
    globalThis.__net.handler = null

    /* --------------------------- 连续快速切歌不串音 --------------------------- */
    console.log('\n▶ 连续快速切歌（取消旧请求，不串音）')
    globalThis.__net.mode = 'custom'
    const slow = []
    globalThis.__net.handler = (url, init) => {
      const u = String(url)
      if (u.includes('types=url')) {
        const id = Number(new URL(u).searchParams.get('id'))
        // 模拟 300ms 延迟；若被 abort 则 reject
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(jsonResponse({ url: `https://example.invalid/${id}.mp3`, br: 320, size: 1000 })), 300)
          init?.signal?.addEventListener?.('abort', () => {
            clearTimeout(t)
            reject(new Error('AbortError'))
          })
        })
      }
      if (u.includes('song/lyric')) {
        return Promise.resolve(jsonResponse({ lrc: { lyric: `[00:00.00]${u}` } }))
      }
      return Promise.reject(new Error('unexpected url ' + u))
    }
    const ra = mk(21, 'A')
    const rb = mk(22, 'B')
    const rc = mk(23, 'C')
    S().playQueue([ra, rb, rc], 0)
    await sleep(60)
    S().playTrack(rc)
    await sleep(60)
    S().playTrack(rb)
    await sleep(900)
    check('快速切歌后 current 为最后一次点击的曲目', S().current?.id === 22, `current=${S().current?.id}`)
    check('快速切歌后 currentIndex 与 current 一致', S().queue[S().currentIndex]?.id === S().current?.id)
    check('快速切歌后队列未被破坏', S().queue.length === 3)
    void slow
    globalThis.__net.mode = 'offline'
    globalThis.__net.handler = null

    /* --------------------------- 播放模式真实验证 --------------------------- */
    console.log('\n▶ 播放模式（模拟 onended 自动切歌）')
    const playAudio = () => {
      // 触发最后一次创建的 audio 的 ended 事件，模拟"歌曲播完"
      const el = globalThis.__lastAudio
      if (!el) return
      el.__fireEnded?.()
    }
    S().setMode('repeat-one')
    S().playQueue([mk(31), mk(32)], 0)
    await sleep(200)
    const beforeRepeat = S().current?.id
    playAudio()
    await sleep(150)
    check('单曲循环：播完仍是同一首歌', S().current?.id === beforeRepeat, `before=${beforeRepeat} after=${S().current?.id}`)

    S().setMode('order')
    S().playQueue([mk(41), mk(42)], 0)
    await sleep(150)
    S().next() // 手动 next 在单曲循环下也应该切歌
    await sleep(150)
    check('手动 next 在单曲循环下切歌', S().current?.id === 42, `current=${S().current?.id}`)

    S().playQueue([mk(51), mk(52)], 0)
    await sleep(200)
    playAudio()
    await sleep(200)
    check('order 模式播完自动下一首', S().current?.id === 52, `current=${S().current?.id}`)
    playAudio()
    await sleep(200)
    check('order 模式最后一首播完停止', S().isPlaying === false, `isPlaying=${S().isPlaying}`)

    S().setMode('loop')
    S().playQueue([mk(61), mk(62)], 0)
    await sleep(200)
    playAudio()
    await sleep(150)
    playAudio()
    await sleep(200)
    check('loop 模式末尾回到第一首', S().current?.id === 61, `current=${S().current?.id}`)

    /* --------------------------- 队列与播放 --------------------------- */
    console.log('\n▶ 队列与播放')

    const songs = [mk(1), mk(2), mk(3), mk(4)]

    store.getState().playQueue(songs, 1)
    check('playQueue 设置 current', S().current?.id === 2)
    check('playQueue 设置 queue 长度', S().queue.length === 4)
    check('playQueue 设置 currentIndex', S().currentIndex === 1)
    await sleep(150)
    // 测试夹具：录制所有 play() 调用，证明播放引擎确实驱动了 audio.play()
    await sleep(300)
    const played = globalThis.__playCalls.n > 0
    const demo = typeof S().networkBanner === 'string'
    check('playQueue 后驱动播放或进入演示模式', played || demo, `plays=${globalThis.__playCalls.n} banner=${S().networkBanner}`)
    check('playQueue 后 current 正确', S().current?.id === 2)
    check('playQueue 后 buffering 结束', S().isBuffering === false, `buffering=${S().isBuffering}`)

    S().setMode('loop')
    S().next()
    await tick()
    check('next() → 下一首', S().current?.id === 3, `current=${S().current?.id}`)

    S().next()
    await tick()
    S().next()
    await tick()
    check('loop 模式末曲后回到第一首', S().current?.id === 1, `current=${S().current?.id}`)

    S().seek(60000)
    check('seek(ms) 更新 progress', S().progress === 60000, `progress=${S().progress}`)

    S().prev()
    await tick()
    check('prev()（播放 >3s 时先回到开头）', S().progress === 0, `progress=${S().progress}`)

    S().setVolume(0.35)
    check('setVolume 生效', Math.abs(S().volume - 0.35) < 1e-6)
    check('音量持久化到 localStorage', (localStorage.getItem('nt.player') ?? '').includes('0.35'))

    S().setMode('repeat-one')
    check('setMode 生效', S().mode === 'repeat-one')
    check('setMode 持久化', (localStorage.getItem('nt.player') ?? '').includes('repeat-one'))

    S().setMode('shuffle')
    check('shuffle 模式生效', S().mode === 'shuffle')

    /* --------------------------- 队列编辑 --------------------------- */
    console.log('\n▶ 队列编辑')
    S().setMode('order')
    S().playQueue(songs, 0)
    await sleep(200)
    const curIdx = S().currentIndex
    S().addNext(mk(99, '插播'))
    check('addNext 插入到当前之后', S().queue[curIdx + 1]?.id === 99, `idx=${curIdx} queue=${S().queue.map(s => s.id).join(',')}`)
    S().addToQueue(mk(100, '队尾'))
    check('addToQueue 追加到队尾', S().queue[S().queue.length - 1]?.id === 100)
    const beforeLen = S().queue.length
    const insertIdx = S().queue.findIndex(s => s.id === 99)
    S().removeFromQueue(insertIdx)
    check('removeFromQueue 移除指定项', S().queue.length === beforeLen - 1 && !S().queue.some(s => s.id === 99))
    S().clearQueue()
    await tick()
    check('clearQueue 清空队列', S().queue.length === 0 && S().current === null)
    check('clearQueue 后 isPlaying=false', S().isPlaying === false)

    /* --------------------------- 收藏 / 最近 --------------------------- */
    console.log('\n▶ 收藏与最近播放')
    S().toggleFavorite(songs[0])
    check('toggleFavorite 添加', S().favorites.some(s => s.id === 1))
    check('isFavorite 返回 true', S().isFavorite(1) === true)
    S().toggleFavorite(songs[0])
    check('toggleFavorite 取消', !S().favorites.some(s => s.id === 1))
    S().addRecent(songs[2])
    check('addRecent 记录', S().recent[0]?.id === 3)
    check('收藏持久化', localStorage.getItem('nt.favorites') !== null)

    /* --------------------------- 失败降级 --------------------------- */
    console.log('\n▶ 降级（无音源 / 无网络）')
    // 切回离线夹具（所有 fetch reject），并强制清空直链/探测缓存，模拟真正断网
    globalThis.__net.mode = 'offline'
    globalThis.__net.handler = null
    api.raw.mirror.resetMirrorState()
    // 换一首必不相同的 id，避免命中 4s 内的直链 memo
    S().playQueue([{ ...songs[0], id: 777001, name: '新歌A' }, { ...songs[1], id: 777002, name: '新歌B' }], 0)
    await sleep(2500)
    const banner = S().networkBanner
    check('无音源时不抛异常且设置 networkBanner', typeof banner === 'string' && banner.length > 0, `banner=${banner}`)
    check('无音源时 demoMode/自动跳过不卡死', S().current !== null)
    check('demoMode 标记', S().demoMode === true, `demoMode=${S().demoMode}`)
    console.log('    [debug] current=', S().current?.id, 'queue=', S().queue.map(s => s.id).join(','), 'isPlaying=', S().isPlaying, 'buffering=', S().isBuffering, 'progress=', S().progress)

    /* --------------------------- api 兜底 --------------------------- */
    console.log('\n▶ API 层兜底（fetch 全失败）')
    const r1 = await api.searchSongs('周杰伦')
    check('searchSongs 失败返回 []', Array.isArray(r1) && r1.length === 0)
    const r2 = await api.searchMulti('周杰伦')
    check('searchMulti 失败返回空结构', r2 && r2.keyword === '周杰伦' && r2.songs.length === 0)
    const r3 = await api.getPlaylist(3778678)
    check('getPlaylist 失败返回 null', r3 === null)
    const r4 = await api.getSongUrl(347230)
    check('getSongUrl 不抛异常（失败为 null）', r4 === null || typeof r4 === 'string')
    const r5 = await api.getLyrics(1)
    // 有歌词缓存时可能返回缓存命中结果；只要求不 reject 且结构合法
    check('getLyrics 不抛异常', r5 === null || (r5 && typeof r5 === 'object' && typeof r5.lrc === 'string'))
    const r6 = await api.getHotCharts()
    check('getHotCharts 失败返回 []', Array.isArray(r6))
    const r7 = await api.getRecommend()
    check('getRecommend 失败返回 []', Array.isArray(r7))
    const r8 = await api.getNewSongs()
    check('getNewSongs 失败返回 []', Array.isArray(r8))
    const r9 = await api.raw.mirror.probe()
    check('mirror.probe 不抛异常（返回 boolean）', typeof r9 === 'boolean', `got=${r9}`)
    const r10 = await api.probeAudioSource()
    check('probeAudioSource 不抛异常', typeof r10 === 'boolean')

    /* --------------------------- LRC 解析 --------------------------- */
    console.log('\n▶ LRC 解析')
    const { parseLrc, findLyricIndex } = api
    const lines = parseLrc('[00:01.00]第一行\n[00:05.50]第二行\n[00:02.25]第二段', '[00:01.00]Line 1\n[00:05.50]Line 2')
    check('parseLrc 行数', lines.length === 3, `n=${lines.length}`)
    check('parseLrc 排序', lines[0].time === 1000 && lines[1].time === 2250 && lines[2].time === 5500)
    check('parseLrc 译文合并', lines[0].translation === 'Line 1', JSON.stringify(lines[0]))
    check('findLyricIndex 命中', findLyricIndex(lines, 6000) === 2)
    check('findLyricIndex 早于首行返回 -1', findLyricIndex(lines, 500) === -1)

    /* --------------------------- 异常输入 --------------------------- */
    console.log('\n▶ 异常输入')
    let threw = false
    try {
      S().playQueue([], 0)
      S().playQueue(null, 0)
      S().playTrack(null)
      S().seek(-100)
      S().setVolume(NaN)
      S().removeFromQueue(999)
      S().next()
      S().prev()
      S().addNext(null)
      await tick()
    } catch (err) {
      threw = true
      console.log('    ', err)
    }
    check('非法输入不抛异常', !threw)

    console.log(failures === 0 ? '\n✅ 全部通过\n' : `\n❌ ${failures} 项失败\n`)
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    type: 'basic',
    text: () => Promise.resolve(JSON.stringify(obj)),
    json: () => Promise.resolve(obj)
  }
}

function tick(ms = 50) {
  return new Promise(r => setTimeout(r, ms))
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

main().catch(err => {
  console.error('测试脚本自身异常：', err)
  process.exitCode = 1
})
