/**
 * 冒烟测试：在 Electron 主进程内运行 out/main/index.js，等待窗口创建 + 渲染完成，然后退出。
 * 用于无显示器的沙箱/CI 中验证「主进程能起、preload 能注入、renderer 能加载」。
 *
 * 用法：  npx electron scripts/smoke.mjs --no-sandbox
 * 产物：  out/main/index.js out/preload/index.js out/renderer/index.html
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 25000)

// 沙箱/CI 默认不建真实 X 窗口（离屏合成），避免依赖桌面会话
if (!process.env.SMOKE_SHOW) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('headless')
  app.commandLine.appendSwitch('disable-gpu')
}

const fail = (msg) => {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exitCode = 1
  app.quit()
}

setTimeout(() => fail(`timeout after ${timeoutMs}ms (window never finished loading)`), timeoutMs).unref()

try {
  const url = pathToFileURL(join(root, 'out/main/index.js')).href
  await import(url)
} catch (err) {
  fail(`failed to load out/main/index.js: ${err?.stack ?? err}`)
}

app.whenReady().then(async () => {
  const win = await new Promise((resolve) => {
    const tick = () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) resolve(w)
      else setTimeout(tick, 50)
    }
    tick()
  })
  if (!win) return fail('no BrowserWindow created')

  const check = async () => {
    try {
      const info = await win.webContents.executeJavaScript(
        `({
           nt: typeof window.nt,
           methods: window.nt ? Object.keys(window.nt).length : 0,
           title: document.title,
           rootHtml: (document.getElementById('root')?.innerHTML || '').length
         })`
      )
      const ok = info.nt === 'object' && info.methods > 0 && info.rootHtml > 0
      console.log('[smoke] renderer:', JSON.stringify(info))
      if (!ok) return fail('preload 或 renderer 未就绪')
      console.log('[smoke] PASS: main + preload + renderer OK')
      app.quit()
    } catch (err) {
      fail(`executeJavaScript failed: ${err?.message ?? err}`)
    }
  }

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', check)
  else check()
})
