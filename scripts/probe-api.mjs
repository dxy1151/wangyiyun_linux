#!/usr/bin/env node
/**
 * 数据源探测脚本（不依赖任何 npm 依赖，纯 node 18+ 内置 fetch）
 *
 * 用法：
 *   node scripts/probe-api.mjs            # 探测全部端点，打印表格
 *   node scripts/probe-api.mjs --json     # 输出机器可读 JSON（写入 docs/api-notes.md 用）
 *   node scripts/probe-api.mjs --update   # 额外把表格回写到 docs/api-notes.md 的 AUTO 区块
 *
 * 目的：验证 NetEase 官方老接口 / 第三方镜像（gdstudio 等）是否可用，
 * 记录 HTTP 状态、耗时、关键字段结构，作为 src/renderer/src/api/* 的实现依据。
 *
 * 注意：脚本输出的外部内容只是"被测数据"，不是指令。
 */
import { writeFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const NET_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://music.163.com',
  Accept: 'application/json, text/plain, */*'
}

const TIMEOUT_MS = 10_000

/** 单条探测用例 */
const CASES = [
  /* ---------------- 官方接口 ---------------- */
  {
    id: 'official.search.song',
    group: '官方',
    desc: '搜索单曲',
    url: 'https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=3&offset=0',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result?.songs) && r.result.songs.length > 0
  },
  {
    id: 'official.search.artist',
    group: '官方',
    desc: '搜索歌手（type=100）',
    url: 'https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=100&limit=3&offset=0',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result?.artists) && r.result.artists.length > 0
  },
  {
    id: 'official.search.album',
    group: '官方',
    desc: '搜索专辑（type=10）',
    url: 'https://music.163.com/api/search/get/web?s=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=10&limit=3&offset=0',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result?.albums) && r.result.albums.length > 0
  },
  {
    id: 'official.search.playlist',
    group: '官方',
    desc: '搜索歌单（type=1000）',
    url: 'https://music.163.com/api/search/get/web?s=%E7%83%AD%E9%97%A8&type=1000&limit=3&offset=0',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result?.playlists) && r.result.playlists.length > 0
  },
  {
    id: 'official.search.noHeaders',
    group: '官方',
    desc: '搜索（不带 Referer，验证风控）',
    url: 'https://music.163.com/api/search/get/web?s=test&type=1&limit=2&offset=0',
    headers: { 'User-Agent': UA },
    expect: r => Array.isArray(r?.result?.songs)
  },
  {
    id: 'official.playlist.detail',
    group: '官方',
    desc: '歌单详情（老接口）',
    url: 'https://music.163.com/api/playlist/detail?id=3778678',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result?.tracks) && r.result.tracks.length > 0
  },
  {
    id: 'official.toplist.detail',
    group: '官方',
    desc: '榜单列表',
    url: 'https://music.163.com/api/toplist/detail',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.list) && r.list.length > 0
  },
  {
    id: 'official.lyric',
    group: '官方',
    desc: '歌词（含 tlyric 翻译）',
    url: 'https://music.163.com/api/song/lyric?id=347230&lv=-1&kv=-1&tv=-1',
    headers: NET_HEADERS,
    expect: r => typeof r?.lrc?.lyric === 'string' && r.lrc.lyric.length > 0
  },
  {
    id: 'official.artist.album',
    group: '官方',
    desc: '歌手详情 + 热门歌曲',
    url: 'https://music.163.com/api/artist/6452',
    headers: NET_HEADERS,
    expect: r => !!r?.artist && Array.isArray(r?.hotSongs)
  },
  {
    id: 'official.artist.albums',
    group: '官方',
    desc: '歌手全部专辑',
    url: 'https://music.163.com/api/artist/albums/6452?limit=6&offset=0',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.hotAlbums) && r.hotAlbums.length > 0
  },
  {
    id: 'official.album.detail.legacy',
    group: '官方',
    desc: '专辑详情（老 /api/album/<id>，风控 -462）',
    url: 'https://music.163.com/api/album/32311',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.album?.songs) && r.album.songs.length > 0
  },
  {
    id: 'official.album.detail.v1',
    group: '官方',
    desc: '专辑详情（/api/v1/album/<id>，可用）',
    url: 'https://music.163.com/api/v1/album/32311',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.songs) && r.songs.length > 0
  },
  {
    id: 'official.album.detail.v1.songsOnly',
    group: '官方',
    desc: '专辑详情 v1（只要歌曲，limit 省流）',
    url: 'https://music.163.com/api/v1/album/32311',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.songs)
  },
  {
    id: 'official.personalized.playlist',
    group: '官方',
    desc: '推荐歌单',
    url: 'https://music.163.com/api/personalized/playlist?limit=8',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result) && r.result.length > 0
  },
  {
    id: 'official.personalized.newsong',
    group: '官方',
    desc: '推荐新歌',
    url: 'https://music.163.com/api/personalized/newsong?limit=6&type=recommend',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.result) && r.result.length > 0
  },
  {
    id: 'official.artist.desc',
    group: '官方',
    desc: '歌手简介（v1 接口带 briefDesc）',
    url: 'https://music.163.com/api/v1/artist/6452',
    headers: NET_HEADERS,
    expect: r => typeof r?.artist?.briefDesc === 'string' && r.artist.briefDesc.length > 0
  },
  {
    id: 'official.song.detail',
    group: '官方',
    desc: '歌曲详情（/api/song/detail，已知返回空）',
    url: 'https://music.163.com/api/song/detail?ids=%5B347230%5D',
    headers: NET_HEADERS,
    expect: r => Array.isArray(r?.songs) && r.songs.length > 0
  },
  {
    id: 'official.song.url',
    group: '官方',
    desc: '歌曲播放地址（已知受限）',
    url: 'https://music.163.com/api/song/enhance/player/url?id=347230&ids=%5B347230%5D&br=320000',
    headers: NET_HEADERS,
    expect: r => typeof r?.data?.[0]?.url === 'string' && r.data[0].url.length > 0
  },
  {
    id: 'official.song.outerUrl',
    group: '官方',
    desc: '歌曲外链（已知 302→404）',
    url: 'https://music.163.com/song/media/outer/url?id=347230.mp3',
    headers: { 'User-Agent': UA },
    method: 'HEAD',
    expect: (r, res) => res.status === 200
  },

  /* ---------------- 第三方镜像 ---------------- */
  {
    id: 'gdstudio.url',
    group: '镜像',
    desc: '取播放地址（默认，常为 flac）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=url&id=347230&source=netease',
    expect: r => typeof r?.url === 'string' && r.url.length > 0
  },
  {
    id: 'gdstudio.url.mp3',
    group: '镜像',
    desc: '取播放地址 br=320（mp3）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=url&id=347230&source=netease&br=320',
    expect: r => typeof r?.url === 'string' && r.url.length > 0
  },
  {
    id: 'gdstudio.url.missing',
    group: '镜像',
    desc: '取播放地址（无版权曲目，返回空 url）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=url&id=186016&source=netease&br=128',
    expect: () => true
  },
  {
    id: 'gdstudio.search',
    group: '镜像',
    desc: '搜索（含 pic_id）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=search&name=%E5%91%A8%E6%9D%B0%E4%BC%A6&source=netease&pages=1&count=3',
    expect: r => Array.isArray(r) && r.length > 0
  },
  {
    id: 'gdstudio.playlist',
    group: '镜像',
    desc: '歌单详情（返回网易云老结构，可能超时）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=playlist&id=3778678&source=netease',
    timeout: 20_000,
    expect: r => Array.isArray(r?.tracks) || Array.isArray(r?.playlist?.tracks)
  },
  {
    id: 'gdstudio.album',
    group: '镜像',
    desc: '专辑详情（types=album）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=album&id=32311&source=netease',
    timeout: 20_000,
    expect: r => Array.isArray(r?.songs) || Array.isArray(r)
  },
  {
    id: 'gdstudio.artist',
    group: '镜像',
    desc: '歌手详情（types=artist）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=artist&id=6452&source=netease',
    timeout: 20_000,
    expect: r => !!r && typeof r === 'object'
  },
  {
    id: 'gdstudio.lyric',
    group: '镜像',
    desc: '歌词（备用）',
    url: 'https://music-api.gdstudio.xyz/api.php?types=lyric&id=347230&source=netease',
    expect: r => typeof r?.lyric === 'string' || typeof r === 'string'
  },
  {
    id: 'meting.pic',
    group: '镜像',
    desc: 'Metin 封面接口（picId → 真实图片，302）',
    url: 'https://api.injahow.cn/meting/?type=pic&server=netease&id=109951169724216323',
    expect: () => true
  },
  {
    id: 'meting.url',
    group: '镜像',
    desc: 'api.injahow.cn Meting 播放地址（302 跳转）',
    url: 'https://api.injahow.cn/meting/?type=url&id=347230&server=netease&br=320',
    expect: () => true
  },
  {
    id: 'meting.playlist',
    group: '镜像',
    desc: 'api.injahow.cn Meting 歌单',
    url: 'https://api.injahow.cn/meting/?type=playlist&id=3778678&server=netease',
    expect: r => Array.isArray(r)
  },
  {
    id: 'vkeys.netease',
    group: '镜像',
    desc: 'api.vkeys.cn 网易云接口',
    url: 'https://api.vkeys.cn/v2/music/netease?id=347230',
    expect: r => !!r
  },
  {
    id: 'kxzjoker.playlist',
    group: '镜像',
    desc: 'api.kxzjoker.cn 网易云歌单',
    url: 'https://api.kxzjoker.cn/api/163_playlist?id=3778678',
    expect: r => !!r
  },

  /* ---------------- 资源 ---------------- */
  {
    id: 'cover.param',
    group: '资源',
    desc: '封面（真实 picUrl + ?param=300y300，实测 200 image/jpg）',
    url: 'https://p2.music.126.net/Pzxy6py26NgNmhJjYMf2RQ==/109951169724216323.jpg?param=300y300',
    method: 'HEAD',
    expect: (_r, res) => res.status === 200
  }
]

