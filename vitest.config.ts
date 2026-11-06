import { defineConfig } from 'vitest/config';

/**
 * Vitest 配置：只跑 `src/**\/*.test.ts` 的纯逻辑单测（lib/ 下的 transfer/model）。
 *
 * 环境用 `node`：被测模块不触碰 DOM（downloadText 之类只在 UI 里调用），
 * 因此不需要 jsdom；同时也避免为纯函数测试引入额外环境依赖。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: 'default',
  },
});
