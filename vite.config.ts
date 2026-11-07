import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 2026-11-07 回滚按依赖拆包：manualChunks 把 antd / rc-* / react 拆成独立
 * chunk 后触发跨 chunk 循环初始化（线上 `antd-*.js` ReferenceError:
 * Cannot access 'Pd' before initialization → 整页白屏）。首屏优化另立方案，
 * 先恢复单包保证可用。
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
