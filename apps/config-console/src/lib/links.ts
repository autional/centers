/**
 * 跨站入口：只用于导航，不维护门户清单（门户切换走平台目录 lib/portal.ts）。
 * 构建期 `VITE_SECRET_CENTER_URL` 优先，否则按当前域名后缀推导。
 */
export const SECRET_CENTER_URL = (() => {
  const fromEnv = String(import.meta.env?.VITE_SECRET_CENTER_URL ?? '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const host = typeof window === 'undefined' ? '' : window.location.hostname;
  return host.endsWith('.cn') ? 'https://secret.autional.cn' : 'https://secret.autional.com';
})();

/** 深链：密钥中心按 key 直接打开详情（只传键名，不传值）。 */
export function secretCenterUrl(key?: string): string {
  return key ? `${SECRET_CENTER_URL}/secrets?key=${encodeURIComponent(key)}` : SECRET_CENTER_URL;
}