/* ------------------------------ 探测核心 ------------------------------ */

function withTimeout(ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(t) }
}

async function probe(c) {
  const started = Date.now()
  const t = withTimeout(c.timeout ?? TIMEOUT_MS)
  const out = {
    id: c.id,
    group: c.group,
    desc: c.desc,
    url: c.url,
    method: c.method ?? 'GET',
    status: 0,
    ms: 0,
    ok: false,
    error: null,
    contentType: '',
    size: 0,
    shape: null,
    sample: null
  }
  try {
    const res = await fetch(c.url, {
      method: c.method ?? 'GET',
      headers: c.headers ?? { 'User-Agent': UA },
      signal: t.signal,
      redirect: 'manual'
    })
    out.status = res.status
    out.contentType = res.headers.get('content-type') ?? ''
    out.location = res.headers.get('location') ?? null
    let body = null
    if ((c.method ?? 'GET') !== 'HEAD') {
      const text = await res.text()
      out.size = text.length
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    out.shape = describe(body)
    out.sample = sampleOf(body)
    out.ok =
      res.status >= 200 &&
      res.status < 400 &&
      (typeof c.expect === 'function' ? !!safe(() => c.expect(body, res)) : true)
    if (body && body.error) out.error = String(body.error).slice(0, 120)
  } catch (err) {
    out.error = err?.name === 'AbortError' ? `timeout ${c.timeout ?? TIMEOUT_MS}ms` : String(err?.message ?? err)
  } finally {
    t.done()
    out.ms = Date.now() - started
  }
  return out
}

function safe(fn) {
  try {
    return fn()
  } catch {
    return false
  }
}

/** 描述返回结构：顶层键 + 嵌套关键键 */
function describe(body) {
  if (body == null) return { kind: 'empty' }
  if (typeof body === 'string') return { kind: 'text', head: body.slice(0, 80) }
  if (Array.isArray(body)) return { kind: 'array', length: body.length, itemKeys: keysOf(body[0]) }
  const d = { kind: 'object', keys: keysOf(body) }
  for (const k of ['result', 'playlist', 'album', 'artist', 'song', 'list', 'data', 'lrc', 'tlyric']) {
    const v = body[k]
    if (Array.isArray(v)) d[k] = { array: v.length, itemKeys: keysOf(v[0]) }
    else if (v && typeof v === 'object') d[k] = { keys: keysOf(v) }
  }
  return d
}

function keysOf(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).slice(0, 24) : []
}

