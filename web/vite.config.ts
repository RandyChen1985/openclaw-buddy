import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let base = env.VITE_WEB_ROOT || '/';
  
  // Ensure base starts and ends with /
  if (!base.startsWith('/')) base = '/' + base;
  if (!base.endsWith('/')) base = base + '/';
  
  return {
    plugins: [react()],
    base: base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@codemirror') || id.includes('@uiw/react-codemirror')) return 'codemirror';
            if (id.includes('echarts')) return 'echarts';
            if (id.includes('mermaid')) return 'mermaid';
            if (id.includes('antd')) return 'antd';
            if (id.includes('xlsx') || id.includes('mammoth')) return 'office';
            if (id.includes('recharts')) return 'recharts';
            if (
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'react-vendor';
            }
            // 其余交给 Rollup 默认拆分，避免 vendor 巨型块与循环 chunk 引用
          },
        },
      },
    },
  };
})
