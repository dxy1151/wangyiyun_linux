# 播放引擎契约（docs/player-contract.md）

> 维护者：dataplayer（T4）｜消费者：T3 UI
> 唯一事实来源：`src/renderer/src/store/player.ts`
> 冒烟测试：`node scripts/test-player.mjs`

---

## 0. 快速上手

```tsx
import { usePlayer, usePlayerStore, initPlayer } from '@/store/player'

// 1) App 挂载时初始化一次（恢复上次队列、后台探测音源、绑定媒体键/MPRIS 命令）
useEffect(() => { initPlayer() }, [])

// 2) 组件里订阅状态
const { current, isPlaying, progress, duration, lyrics, lyricIndex, networkBanner } = usePlayer()

// 3) 命令式调用 actions（组件内外都可以）
usePlayerStore.getState().playQueue(songs, 0)
usePlayerStore.getState().toggle()
```

- 本模块**不依赖 Electron**：`window.nt`、`navigator.mediaSession`、`indexedDB`、`localStorage` 全部做存在性判断，纯浏览器 / node 环境导入不会崩。
- **任何 action 都不会抛异常**；取不到音源时进入"演示模式"并在 `networkBanner` 给出文案。

---

## 1. 导出一览

| 导出 | 类型 | 说明 |
|---|---|---|
| `usePlayerStore` | `UseBoundStore<StoreApi<PlayerStore>>` | zustand store，含 state + actions，可用 `.getState()` / `.setState()` / `.subscribe()` |
| `usePlayer()` | `() => PlayerState` | **UI 主入口**，返回整份播放状态（见 §2） |
| `usePlayerSelector(sel, equals?)` | `(s) => T` | 细粒度订阅，减少 4Hz 进度带来的重渲染 |
| `usePlayerActions()` | `() => PlayerActions` | 返回 actions 集合（引用稳定，字段运行期转发到最新 state） |
| `initPlayer()` | `() => void` | 幂等初始化，App 挂载调用一次 |
| `bindMainProcessCommands()` | `() => void` | 订阅主进程 `onMprisCmd` / `onTrayAction`（`initPlayer` 已调用） |
| `setCacheLimitMB(mb)` | `(number) => void` | 音频缓存上限（默认 512MB，范围 64~8192） |
| `audioCacheStats()` | `() => Promise<{count,bytes}>` | 已缓存曲目数与字节数（设置页展示） |
| `clearAudioCache()` | `() => Promise<void>` | 清空 IndexedDB 音频缓存 |
| `PLAY_MODE_LABEL` | `Record<PlayMode,string>` | 四种模式的文案（顺序播放/单曲循环/随机播放/列表循环） |
| `savePlaybackPosition()` | `() => void` | 立即把音量/模式/队列写入 localStorage |
| 便捷 hook | — | `useCurrentSong` `useIsPlaying` `useProgress` `useLyrics` `useLyricIndex` `useNetworkBanner` `usePlayMode` `useVolume` `useQueue` `useFavorites` `useRecent` |

类型：`PlayerState`、`PlayerActions`、`PlayerStore`、`PlayMode`、`BannerLevel`、`LyricLine`（来自 `@/api/types`）。

---

## 2. `usePlayer()` 返回的状态字段

```ts
interface PlayerState {
  current: Song | null        // 当前歌曲
  currentIndex: number        // 在 queue 中的下标，-1 表示无
  queue: Song[]               // 播放队列（可能被 shuffle 打乱顺序）
  order: number[]             // 原始顺序索引表（随机模式的稳定基准，UI 一般不用）
  isPlaying: boolean
  isBuffering: boolean        // 正在解析直链 / 缓冲（UI 可显示 loading 态）
  progress: number            // 毫秒，4Hz 更新
  duration: number            // 毫秒（audio.duration 优先，回退 Song.duration）
  volume: number              // 0 ~ 1（持久化）
  muted: boolean              // 静音（持久化）
  mode: PlayMode              // 'order' | 'repeat-one' | 'shuffle' | 'loop'（持久化）

  lyrics: LyricLine[]         // 已解析逐行歌词，无歌词为 []；LyricLine = { time: ms, text, translation? }
  lyricsRaw: string           // 原始 LRC 文本（需自行解析时用）
  lyricIndex: number          // 当前高亮行下标，-1 表示无

  favorites: Song[]           // 我喜欢的音乐（localStorage 持久化，最多 2000）
  recent: Song[]              // 最近播放（自动记录，最多 100）

  networkBanner: string | null   // 顶部提示文案，null = 正常
  bannerLevel: 'info' | 'warn' | 'error'
  demoMode: boolean           // 是否处于"演示模式"（无法获取音频流）
  audioSource: string         // 当前音源名，如 'gdstudio' / 'injahow-meting'

  // 以下为 actions（zustand 里 state 与 actions 同在一棵树中）
  playQueue, playTrack, toggle, play, pause, next, prev, seek, seekBy,
  setVolume, toggleMute, setMode, cycleMode,
  addNext, addToQueue, removeFromQueue, clearQueue, setQueue,
  toggleFavorite, isFavorite, addRecent,
  dismissBanner, setNetworkBanner, setQuality, quality, retryCurrent, dispose
}
```

