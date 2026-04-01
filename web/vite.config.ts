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
  };
})
