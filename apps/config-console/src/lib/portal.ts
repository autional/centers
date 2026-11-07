/**
 * 门户目录（平台租户 applications：`type=portal` / `is_platform=true` / `status=active`）。
 *
 * 方案 B：**目录来自平台**——本仓不维护站点域名表、不引入 `@autional/ui` / Tailwind。
 * 端点与平台控制台一致（同源 `/bff` 由 vercel.ts rewrites 代理到 api 网关）：
 *
 *   GET /bff/tenant/api/v1/admin/tenants/{tenantId}/applications?type=portal&is_platform=true&status=active
 *
 * 为什么不复用 `lib/api.ts` 的 `request()`：它的基址写死为 `/bff/config/api/v1/admin/config`，
 * 拼不出 tenant-service 端点。这里自己发 fetch，仅沿用「取会话 → 拼作用域头」的口径。
 *
 * 降级是**正常路径**（平台租户/无权限打该端点即 403，未登录 401）：
 * `fetchPortals` 失败一律抛错，由顶栏 `PortalMenu` 捕获后回落「平台控制台」，
 * 不弹错、不白屏、不触发退出登录。
 */
import { TENANT_ID } from './config';

/** 平台租户 well-known ULID（service-core base/constant TenantPlatformID，全环境同值）。 */
export const PLATFORM_TENANT_ID = '01KSQCBNVMS6SX64PJS937CE33';

/** 当前控制台自己的门户 code：目录中命中它即标「当前」。 */
export const CURRENT_PORTAL_CODE = 'config';

/** 「切换门户」清单排除项（与平台 `usePortalCatalog` 的 DEFAULT_EXCLUDE 一致）。 */
export const EXCLUDED_PORTAL_CODES: readonly string[] = ['auth', 'landing', 'authenticator'];

/** 管理面平面角色集（admin / security 门户的入口门禁同集）。 */
export const ADMIN_PLANE_ROLES: readonly string[] = ['super_admin', 'admin', 'security_admin', 'user_manager'];

/** 目录端点默认前缀（同源；生产由 Vercel rewrites 代理到 api.autional.*）。 */
const DEFAULT_BFF_BASE = '/bff';
/** 目录请求超时（不阻塞顶栏：超时即降级）。 */
const DEFAULT_TIMEOUT_MS = 5_000;

/** 两段式 TLD（`config.autional.cn` → 根域 `autional.cn` 不需要，但 `x.com.cn` 需要保留三段）。 */
const TWO_PART_TLDS = new Set(['com.cn', 'co.uk', 'co.jp', 'com.au', 'co.nz']);

/** 目录里单个门户应用的容错形状（后端 `dto.ApplicationResponse` + 可选的 `config.portal`）。 */
export type PortalApplication = {
  code: string;
  name: string;
  description?: string;
  order?: number;
  /**
   * 门户域名/路径配置。后端当前列表 DTO 尚未透出该字段（平台侧同样按「不存在则用 code」处理），
   * 但一旦透出即可直接生效，无需改 URL 逻辑。
   */
  config?: {
    portal?: {
      host?: string;
      base?: string;
      /** 兼容 snake / camel 两种拼写（仅用于未来叠加，当前不参与过滤）。 */
      allowed_roles?: string[];
      allowedRoles?: string[];
    };
  } | null;
};

/** 目录请求失败（调用方据此降级，不区分 401/403/超时）。 */
export class PortalCatalogError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'PortalCatalogError';
    this.status = status;
  }
}

/**
 * 生效租户：`session.user.tenantId` → 构建期 `VITE_TENANT_ID` → 平台租户常量。
 * 管理面端点要求 `X-Tenant-ID` 必填，这里不伪造非平台值。
 */
export function resolveTenantId(tenantId?: string | null): string {
  const fromSession = String(tenantId ?? '').trim();
  if (fromSession) return fromSession;
  const fromEnv = String(TENANT_ID ?? '').trim();
  return fromEnv || PLATFORM_TENANT_ID;
}

/** 当前页面协议；非浏览器环境（node 单测）返回空串，由调用方显式传入。 */
function currentProtocol(): string {
  if (typeof window === 'undefined') return '';
  return window.location?.protocol ?? '';
}

/**
 * 根域：去掉子域，保留 `autional.com` / `autional.cn` 这类两段。
 *
 *   config.autional.cn  → autional.cn
 *   config.autional.com → autional.com
 *   localhost / 127.0.0.1 / ::1 → 原样（无法派生子域）
 *   x.iam.tianv.local → iam.tianv.local（.local 视为三段根，与平台 shared 一致）
 */
