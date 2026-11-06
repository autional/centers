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

/** 当前页面 origin；非浏览器环境（node 单测 / SSR）返回空串，避免模块初始化就抛。 */
function origin(): string {
  return typeof window === 'undefined' ? '' : window.location?.origin ?? '';
}

/** 当前 hostname；非浏览器环境返回空串。 */
function hostname(): string {
  return typeof window === 'undefined' ? '' : window.location?.hostname ?? '';
}

/**
 * 由 hostname 推导顶栏环境标签（纯函数，便于单测）：
 *   - `localhost` / `127.0.0.1` / `*.local` → 本地
 *   - `config.autional.com` / `config.autional.cn` → 生产
 *   - 其它 → hostname 首段（如 `preview` → `preview`）；空 hostname → 空串
 */
export function envLabelOf(rawHostname: string): string {
  const raw = String(rawHostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, ''); // 去掉 IPv6 方括号
  if (raw === '') return '';
  if (raw === '::1') return '本地';
  const host = raw.replace(/:\d+$/, '').replace(/\.$/, ''); // 去掉端口 / FQDN 尾点
  if (host === '') return '';
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return '本地';
  if (host === 'config.autional.com' || host === 'config.autional.cn') return '生产';
  return host.split('.')[0] ?? host;
}

/**
 * 顶栏展示的环境标签。`VITE_ENV_LABEL` 非空优先（如预发环境显式标注），
 * 否则按 hostname 推导；两者都取不到时回落「生产」（浏览器里 hostname 恒非空）。
 */
export const ENV_LABEL = str('VITE_ENV_LABEL') || envLabelOf(hostname()) || '生产';

/** OIDC 授权码 + PKCE 参数。 */
export const OIDC = {
  authorizeUrl: str('VITE_OIDC_AUTHORIZE', 'https://auth.autional.com/oauth/api/v1/oauth/authorize'),
  tokenUrl: str('VITE_OIDC_TOKEN', 'https://api.autional.com/bff/oauth/api/v1/oauth/token'),
  clientId: str('VITE_OIDC_CLIENT_ID'),
  redirectUri: str('VITE_OIDC_REDIRECT_URI', `${origin()}/oauth/callback`),
  scope: str('VITE_OIDC_SCOPE', 'openid profile email'),
} as const;

/** 当前地址是否 OIDC 回调页（`/oauth/callback`）。 */
export function isCallbackPath(pathname: string = window.location.pathname): boolean {
  return pathname.replace(/\/+$/, '') === '/oauth/callback';
}

/** 当前构建的配置摘要，供页面提示与排障使用。 */
export const RUNTIME_MODE_LABEL = DATA_MODE === 'api' ? '真实 API' : '演示数据';
