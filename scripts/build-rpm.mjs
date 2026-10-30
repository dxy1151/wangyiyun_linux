#!/usr/bin/env node
/**
 * RPM 打包入口（npm run dist:rpm）
 *
 * 为什么不用 rpmbuild：
 *   - Debian/Ubuntu 上 rpmbuild 需要一串原生依赖（librpm_sequoia 等），
 *     在无 root 的容器/CI 里通常装不上；
 *   - 打包只需要「把 rpm 结构写正确」，不需要 rpm 的构建生态。
 *   因此这里用纯 Python 实现（scripts/build-rpm.py），零系统依赖。
 *
 * 前置条件：先跑过 `npm run build`（需要 out/），且 electron-builder 已产出
 *          release/linux-unpacked（由 `electron-builder --linux dir` 生成）。
 *          若未产出，本脚本会先调用 electron-builder 生成。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const unpackedDir = path.join(releaseDir, 'linux-unpacked')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败（exit ${r.status}）`)
  }
}

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

// 1) 确保有 linux-unpacked（electron-builder 的 dir 目标）
if (!exists(path.join(unpackedDir, 'netease-cloud-music'))) {
  console.log('[rpm] 未发现 release/linux-unpacked，先执行 electron-builder --linux dir ...')
  sh('npx', ['electron-builder', '--linux', 'dir'])
}

// 2) 版本号与架构
const version = pkg.version || '1.0.0'
const release = process.env.RPM_RELEASE || '1'
const arch = process.env.RPM_ARCH || 'x86_64'

const outName = `netease-cloud-music-${version}-${release}.${arch}.rpm`
const outPath = path.join(releaseDir, outName)

// 3) 附加文件：启动脚本 / desktop 入口 / 图标
const extras = [
  ['/usr/bin/netease-cloud-music', path.join(root, 'packaging', 'netease-cloud-music.sh')],
  ['/usr/share/applications/netease-cloud-music.desktop', path.join(root, 'packaging', 'netease-cloud-music.desktop')],
  ['/usr/share/icons/hicolor/512x512/apps/netease-cloud-music.png', path.join(root, 'build', 'icon.png')]
]
const extraArgs = []
for (const [dest, src] of extras) {
  if (exists(src)) extraArgs.push('--extra', `${dest}=${src}`)
  else console.warn(`[rpm] 跳过缺失的附加文件：${src}`)
}

// 4) 调用纯 Python 打包器
const pyArgs = [
  path.join(root, 'scripts', 'build-rpm.py'),
  '--srcdir',
  unpackedDir,
  '--name',
  'netease-cloud-music',
  '--version',
  version,
  '--release',
  release,
  '--arch',
  arch,
  '--summary',
  '网易云音乐 Linux 客户端（非官方）',
  '--description',
  pkg.description || 'NetEase Cloud Music client for Linux',
  '--license',
  pkg.license || 'MIT',
  '--url',
  pkg.homepage || 'https://github.com/dxy1151/wangyiyun_linux',
  '--out',
  outPath,
  ...extraArgs
]

const python = process.env.PYTHON || 'python3'
console.log(`[rpm] 正在打包：${outName}`)
sh(python, pyArgs)

if (!exists(outPath)) {
  console.error('[rpm] 打包失败：产物不存在')
  process.exit(1)
}

console.log(`[rpm] 完成：${path.relative(root, outPath)}（${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MiB）`)
console.log('[rpm] 安装：sudo rpm -ivh <包名>.rpm   或   sudo dnf install ./<包名>.rpm')