export function rootDomainOf(hostname: string): string {
  const raw = String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const host = raw.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host) return '';
  if (host === 'localhost' || host === '::1' || /^\d+(\.\d+){3}$/.test(host)) return host;

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  if (host.endsWith('.local') && parts.length >= 3) return parts.slice(-3).join('.');
  if (TWO_PART_TLDS.has(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** base 归一：空即无路径；非空补前导 `/`（`admin` 与 `/admin` 等价）。 */
function normalizeBase(base?: string | null): string {
  const value = String(base ?? '').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * 拼门户 URL：`${protocol}//${host}.${root}${base}`。
 *   - `entry.config.portal.host` 为空 → 用 `entry.code`（平台默认表同规则）；
 *   - `host` 已是 FQDN 或以根域结尾 → 不再重复拼根域；
 *   - `base` 为空即无路径；非空补前导 `/`。
 * 无法派生（缺 host / 缺根域）时返回 `''`，调用方按「不可跳转」处理。
 */
export function buildPortalUrl(entry: PortalApplication, rootDomain: string, protocol = currentProtocol()): string {
  const portal = entry?.config?.portal ?? null;
  const code = String(entry?.code ?? '').trim();
  const host = String(portal?.host ?? '').trim() || code;
  const root = String(rootDomain ?? '')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  if (!host || !root) return '';

  const fullHost = host === root || host.endsWith(`.${root}`) ? host : `${host}.${root}`;
  const proto = String(protocol ?? '').trim();
  return `${proto ? `${proto}//` : '//'}${fullHost}${normalizeBase(portal?.base)}`;
}

/**
 * 目录不可用时的降级出口（唯一保留的域名硬编码，按当前站点后缀选 cn / com）。
 * 目录正常时**不使用**它——门户域名一律来自平台目录 / code。
 */
export function fallbackPlatformUrl(hostname: string): string {
  const host = String(hostname ?? '')
    .trim()
    .toLowerCase();
  return host.endsWith('.cn') ? 'https://platform.autional.cn' : 'https://platform.autional.com';
}

/** 门户可见性（入口门禁镜像）：谁能登录谁才看得见。 */
export type PortalFilterContext = {
  /** 生效租户（可传会话原值，内部走 {@link resolveTenantId} 归一） */
  tenantId?: string | null;
  /** 会话 JWT 的 roles；**空数组/缺省 = 令牌未带角色 → 不过滤 admin/security**，避免误伤 */
  roles?: readonly string[] | null;
};

/**
 * 过滤目录：
 *   - 排除 `auth` / `landing` / `authenticator`（与平台 DEFAULT_EXCLUDE 一致）；
 *   - `platform` 仅平台租户可见；
 *   - `admin` / `security` 仅管理面角色可见（roles 为空时不过滤，理由见 {@link PortalFilterContext.roles}）；
 *   - 其它 code 不限制（未知门户不误伤）。
 * 顺序保持服务端顺序（调用方再按 `order` 排序）。
 */
export function filterPortals(list: readonly PortalApplication[], ctx: PortalFilterContext = {}): PortalApplication[] {
  const excluded = new Set(EXCLUDED_PORTAL_CODES);
  const isPlatformTenant = resolveTenantId(ctx.tenantId) === PLATFORM_TENANT_ID;
  const roles = (ctx.roles ?? []).filter((role): role is string => typeof role === 'string' && role.trim() !== '');

  return list.filter((app) => {
    const code = String(app?.code ?? '').trim();
    if (!code || excluded.has(code)) return false;
    if (code === 'platform') return isPlatformTenant;
    if (code === 'admin' || code === 'security') {
      // 令牌未带 roles（部分 OIDC client 不注入）→ 不放行也不拦截：保持可见，由目标端门禁裁决。
      if (roles.length === 0) return true;
      return roles.some((role) => ADMIN_PLANE_ROLES.includes(role));
    }
    return true;
  });
}

export type FetchPortalsOptions = {
  /** 会话租户（缺省走 env / 平台常量） */
  tenantId?: string | null;
  /** 会话令牌；缺省则不带 Authorization（管理面会 403，由调用方降级） */
  accessToken?: string | null;
  /** 同源前缀，默认 `/bff` */
  bffBase?: string;
  timeoutMs?: number;
  /** 测试注入；默认全局 fetch */
  fetchImpl?: typeof fetch;
  /** 外部取消（组件卸载） */
  signal?: AbortSignal;
};

/** 目录端点 URL（导出以便单测断言与排障）。 */
export function portalCatalogUrl(tenantId: string, bffBase = DEFAULT_BFF_BASE): string {
  const base = String(bffBase || DEFAULT_BFF_BASE).replace(/\/+$/, '');
  const tenant = encodeURIComponent(tenantId);
  return `${base}/tenant/api/v1/admin/tenants/${tenant}/applications?type=portal&is_platform=true&status=active`;
}

/** 响应形状容错：`[]` / `{data: []}` / `{items: []}`；`code !== 0` 视为失败。 */
function parseCatalog(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const envelope = body as { code?: unknown; message?: unknown; data?: unknown; items?: unknown };
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      const detail = typeof envelope.message === 'string' && envelope.message ? `：${envelope.message}` : '';
      throw new PortalCatalogError(`门户目录返回错误码 ${envelope.code}${detail}`);
    }
    if (Array.isArray(envelope.data)) return envelope.data;
    if (Array.isArray(envelope.items)) return envelope.items;
  }
  return [];
}

/** 行归一：丢掉无 code 的行；`name` 回落 code；按 code 去重（防菜单 key 冲突）。 */
function normalizeRows(rows: readonly unknown[]): PortalApplication[] {
  const out: PortalApplication[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    const code = typeof raw.code === 'string' ? raw.code.trim() : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : code;
    const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined;
    const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : undefined;
    const config = raw.config && typeof raw.config === 'object' ? (raw.config as PortalApplication['config']) : null;
    out.push({ code, name, description, order, config });
  }
  return out;
}

/**
 * 拉门户目录。**失败即抛**（`PortalCatalogError`），由调用方统一降级——
 * 这样「目录不可用」与「目录为空」在 UI 上是同一条正常路径，不需要弹错。
 */
export async function fetchPortals(options: FetchPortalsOptions = {}): Promise<PortalApplication[]> {
  const { tenantId, accessToken, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const tenant = resolveTenantId(tenantId);
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new PortalCatalogError('当前环境不支持 fetch');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  // 后端 ExtractTenantFromHeaderStrict 要求该头必填；空值不伪造。
  if (tenant) headers['X-Tenant-ID'] = tenant;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort);
  }

  try {
    let res: Response;
    try {
      res = await doFetch(portalCatalogUrl(tenant, options.bffBase), {
        method: 'GET',
        headers,
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch (cause) {
      const aborted = (cause as Error)?.name === 'AbortError';
      throw new PortalCatalogError(
        aborted ? `门户目录请求超时（${Math.round(timeoutMs / 100) / 10}s）` : `无法连接门户目录：${(cause as Error)?.message ?? ''}`,
      );
    }

    if (!res.ok) throw new PortalCatalogError(`门户目录请求失败（HTTP ${res.status}）`, res.status);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PortalCatalogError('门户目录响应不是合法 JSON', res.status);
    }
    return normalizeRows(parseCatalog(body));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}


/**
 * 目录不可用时的**静态兜底**（仅降级路径使用）。
 *
 * 背景：config 的 OAuth 客户端目前没有 tenant-service 的 admin scope，
 * `GET /tenants/{id}/applications` 返回 403 `token scope does not allow this operation`，
 * 顶栏「切换门户」于是只剩一条「平台控制台」。这里按根域派生出舰队已知的 9 个门户，
 * 保证降级时仍可跳转；一旦 scope 补齐、目录恢复 200，这份兜底自动不再使用。
 *
 * 只列 code —— 域名由 buildPortalUrl 按 code 派生，不在这里维护域名表。
 */
export const FALLBACK_PORTAL_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'config', name: '配置中心' },
  { code: 'secret', name: '密钥中心' },
  { code: 'admin', name: '管理后台' },
  { code: 'security', name: '安全中心' },
  { code: 'platform', name: '平台控制台' },
  { code: 'user', name: '用户中心' },
  { code: 'status', name: '状态页' },
  { code: 'trust', name: '信任中心' },
  { code: 'developer', name: '开发者门户' },
];

export function fallbackPortals(): PortalApplication[] {
  return FALLBACK_PORTAL_CODES.map((item, index) => ({
    code: item.code,
    name: item.name,
    order: index,
  }));
}