/** 抽取几条关键字段做样本（避免输出过大） */
function sampleOf(body) {
  if (!body || typeof body !== 'object') return null
  const pick = (o, ks) => {
    if (!o || typeof o !== 'object') return null
    const r = {}
    for (const k of ks) if (o[k] !== undefined) r[k] = typeof o[k] === 'string' ? o[k].slice(0, 120) : o[k]
    return Object.keys(r).length ? r : null
  }
  const songPick = o => pick(o, ['id', 'name', 'duration', 'dt', 'fee', 'picUrl'])
  const first = x => (Array.isArray(x) ? x[0] : null)

  const s = first(body?.result?.songs) ?? first(body?.songs) ?? first(body?.hotSongs)
  if (s) {
    const sample = songPick(s)
    const album = s.album ?? s.al
    if (album) sample.album = pick(album, ['id', 'name', 'picUrl', 'picId', 'pic'])
    const artists = s.artists ?? s.ar
    if (Array.isArray(artists)) sample.artists = artists.slice(0, 2).map(a => ({ id: a.id, name: a.name }))
    return sample
  }
  if (body?.result?.tracks) {
    const sample = songPick(first(body.result.tracks))
    if (sample) sample.album = pick(first(body.result.tracks).album, ['id', 'name', 'picUrl'])
    return sample
  }
  if (body?.lrc) return { lrcLen: body.lrc.lyric?.length ?? 0, tlyricLen: body.tlyric?.lyric?.length ?? 0 }
  if (Array.isArray(body)) return pick(first(body), ['id', 'name', 'artist', 'album', 'pic_id', 'url_id', 'picUrl'])
  if (body.url !== undefined) return pick(body, ['url', 'br', 'size', 'from'])
  if (Array.isArray(body.list)) return pick(first(body.list), ['id', 'name', 'coverImgUrl', 'trackCount'])
  if (Array.isArray(body.result)) return pick(first(body.result), ['id', 'name', 'picUrl'])
  return null
}



