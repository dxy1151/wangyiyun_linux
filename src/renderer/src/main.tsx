import ReactDOM from 'react-dom/client'
import App from './App'

// 样式入口：设计令牌 → 全局重置 → 应用外壳
import './styles/theme.css'
import './styles/global.css'

/**
 * 说明：不使用 StrictMode。
 * 播放引擎（store/player.ts 的 initPlayer）与 audio 元素在开发模式下
 * 会被 StrictMode 的 effect 双调用执行两次，导致音频重复初始化，因此这里直接挂载。
 */
const container = document.getElementById('root')
if (container) {
  ReactDOM.createRoot(container).render(<App />)
}
