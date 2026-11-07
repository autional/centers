import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 构建产物按依赖域拆包（首屏只加载自身代码 + React，antd/vendor 走独立 chunk 缓存）。
 * 目的：单包 ~1.8 MB → 首屏可并行/缓存；不改任何运行时代码。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/antd/') || id.includes('@ant-design') || id.includes('/rc-')) return 'antd';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