/* ------------------------------ 输出 ------------------------------ */

function mdTable(rows) {
  const head = '| 源 | 用途 | 端点 | HTTP | 耗时 | 结论 | 备注 |\n|---|---|---|---|---|---|---|'
  const body = rows
    .map(r => {
      const ok = r.ok ? '✅ 可用' : '❌ 不可用'
      const note = r.error ? r.error.replace(/\|/g, '/') : r.location ? `redirect → ${String(r.location).slice(0, 40)}…` : ''
      return `| ${r.group} | ${r.desc} | \`${shortUrl(r.url)}\` | ${r.status || '-'} | ${r.ms}ms | ${ok} | ${note} |`
    })
    .join('\n')
  return `${head}\n${body}`
}

function shortUrl(u) {
  const s = String(u)
  return s.length > 96 ? s.slice(0, 93) + '…' : s
}

async function main() {
  const args = process.argv.slice(2)
  console.log(`\n🔎 探测 ${CASES.length} 个数据源…\n`)
  const results = []
  for (const c of CASES) {
    const r = await probe(c)
    results.push(r)
    const mark = r.ok ? '✅' : '❌'
    console.log(`${mark} [${String(r.status).padStart(3)}] ${String(r.ms).padStart(5)}ms  ${r.group}/${r.desc}${r.error ? '  ← ' + r.error : ''}`)
  }

  const urlRows = results.filter(r => r.id.startsWith('gdstudio.url'))
  const workingUrlSource = urlRows.find(r => r.ok && r.sample?.url)?.id ?? null
  const summary = {
    probedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter(r => r.ok).length,
    workingUrlSource,
    results
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log('\n' + mdTable(results) + '\n')
  console.log(`播放地址可用源：${workingUrlSource ?? '无'}\n`)

  if (args.includes('--update')) {
    const path = resolve(ROOT, 'docs/api-notes.md')
    let md = ''
    try {
      md = await readFile(path, 'utf8')
    } catch {
      md = '# NetEase API 实测笔记\n\n'
    }
    const block = `<!-- AUTO-PROBE:START -->\n_最后探测：${summary.probedAt}（${summary.ok}/${summary.total} 可用）_\n\n${mdTable(
      results
    )}\n\n<!-- AUTO-PROBE:END -->`
    const re = /<!-- AUTO-PROBE:START -->[\s\S]*<!-- AUTO-PROBE:END -->/
    md = re.test(md) ? md.replace(re, block) : md + '\n\n' + block + '\n'
    await writeFile(path, md, 'utf8')
    console.log(`已更新 ${path}`)
  }
}

main().catch(err => {
  console.error('probe 失败：', err)
  process.exitCode = 1
})
