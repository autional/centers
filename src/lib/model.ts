import raw from '../data/inventory.json';

export type ItemType = 'int' | 'bool' | 'scalar' | 'yaml';

export type Item = {
  /** 归属服务；空字符串 = 平台基座 */
  s: string;
  /** 配置键（点分路径） */
  k: string;
  /** 值类型 */
  t: ItemType;
  /** 展示值（演示数据已脱敏） */
  v: string;
  /** 配置域 */
  d: string;
  /** 配置组 */
  g: string;
};

export type Scope = '' | string;

export const itemId = (s: string, k: string) => `${s}|${k}`;
export const splitId = (id: string) => {
  const i = id.indexOf('|');
  return { s: id.slice(0, i), k: id.slice(i + 1) };
};

const RAW = raw as Item[];

type Overrides = { upsert: Record<string, Item>; deleted: string[] };
const LS_KEY = 'centers-console:overrides:v1';

export function loadOverrides(): Overrides {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return { upsert: {}, deleted: [] };
    const o = JSON.parse(s) as Overrides;
    return { upsert: o.upsert ?? {}, deleted: o.deleted ?? [] };
  } catch {
    return { upsert: {}, deleted: [] };
  }
}

export function saveOverrides(o: Overrides) {
  localStorage.setItem(LS_KEY, JSON.stringify(o));
}

export function clearOverrides() {
  localStorage.removeItem(LS_KEY);
}

export function applyOverrides(o: Overrides): Item[] {
  const deleted = new Set(o.deleted);
  const map = new Map<string, Item>();
  for (const it of RAW) {
    const id = itemId(it.s, it.k);
    if (deleted.has(id)) continue;
    map.set(id, it);
  }
  for (const [id, it] of Object.entries(o.upsert)) {
    if (deleted.has(id)) continue;
    map.set(id, it);
  }
  return Array.from(map.values());
}

export const DOMAIN_META: Record<string, { mono: string; color: string; desc: string }> = {
  数据库: { mono: '数', color: '#2563eb', desc: '端点、连接池、GORM 行为；口令在密钥中心' },
  运行与接口: { mono: '运', color: '#0ea5e9', desc: '端口、gRPC、HTTP/CORS、Swagger、路由' },
  认证与安全: { mono: '认', color: '#7c3aed', desc: 'JWT、登录策略、MFA、验证码、会话' },
  缓存与消息: { mono: '缓', color: '#f59e0b', desc: 'Redis、Kafka、RabbitMQ、Outbox 投递' },
  限流与配额: { mono: '限', color: '#ef4444', desc: '接口限流、配额、请求体限制、幂等' },
  业务与运营: { mono: '业', color: '#10b981', desc: '积分、钱包、汇率、导出、资料策略' },
  存储与搜索: { mono: '存', color: '#06b6d4', desc: 'MinIO、SeaweedFS、COS/OSS、Elasticsearch' },
  集成与回调: { mono: '集', color: '#8b5cf6', desc: '登录提供商、SAML、OAuth、Webhook' },
  邮件与短信: { mono: '邮', color: '#f97316', desc: 'SMTP、通知邮件、短信、推送' },
  密钥与加密: { mono: '密', color: '#64748b', desc: '密钥服务客户端、加密参数、Webhook 密钥' },
  治理与合规: { mono: '治', color: '#14b8a6', desc: '合规、隐私、审计留存、平台' },
  校验规则: { mono: '校', color: '#a3a3a3', desc: '内嵌在配置里的校验规则（元数据）' },
  日志与观测: { mono: '日', color: '#84cc16', desc: '日志级别/格式、指标与检索' },
};

export type GroupStat = { name: string; count: number; base: number; svc: number; services: number };
export type DomainStat = {
  name: string;
  count: number;
  base: number;
  svc: number;
  groups: GroupStat[];
  mono: string;
  color: string;
  desc: string;
};

