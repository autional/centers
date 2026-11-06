/**
 * 运行期配置（构建期注入的 VITE_* 环境变量）。
 *
 * 两个正交开关：
 *   - VITE_DATA_MODE = mock（默认）| api   —— 数据从本地演示数据来，还是走配置中心真实接口；
 *   - VITE_AUTH_MODE = mock（默认）| oidc  —— 会话来自演示账号，还是走 OIDC 授权码 + PKCE。
 *
 * 默认全 mock：公开演示（config.autional.com）无需后端、无需登录即可使用。
 * 切 api/oidc 见 README「接入真实 API」。
 */

type RawEnv = Record<string, string | undefined>;

const env = (import.meta.env ?? {}) as unknown as RawEnv;

/** 读字符串环境变量；缺省/空串一律回落默认值（避免 `VITE_X=` 把默认值打成空）。 */
function str(name: string, fallback = ''): string {
  const raw = env[name];
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return value === '' ? fallback : value;
}

export type DataMode = 'mock' | 'api';
export type AuthMode = 'mock' | 'oidc';

export const DATA_MODE: DataMode = str('VITE_DATA_MODE', 'mock').toLowerCase() === 'api' ? 'api' : 'mock';
export const AUTH_MODE: AuthMode = str('VITE_AUTH_MODE', 'mock').toLowerCase() === 'oidc' ? 'oidc' : 'mock';

/**
 * 管理面 API 基址。默认走同源 `/bff/config/...`：
 * 生产由 vercel.json 的 rewrites 代理到 https://api.autional.com/bff/...（服务端代理，无 CORS）；
 * 本地 dev 可在 vite 代理或 VITE_API_BASE 直接指向网关。
 */
export const API_BASE = str('VITE_API_BASE', '/bff/config/api/v1/admin/config').replace(/\/+$/, '');

/** 租户/应用作用域：JWT 已带租户时以令牌为准（见 lib/api.ts），此处是兜底。 */
export const TENANT_ID = str('VITE_TENANT_ID');
export const APP_ID = str('VITE_APP_ID');

/** 1 = 未登录不得进入控制台（默认 0：mock 演示可直接看）。 */
export const REQUIRE_AUTH = str('VITE_REQUIRE_AUTH') === '1';

/** OIDC 授权码 + PKCE 参数。 */
export const OIDC = {
  authorizeUrl: str('VITE_OIDC_AUTHORIZE', 'https://auth.autional.com/oauth/api/v1/oauth/authorize'),
  tokenUrl: str('VITE_OIDC_TOKEN', 'https://api.autional.com/bff/oauth/api/v1/oauth/token'),
  clientId: str('VITE_OIDC_CLIENT_ID'),
  redirectUri: str('VITE_OIDC_REDIRECT_URI', `${window.location.origin}/oauth/callback`),
  scope: str('VITE_OIDC_SCOPE', 'openid profile email'),
} as const;

/** 当前地址是否 OIDC 回调页（`/oauth/callback`）。 */
export function isCallbackPath(pathname: string = window.location.pathname): boolean {
  return pathname.replace(/\/+$/, '') === '/oauth/callback';
}

/** 当前构建的配置摘要，供页面提示与排障使用。 */
export const RUNTIME_MODE_LABEL = DATA_MODE === 'api' ? '真实 API' : '演示数据';
