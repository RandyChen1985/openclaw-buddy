import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
/** 入口统一引入 xterm 样式：避免 lazy chunk + 子路径 base 下 CSS preload 指向 /assets/... 导致加载失败 */
import 'xterm/css/xterm.css'
import './i18n'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