> `usePlayer()` 是 zustand selector 版（`usePlayerStore(s => s)`），**progress 每 250ms 变一次会让组件每 250ms 重渲染**。大列表建议改用 `usePlayerSelector(s => s.current?.id)` 之类。

---

## 3. Actions（UI 可直接调用）

### 3.1 播放控制

| 方法 | 签名 | 行为 |
|---|---|---|
| `playQueue` | `(list: Song[], index = 0) => void` | **列表双击播放的标准入口**：设置整条队列并播放第 index 首。空列表 = 清空队列 |
| `playTrack` | `(song: Song, queue?: Song[]) => void` | 传 queue 时在其中定位 song 后播放；不传时若 song 已在队列中则跳到它，否则**用单曲替换整个队列** |
| `toggle` | `() => void` | 播放/暂停切换 |
| `play` / `pause` | `() => void` | 显式播放/暂停；`play()` 在无 src 时会按 `progress` 续播 |
| `next()` | `(auto?: boolean) => void` | 下一首。`auto=true` 表示"播完自动切"（单曲循环会重播当前曲），UI 按钮调用请**不传参** |
| `prev()` | `() => void` | 上一首；若 `progress > 3000ms` 则先回到本曲开头 |
| `seek` | `(ms: number) => void` | 跳转（自动 clamp 到 `[0, duration]`，负数/NaN 安全） |
| `seekBy` | `(deltaMs: number) => void` | 相对跳转（快进/快退 10s） |
| `setVolume` | `(v: number) => void` | 0~1，会自动 clamp；> 0 时自动解除静音 |
| `toggleMute` | `() => void` | 静音切换 |
| `setMode` | `(m: PlayMode) => void` | 设置模式并持久化 |
| `cycleMode` | `() => void` | 循环切换：loop → repeat-one → shuffle → order |

**播放模式语义**

| mode | 播完自动 | 手动 next |
|---|---|---|
| `order` 顺序播放 | 下一首；**最后一首播完停止** | 循环到第一首 |
| `loop` 列表循环（默认） | 下一首，末尾回到第一首 | 同左 |
| `repeat-one` 单曲循环 | **重播当前曲** | 切到下一首（尊重用户意图） |
| `shuffle` 随机播放 | 随机到另一首（保留回退历史） | 随机；`prev` 优先回退历史 |

### 3.2 队列管理

| 方法 | 签名 | 说明 |
|---|---|---|
| `addNext` | `(song: Song) => void` | 插入到当前曲之后（"下一首播放"）；队列为空时等同于开始播放它 |
| `addToQueue` | `(song: Song) => void` | 追加到队尾 |
| `removeFromQueue` | `(index: number) => void` | 移除指定项；移除当前曲则自动播放同位置下一首；越界安全 |
| `clearQueue` | `() => void` | 清空队列并停止播放 |
| `setQueue` | `(list: Song[]) => void` | 只替换队列，不改变当前播放 |

### 3.3 个人库

| 方法 | 签名 | 说明 |
|---|---|---|
| `toggleFavorite` | `(song: Song) => void` | 收藏/取消收藏，写入 `favorites` + localStorage，并设置一次提示文案 |
| `isFavorite` | `(id: number) => boolean` | 是否已收藏 |
| `addRecent` | `(song: Song) => void` | 手动记入最近播放（播放时会自动记，一般不用调） |

### 3.4 其它

| 方法 | 签名 | 说明 |
|---|---|---|
| `retryCurrent` | `() => Promise<void>` | 强制重新探测音源并重试当前曲（"演示模式"横幅上的"重试"按钮） |
| `setQuality` | `(br: 128\|192\|320) => void` | 切换码率并重载当前曲（skipCache） |
| `quality()` | `() => number` | 当前码率 |
| `dismissBanner` | `() => void` | 关闭顶部提示 |
| `setNetworkBanner` | `(msg: string \| null, level?) => void` | 手动设置提示 |
| `dispose` | `() => void` | 销毁音频元素与定时器（测试/热重载） |

