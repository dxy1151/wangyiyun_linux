# 网易云音乐 Linux 桌面客户端

非官方 NetEase Cloud Music Linux 客户端：**Electron 33 + Vite 5 + React 18 + TypeScript 5**。
无边框深色界面、迷你播放器、托盘、MPRIS/D-Bus 控制、全局媒体键、下载与本地缓存。

> 项目目录：`/home/don0ox1/deepseek/netease-cloud-music-linux`

---

## 快速开始

```bash
npm install          # 首次安装（会下载 Electron 二进制）
npm run dev          # 开发模式（HMR）
npm run build        # 类型检查 + 构建到 out/
npm start            # 预览已构建产物（electron-vite preview）
npm run dist         # 打包 AppImage + deb 到 release/
```

如果 Electron 二进制下载失败：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm i electron -D
npx electron --version
```

无显示器环境启动验证：

```bash
DISPLAY=:0 timeout 20 npx electron out/main/index.js
# 或：xvfb-run -a timeout 20 npx electron out/main/index.js --no-sandbox
```

---

## 目录结构

```
netease-cloud-music-linux/
├─ electron.vite.config.ts     # 三端构建配置（main / preload / renderer）
├─ tsconfig.node.json          # main + preload + shared（types: node）
├─ tsconfig.web.json           # renderer（DOM + react-jsx）
├─ build/icon.png              # 512x512 应用图标（scripts/gen-icon.mjs 程序化生成）
├─ scripts/gen-icon.mjs        # 图标生成脚本（node scripts/gen-icon.mjs [size] [out]）
├─ src/
│  ├─ main/index.ts            # 主进程：窗口 / 托盘 / IPC 骨架（T2 完善）
│  ├─ preload/
│  │  ├─ index.ts              # contextBridge 暴露 window.nt
│  │  └─ index.d.ts            # NtApi 类型 + declare global Window
│  ├─ shared/
│  │  ├─ ipc.ts                # 所有通道名常量（IPC / IPC_EVENT）
│  │  └─ types.ts              # Settings / WindowMode / DownloadProgress 等跨端类型
│  └─ renderer/
│     ├─ index.html
│     └─ src/                  # React 应用（main.tsx / App.tsx / components / pages / store / api / hooks / styles）
└─ out/                        # 构建产物 main·preload·renderer（不提交）
```

### 路径别名

| 别名 | 指向 | 可用范围 |
| --- | --- | --- |
| `@shared` | `src/shared` | main / preload / renderer |
| `@` | `src/renderer/src` | renderer（main/preload 中 `@` = `src/shared`，请勿在 main 里用 `@`） |

renderer 中写 `import type { Settings } from '@shared/types'`、`import { IPC } from '@shared/ipc'`。

---

## 接口契约（重要：渲染层与主进程的唯一约定）

### 1. `window.nt` —— 渲染层唯一原生入口

由 `src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('nt', ...)` 暴露；
类型定义在 `src/preload/index.d.ts`（`NtApi`），renderer 已获得 `window.nt` 的全局类型。

```ts
interface NtApi {
  platform: 'linux';
  versions: { app: string; electron: string; chrome: string };
  setWindowMode(mode: 'normal' | 'mini'): void;
  onWindowMode(cb: (mode: 'normal' | 'mini') => void): () => void;
  onWindowState(cb: (s: { maximized: boolean }) => void): () => void;
  winAction(a: 'minimize' | 'maximize' | 'close'): void;
  winGetState(): Promise<{ maximized: boolean }>;
  getSettings(): Promise<Settings>;
  setSettings(p: Partial<Settings>): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  download(p: { id: string; url: string; filename: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
  cancelDownload(id: string): void;
  onDownloadProgress(cb: (p: { id: string; received: number; total: number }) => void): () => void;
  openExternal(url: string): void;
  onMediaKey(cb: (k: 'play-pause' | 'next' | 'prev' | 'stop') => void): () => void;
  setTrayTip(tip: string): void;
  setTrayProgress(v: number | null): void;
  mprisUpdate(s: MprisState): void;
  onMprisCmd(cb: (c: { action: 'play-pause' | 'next' | 'prev' | 'seek-to' | 'volume'; value?: number }) => void): () => void;
  onTrayAction(cb: (a: 'play-pause' | 'next' | 'prev' | 'show' | 'quit') => void): () => void;
  onDeepLink(cb: (url: string) => void): () => void;
  clearCache?(): Promise<void>;
}
```

约定：

- **所有 `onXxx(cb)` 返回取消订阅函数**，`useEffect` 里务必 `return off`。
- 所有方法都是**同步注册、异步结果**；`getSettings / setSettings / pickFolder / download / clearCache` 走 `ipcRenderer.invoke`。
- 渲染层没有 Node 能力（`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`），一切原生能力必须经 `window.nt`。

### 2. `Settings`（`src/shared/types.ts`）

```ts
interface Settings {
  theme: 'dark' | 'light'
  volume: number                       // 0 ~ 1
  playMode: 'order' | 'repeat-one' | 'shuffle' | 'loop'
  downloadDir: string                  // 默认 app.getPath('music')
  closeToTray: boolean
  cacheLimitMB: number
}
```

默认值见 `DEFAULT_SETTINGS`。持久化位置：`app.getPath('userData')/settings.json`（`readSettings()` / `writeSettings(patch)` 已实现，T2 可直接复用）。

### 3. IPC 通道（`src/shared/ipc.ts`）

renderer → main：

| 常量 | 通道 | 方向/类型 | 说明 |
| --- | --- | --- | --- |
| `IPC.WIN_SET_MODE` | `win:set-mode` | send `('normal' \| 'mini')` | 切换普通/迷你窗口 |
| `IPC.WIN_ACTION` | `win:action` | send `('minimize' \| 'maximize' \| 'close')` | 无边框标题栏按钮 |
| `IPC.WIN_GET_STATE` | `win:state` | invoke → `{maximized}` | 查询窗口状态 |
| `IPC.SETTINGS_GET` | `settings:get` | invoke → `Settings` | 读取设置（含默认值合并） |
| `IPC.SETTINGS_SET` | `settings:set` | invoke `Partial<Settings>` → `Settings` | 局部更新并回写文件 |
| `IPC.DIALOG_PICK_FOLDER` | `dialog:pick-folder` | invoke → `string \| null` | 选择下载目录 |
| `IPC.DOWNLOAD_SAVE` | `download:save` | invoke `{id,url,filename}` → `{ok,path?,error?}` | 下载到本地（**T2 待实现**） |
| `IPC.DOWNLOAD_CANCEL` | `download:cancel` | send `(id)` | 取消下载（**T2 待实现**） |
| `IPC.SHELL_OPEN` | `shell:open` | send `(url)` | 系统浏览器打开外链 |
| `IPC.TRAY_PROGRESS` | `tray:progress` | send `(number \| null)` | 托盘/任务栏进度，null 清除 |
| `IPC.TRAY_TIP` | `tray:tip` | send `(tip)` | 托盘 tooltip |
| `IPC.MPRIS_UPDATE` | `mpris:update` | send `(MprisState)` | 播放状态同步到 D-Bus（**T2 待实现**） |
| `IPC.CACHE_CLEAR` | `cache:clear` | invoke → `void` | 清理 session 缓存 |

main → renderer（`webContents.send`）：

| 常量 | 通道 | 载荷 |
| --- | --- | --- |
| `IPC_EVENT.WIN_STATE_CHANGED` | `win:state-changed` | `{ maximized: boolean }` |
| `IPC_EVENT.MEDIA_KEY` | `mediakey` | `'play-pause' \| 'next' \| 'prev' \| 'stop'` |
| `IPC_EVENT.TRAY_ACTION` | `tray:action` | `'play-pause' \| 'next' \| 'prev' \| 'show' \| 'quit'` |
| `IPC_EVENT.WINDOW_MODE` | `window-mode` | `'normal' \| 'mini'` |
| `IPC_EVENT.DOWNLOAD_PROGRESS` | `download:progress` | `{ id, received, total }` |
| `IPC_EVENT.MPRIS_CMD` | `mpris:cmd` | `{ action, value? }` |
| `IPC_EVENT.DEEP_LINK` | `deeplink` | `string` |

### 4. 主进程骨架（`src/main/index.ts`）现状

已实现：1200×820 无边框窗口（`frame:false`、`backgroundColor:'#121212'`）、`contextIsolation:true`/`nodeIntegration:false`/`sandbox:false`、
最大化状态广播、`win:*` / `settings:*` / `dialog:pick-folder` / `shell:open` / `tray:*` / `cache:clear` handler、
JSON 文件设置持久化、托盘（悬停切换显示）、全局媒体键（`globalShortcut`，Wayland 可能不生效）、关闭到托盘、单实例锁。

**占位待 T2 实现**：`download:save`（当前返回 `{ok:false}`）、`download:cancel`、`download:progress` 推送、
`mpris:update` / `mpris:cmd`（`mpris-service`）、`deeplink`、迷你窗口细节样式。

### 5. 打包配置（electron-builder，见 package.json `build` 字段）

`appId: com.don0ox1.neteasemusic`，Linux target `AppImage` + `deb`，`category: AudioVideo`，
`maintainer: don0ox1`，`executableName: netease-cloud-music`，
desktop 文件 `StartupWMClass=NeteaseCloudMusic`（与主进程 `app.setName('NeteaseCloudMusic')` 对齐，保证任务栏图标归组）。

---

## 环境备注（本机）

- Node v22.22.1 / npm 9.2.0，npm registry 使用 npmmirror；Electron 版本 **33.4.11**（已安装并验证 `electron --version`）。
- 本机 `~/.npm`、`~/.cache` 为**只读挂载**（EROFS），因此：
  - 项目 `.npmrc` 把 npm 缓存指向 `./.cache/npm`；
  - 环境变量里的 `npm_config_cache=~/.npm` 优先级高于项目 `.npmrc`，执行安装请用
    `env -u npm_config_cache -u npm_config_local_prefix npm install`；
  - Electron 二进制下载需要可写缓存：`ELECTRON_CACHE=$PWD/.cache/electron ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，
    然后 `cd node_modules/electron && node install.js`；
  - 已移除 `postinstall: electron-builder install-app-deps`（`abstract-socket` 的 node-gyp 重建需要写 `~/.electron-gyp`，会失败）。
    如需原生 rebuild 手动执行 `npm run rebuild`。
- **无边框/创建窗口的启动限制（重要，非代码问题）**：本机 `DISPLAY=:0` 是真实 X 会话，但本 agent 沙箱内进程无法建 GUI 窗口——
  Electron 进程打印完脚本第一行（`require('electron')` 之后 `app.whenReady()` **未触发**）即以 `SIGTRAP` 退出，
  纯 Electron 最小窗口程序同样复现（Electron 33/35 均如此），且无 `Xvfb`、无 `bwrap` 命名空间、无法 sudo。
  结论：**构建产物无需显示器即可验证（`npm run build`）**；GUI 冒烟测试请在正常桌面终端里执行：
  ```bash
  cd /home/don0ox1/deepseek/netease-cloud-music-linux
  DISPLAY=:0 timeout 20 npx electron out/main/index.js --no-sandbox
  ```
  （`--no-sandbox` 仅因本机 `chrome-sandbox` 属主/位处理不当；应用本身未开启 `sandbox: true`。）
- `mpris-service` 已加入依赖；若安装或运行失败，T2 应降级为「无 MPRIS」并在此记录。
- 未开启 `sandbox: true`（preload 需要 `require`），但保持 `contextIsolation: true`。
