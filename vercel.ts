import { routes, type Rewrite, type VercelConfig } from '@vercel/config/v1';

/**
 * 配置中心（com / cn 双区）的 Vercel 配置。
 * `API_ORIGIN` 由 Vercel 项目环境变量注入：com = https://api.autional.com，cn = https://api.autional.cn。
 * 未设置时 **fail-closed**（避免静默把 cn 流量打到 com API）。
 */
const rawOrigin = process.env.API_ORIGIN;

if (!rawOrigin) {
  throw new Error('[config] 缺少环境变量 API_ORIGIN（Vercel 项目设置里配置后重新部署）');
}

const ORIGIN = rawOrigin.replace(/\/+$/, '');

const spaFallback: Rewrite = {
  source: '/(.*)',
  destination: '/index.html',
  has: [{ type: 'header', key: 'accept', value: { re: 'text/html' } }],
};

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'pnpm install --frozen-lockfile',
  buildCommand: 'pnpm --filter @autional/config-console build',
  outputDirectory: 'apps/config-console/dist',
  rewrites: [
    routes.rewrite('/bff/:path*', `${ORIGIN}/bff/:path*`),
    routes.rewrite('/oauth/callback', '/index.html'),
    spaFallback,
  ],
};