---

## 4. 数据模型（`@/api/types`）

```ts
interface Song {
  id: number
  name: string
  artists: { id: number; name: string }[]
  album: { id: number; name: string; picUrl: string }
  duration: number      // 毫秒
  fee: number
  picUrl: string        // = album.picUrl，便于列表直接用（可能为空串）
  picId?: number
  alia?: string[]
  albumName?: string
  artistText?: string   // 'A / B'，直接渲染歌手列
  cached?: boolean      // 已缓存到 IndexedDB（可在列表标"已缓存"）
}

interface LyricLine { time: number /*ms*/; text: string; translation?: string }
```

---

## 5. 降级与异常行为（UI 必读）

| 场景 | 引擎行为 | UI 建议 |
|---|---|---|
| 全部音源不可用 | `networkBanner = "当前网络无法获取音频流，已进入演示模式"`，`demoMode = true`，自动跳过若干首后停止 | 顶部条展示 `networkBanner`，提供"重试"→ `retryCurrent()` |
| 单曲无版权/下架 | `networkBanner = "该曲目暂无可用音源，已跳过"`，自动跳下一首 | 常规提示即可 |
| 直链失效（20s 后过期） | `audio error` → 重新解析一次 → 仍失败自动跳过 | 无需处理 |
| 自动播放被浏览器策略拦截 | `isPlaying=false`，不抛错（Electron 里不会发生） | — |
| 无 `window.nt`（浏览器调试） | MPRIS/托盘/媒体键推送静默跳过，`mediaSession` 兜底 | — |
| 无 IndexedDB | 跳过音频缓存，不影响播放 | — |
| 播放时 `current` 与 `currentIndex` | **始终同步更新**（自动跳过做了延后处理避免中间态） | 可直接用 `queue[currentIndex]` |

- `networkBanner` 是 **`string | null`**，不是对象；`bannerLevel` 提供配色级别。
- 收藏/取消收藏会设置一条 `info` 级 banner（UI 若觉得吵可用 toast 替代并 `dismissBanner()`）。

---

## 6. 系统集成（引擎内部完成，UI 不用管）

| 能力 | 实现 |
|---|---|
| MPRIS | `window.nt.mprisUpdate({playbackStatus,title,artist,album,artUrl,position,duration,volume,canGoNext,...})`，切换/播放/暂停/音量/进度变化时推送（节流 900ms） |
| 托盘进度 | `window.nt.setTrayProgress(0~1 \| null)`（节流 1s） |
| 托盘/Mpris 反向命令 | `nt.onMprisCmd({action:'play-pause'\|'next'\|'prev'\|'seek-to'\|'volume', value})`、`nt.onTrayAction(a)` |
| 媒体键 | `nt.onMediaKey(k)` + `navigator.mediaSession` action handlers（play/pause/next/prev/seekto/seek±10s） |
| 系统媒体控件 | `MediaMetadata({title,artist,album,artwork})` |
| 持久化 | localStorage `nt.player`（队列≤200 首、currentIndex、volume、muted、mode）、`nt.favorites`、`nt.recent` |
| 音频缓存 | IndexedDB `nt-audio-cache`（store: `audio` blob + `meta`），上限 `setCacheLimitMB()`，二次播放直接读 blob（当前曲 `Song.cached=true`） |

---

## 7. 初始化与恢复

`initPlayer()` 做四件事（幂等）：

1. 创建 `HTMLAudioElement` 单实例并启动 4Hz 进度定时器。
2. 恢复上次队列 + `currentIndex`（**不自动播放**，避免启动即出声），懒加载当前曲歌词。
3. 后台 `mirror.probeProviders()`（缓存 10 分钟）；全部失败 → `networkBanner` + `demoMode`。
4. 订阅 `window.nt` 的 MPRIS/托盘命令、`online`/`offline` 事件（断网提示、恢复后重新探测）。

---

## 8. 已知限制

- `progress` 用 4Hz 定时器 + `timeupdate` 兜底；后台节流环境下高频组件可能抖动，建议用 `usePlayerSelector`。
- 随机模式回退历史上限 200 条。
- `.flac` 直链（gdstudio 不带 br 时）在部分环境解码慢，代码默认请求 320k mp3；用户可在设置页调 `setQuality`。
- 播放进度不跨重启恢复（只恢复队列与当前曲位置为 0），避免"启动即中途播放"的困惑。
