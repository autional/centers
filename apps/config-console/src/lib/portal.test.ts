/**
 * portal.ts 单测（`environment: 'node'`，纯函数 + mock fetch，不真连网）：
 *   - `rootDomainOf`：`config.autional.cn|com` → 两段根域；localhost / IP 原样；`.local` 保留三段；
 *   - `buildPortalUrl`：有 host/base、无 host（回落 code）、base 带/不带前导 `/`、host 已是 FQDN；
 *   - `filterPortals`：排除 auth/landing/authenticator；platform 仅平台租户；admin/security 需管理面角色
 *     （roles 缺省时不过滤）；未知 code 保留；
 *   - `fetchPortals`：`{code:0,data}` / `{items}` / 裸数组 均可用；`code!==0`、非 2xx、非 JSON 抛错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PLANE_ROLES,
  EXCLUDED_PORTAL_CODES,
  PLATFORM_TENANT_ID,
  PortalCatalogError,
  buildPortalUrl,
  fallbackPlatformUrl,
  fetchPortals,
  filterPortals,
  portalCatalogUrl,
  resolveTenantId,
  rootDomainOf,
} from './portal';
import type { PortalApplication } from './portal';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function app(code: string, extra: Partial<PortalApplication> = {}): PortalApplication {
  return { code, name: code, ...extra };
}

describe('rootDomainOf', () => {
  it('去掉首段子域，保留两段根域', () => {
    expect(rootDomainOf('config.autional.cn')).toBe('autional.cn');
    expect(rootDomainOf('config.autional.com')).toBe('autional.com');
    expect(rootDomainOf('platform.autional.cn')).toBe('autional.cn');
  });

  it('localhost / IP / 空串原样返回（无法派生子域）', () => {
    expect(rootDomainOf('localhost')).toBe('localhost');
    expect(rootDomainOf('127.0.0.1')).toBe('127.0.0.1');
    expect(rootDomainOf('')).toBe('');
  });

  it('端口 / 大小写 / 尾点 / 二段式 TLD 归一', () => {
    expect(rootDomainOf('LOCALHOST:13120')).toBe('localhost');
    expect(rootDomainOf('config.autional.com.')).toBe('autional.com');
    expect(rootDomainOf('config.example.com.cn')).toBe('example.com.cn');
    expect(rootDomainOf('config.iam.tianv.local')).toBe('iam.tianv.local');
  });
});

describe('buildPortalUrl', () => {
  it('有 config.portal.host / base', () => {
    const entry = app('security', { config: { portal: { host: 'security', base: '/security' } } });
    expect(buildPortalUrl(entry, 'autional.com', 'https:')).toBe('https://security.autional.com/security');
  });

  it('host 为空 → 回落 code', () => {
    expect(buildPortalUrl(app('config'), 'autional.cn', 'https:')).toBe('https://config.autional.cn');
    expect(buildPortalUrl(app('config', { config: { portal: { host: '' } } }), 'autional.cn', 'https:')).toBe(
      'https://config.autional.cn',
    );
  });

  it('base 带 / 不带前导斜杠结果一致；空 base 无路径', () => {
    const withSlash = buildPortalUrl(app('admin', { config: { portal: { base: '/admin' } } }), 'autional.com', 'https:');
    const noSlash = buildPortalUrl(app('admin', { config: { portal: { base: 'admin' } } }), 'autional.com', 'https:');
    expect(withSlash).toBe('https://admin.autional.com/admin');
    expect(noSlash).toBe(withSlash);
    expect(buildPortalUrl(app('admin', { config: { portal: { base: '' } } }), 'autional.com', 'https:')).toBe(
      'https://admin.autional.com',
    );
  });

  it('host 已是 FQDN 时不重复拼根域；缺根域/缺 host 返回空串', () => {
    expect(buildPortalUrl(app('x', { config: { portal: { host: 'config.autional.cn' } } }), 'autional.cn', 'https:')).toBe(
      'https://config.autional.cn',
    );
    expect(buildPortalUrl(app('config'), '', 'https:')).toBe('');
  });

  it('未给协议（非浏览器 / 未传参）时输出协议相对 URL', () => {
    expect(buildPortalUrl(app('config'), 'autional.com')).toBe('//config.autional.com');
  });
});

describe('filterPortals', () => {
  it('排除 auth / landing / authenticator', () => {
    const list = [app('auth'), app('landing'), app('authenticator'), app('config'), app('docs')];
    const out = filterPortals(list, { tenantId: PLATFORM_TENANT_ID, roles: ['super_admin'] }).map((p) => p.code);
    expect(out).toEqual(['config', 'docs']);
    expect(EXCLUDED_PORTAL_CODES).toEqual(['auth', 'landing', 'authenticator']);
  });

  it('platform 仅平台租户可见', () => {
    const list = [app('platform'), app('config')];
    expect(filterPortals(list, { tenantId: '01KTKJF63AQ6BAKDP8RAMJ3KEK', roles: ['super_admin'] }).map((p) => p.code)).toEqual([
      'config',
    ]);
    expect(filterPortals(list, { tenantId: PLATFORM_TENANT_ID, roles: ['super_admin'] }).map((p) => p.code)).toEqual([
      'platform',
      'config',
    ]);
  });

  it('admin / security 需管理面角色；无角色时不拦截也不放行其余门户', () => {
    const list = [app('admin'), app('security'), app('config'), app('docs')];
    expect(filterPortals(list, { tenantId: PLATFORM_TENANT_ID, roles: ['member'] }).map((p) => p.code)).toEqual([
      'config',
      'docs',
    ]);
    for (const role of ADMIN_PLANE_ROLES) {
      expect(filterPortals(list, { tenantId: PLATFORM_TENANT_ID, roles: [role] }).map((p) => p.code)).toEqual([
        'admin',
        'security',
        'config',
        'docs',
      ]);
    }
    // roles 缺省（令牌未带角色）→ 不过滤 admin/security，避免把有权限的人误伤
    expect(filterPortals(list, { tenantId: PLATFORM_TENANT_ID }).map((p) => p.code)).toEqual([
      'admin',
      'security',
      'config',
      'docs',
    ]);
  });

  it('未知 code 保留（未知门户不误伤）；无 code 的行丢弃', () => {
    const list = [app('brand'), app('trust'), app(''), { code: '  ' } as PortalApplication];
    expect(filterPortals(list, { tenantId: PLATFORM_TENANT_ID }).map((p) => p.code)).toEqual(['brand', 'trust']);
  });
});

describe('fallbackPlatformUrl', () => {
  it('.cn 站点 → platform.autional.cn，其余 → platform.autional.com', () => {
    expect(fallbackPlatformUrl('config.autional.cn')).toBe('https://platform.autional.cn');
    expect(fallbackPlatformUrl(' CONFIG.AUTIONAL.CN ')).toBe('https://platform.autional.cn');
    expect(fallbackPlatformUrl('config.autional.com')).toBe('https://platform.autional.com');
    expect(fallbackPlatformUrl('localhost')).toBe('https://platform.autional.com');
    expect(fallbackPlatformUrl('')).toBe('https://platform.autional.com');
  });
});

describe('resolveTenantId', () => {
  it('会话租户优先，其次 env，最后平台常量', () => {
    expect(resolveTenantId('01KTKJF63AQ6BAKDP8RAMJ3KEK')).toBe('01KTKJF63AQ6BAKDP8RAMJ3KEK');
    expect(resolveTenantId('  ')).toBe(PLATFORM_TENANT_ID);
  });
});

describe('fetchPortals', () => {
  const tenant = '01KSQCBNVMS6SX64PJS937CE33';

  function stubFetch(body: unknown, init: { status?: number; type?: 'json' | 'text' } = {}) {
    const fetchMock = vi.fn(async (_input: unknown, _init?: unknown) => {
      if (init.type === 'text') return new Response('not-json', { status: init.status ?? 200 });
      return new Response(JSON.stringify(body), { status: init.status ?? 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('`{code:0,data:[...]}` 可用，且请求 URL / 头符合契约', async () => {
    const fetchMock = stubFetch({
      code: 0,
      data: [
        { code: 'config', name: '配置中心', order: 3 },
        { code: 'admin', name: '管理控制台', description: '租户与用户', order: 1 },
      ],
    });

    const rows = await fetchPortals({ tenantId: tenant, accessToken: 'tok-1' });
    expect(rows.map((r) => r.code)).toEqual(['config', 'admin']);
    expect(rows[0]).toMatchObject({ code: 'config', name: '配置中心', order: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/bff/tenant/api/v1/admin/tenants/${tenant}/applications?type=portal&is_platform=true&status=active`,
    );
    expect(url).toBe(portalCatalogUrl(tenant));
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['X-Tenant-ID']).toBe(tenant);
  });

  it('`{items:[...]}` / 裸数组 同样可用；按 code 去重', async () => {
    stubFetch({ items: [{ code: 'config', name: '配置中心' }, { code: 'config', name: '重复' }] });
    expect((await fetchPortals({ tenantId: tenant })).map((r) => r.name)).toEqual(['配置中心']);

    stubFetch([{ code: 'status', name: '状态页' }]);
    expect((await fetchPortals({ tenantId: tenant })).map((r) => r.code)).toEqual(['status']);
  });

  it('`code !== 0` → 抛 PortalCatalogError（由调用方降级）', async () => {
    stubFetch({ code: 40301, message: '权限不足' });
    await expect(fetchPortals({ tenantId: tenant })).rejects.toBeInstanceOf(PortalCatalogError);
    await expect(fetchPortals({ tenantId: tenant })).rejects.toThrow(/40301/);
  });

  it('非 2xx / 非 JSON / 网络错误 → 抛错', async () => {
    stubFetch({ code: 0, data: [] }, { status: 403 });
    await expect(fetchPortals({ tenantId: tenant })).rejects.toThrow(/HTTP 403/);

    stubFetch(null, { type: 'text' });
    await expect(fetchPortals({ tenantId: tenant })).rejects.toThrow(/合法 JSON/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, _init?: unknown) => {
        throw new TypeError('net down');
      }),
    );
    await expect(fetchPortals({ tenantId: tenant })).rejects.toThrow(/无法连接门户目录/);
  });

  it('缺省租户走平台常量；无令牌时不带 Authorization', async () => {
    const fetchMock = stubFetch({ code: 0, data: [] });
    await fetchPortals();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/tenants/${PLATFORM_TENANT_ID}/applications`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