export function buildMeta(items: Item[]): { domains: DomainStat[]; total: number; base: number; svc: number; services: string[] } {
  const dm = new Map<string, DomainStat>();
  const services = new Set<string>();
  let base = 0;
  let svc = 0;
  for (const it of items) {
    const meta = DOMAIN_META[it.d] ?? { mono: '?', color: '#94a3b8', desc: '' };
    let d = dm.get(it.d);
    if (!d) {
      d = { name: it.d, count: 0, base: 0, svc: 0, groups: [], ...meta };
      dm.set(it.d, d);
    }
    d.count += 1;
    if (it.s) {
      svc += 1;
      d.svc += 1;
      services.add(it.s);
    } else {
      base += 1;
      d.base += 1;
    }
    let g = d.groups.find((x) => x.name === it.g);
    if (!g) {
      g = { name: it.g, count: 0, base: 0, svc: 0, services: 0 };
      d.groups.push(g);
    }
    g.count += 1;
    if (it.s) g.svc += 1;
    else g.base += 1;
  }
  const svcSet = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.s) continue;
    const k = `${it.d}|${it.g}`;
    if (!svcSet.has(k)) svcSet.set(k, new Set());
    svcSet.get(k)!.add(it.s);
  }
  for (const d of dm.values()) {
    for (const g of d.groups) g.services = svcSet.get(`${d.name}|${g.name}`)?.size ?? 0;
    d.groups.sort((a, b) => b.count - a.count);
  }
  const domains = Array.from(dm.values()).sort((a, b) => b.count - a.count);
  return { domains, total: items.length, base, svc, services: Array.from(services).sort() };
}

export function isRule(it: Item) {
  return it.k.includes('.validation.') || it.k.startsWith('validation.');
}

/** 生效项：服务未定义 → 继承基座；服务定义 → 覆盖。 */
export function effective(items: Item[], domain: string, scope: Scope): (Item & { src: 'base' | 'override' | 'inherit' })[] {
  const base = items.filter((x) => x.d === domain && x.s === '').map((x) => ({ ...x, src: 'base' as const }));
  if (!scope) return base;
  const svc = items.filter((x) => x.d === domain && x.s === scope).map((x) => ({ ...x, src: 'override' as const }));
  const map = new Map<string, Item & { src: 'base' | 'override' | 'inherit' }>();
  for (const b of base) map.set(b.k, b);
  for (const s of svc) map.set(s.k, s);
  return Array.from(map.values());
}

export function groupEffective(items: Item[], domain: string, group: string, scope: Scope) {
  return effective(items, domain, scope).filter((x) => x.g === group);
}

export function servicesInGroup(items: Item[], domain: string, group: string) {
  return Array.from(new Set(items.filter((x) => x.d === domain && x.g === group && x.s).map((x) => x.s))).sort();
}

export type AggRow = {
  k: string;
  g: string;
  t: ItemType;
  v: string;
  total: number;
  base: boolean;
  services: number;
  distinct: number;
};

export function aggregate(items: Item[], domain: string, opts: { group?: string; service?: string; scope?: 'all' | 'base' | 'svc'; q?: string; hideRules?: boolean } = {}): AggRow[] {
  let list = items.filter((x) => x.d === domain);
  if (opts.group) list = list.filter((x) => x.g === opts.group);
  if (opts.service) list = list.filter((x) => x.s === opts.service);
  if (opts.scope === 'base') list = list.filter((x) => x.s === '');
  if (opts.scope === 'svc') list = list.filter((x) => x.s !== '');
  if (opts.hideRules) list = list.filter((x) => !isRule(x));
  const q = (opts.q ?? '').trim().toLowerCase();
  if (q) list = list.filter((x) => x.k.toLowerCase().includes(q) || x.v.toLowerCase().includes(q) || x.s.toLowerCase().includes(q));

  const map = new Map<string, AggRow & { vals: Set<string>; svcs: Set<string> }>();
  for (const it of list) {
    let e = map.get(it.k);
    if (!e) {
      e = { k: it.k, g: it.g, t: it.t, v: it.v, total: 0, base: false, services: 0, distinct: 0, vals: new Set(), svcs: new Set() };
      map.set(it.k, e);
    }
    e.total += 1;
    if (it.s === '') e.base = true;
    else e.svcs.add(it.s);
    if (it.v !== '••••••') e.vals.add(it.v);
  }
  const out: AggRow[] = [];
  for (const e of map.values()) {
    out.push({
      k: e.k,
      g: e.g,
      t: e.t,
      v: e.vals.size ? Array.from(e.vals)[0] : '••••••',
      total: e.total,
      base: e.base,
      services: e.svcs.size,
      distinct: e.vals.size,
    });
  }
  const gOrder = new Map<string, number>();
  const d = items.find((x) => x.d === domain);
  const groupList = Array.from(new Set(items.filter((x) => x.d === domain && x.g).map((x) => x.g)));
  groupList.forEach((g, i) => gOrder.set(g, i));
  return out.sort((a, b) => {
    const ga = gOrder.get(a.g) ?? 0;
    const gb = gOrder.get(b.g) ?? 0;
    return ga === gb ? a.k.localeCompare(b.k) : ga - gb;
  });
}

export function scopeLabel(s: string) {
  return s ? s : '平台基座';
}
