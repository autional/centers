/**
 * 数据层抽象：`mock`（默认，演示）与 `api`（真实配置中心）两种实现，UI 只依赖本模块的 Store 接口。
 *
 * - mock：沿用 `data/inventory.json` + localStorage 覆盖（演示可直接编辑，可「重置」）；
 * - api ：读写走 lib/api.ts；域/组统计用 `/groups`，组编辑页的「继承/覆盖」用 `/effective`，
 *         历史与回滚用 `/history` + `/rollback`，组编辑器 schema 用 `/editors`（不存在则回落本地注册表）。
 *
 * 约定：所有写操作都必须带非空原因（1–200 字），由 UI 的「原因」弹窗收集后传入。
 */
import * as api from './api';
import { DATA_MODE } from './config';
import { DOMAIN_META, applyOverrides, buildMeta, clearOverrides, itemId, loadOverrides, saveOverrides, toItemType } from './model';
import type { DomainStat, GroupStat, Item } from './model';
import type { Field, GroupEditor } from './editors';
import { buildExportDoc, demoConsumers, diffEntries, stringifyExport } from './transfer';
import type { ParsedEntry } from './transfer';

export type Meta = ReturnType<typeof buildMeta>;

/** 生效项：src 与 model.effective() 同口径（base|inherit|override）。 */
export type EffectiveRow = Item & { src: 'base' | 'inherit' | 'override' };

export type HistoryEntry = api.HistoryItem;

export const EMPTY_META: Meta = { domains: [], total: 0, base: 0, svc: 0, services: [] };

/** 后端 value_type → 前端展示类型（单源在 lib/model.ts，这里保留同名再导出）。 */
export { toItemType } from './model';

const FALLBACK_DOMAIN = '未分组';
const FALLBACK_GROUP = '未分组';

function toItem(row: api.ApiItem): Item {
  return {
    s: row.service_name ?? '',
    k: row.key,
    t: toItemType(row.value_type),
    v: row.value ?? '',
    d: row.domain || FALLBACK_DOMAIN,
    g: row.group || row.group_name || FALLBACK_GROUP,
  };
}

function toEffectiveRow(row: api.EffectiveItem, scope: string): EffectiveRow {
  return {
    s: row.source === 'override' ? scope : '',
    k: row.key,
    t: toItemType(row.value_type),
    v: row.value ?? '',
    d: row.domain || FALLBACK_DOMAIN,
    g: row.group || FALLBACK_GROUP,
    src: row.source,
  };
}

/** `/groups` → UI 的 meta（域/组统计以服务端聚合为准；服务清单仍由条目推导）。 */
function metaFromGroups(view: api.GroupsResult, items: Item[]): Meta {
  const domains: DomainStat[] = (view.domains ?? []).map((d) => {
    const meta = DOMAIN_META[d.domain] ?? { mono: '?', color: '#94a3b8', desc: '' };
    const groups: GroupStat[] = (d.groups ?? []).map((g) => ({
      name: g.group,
      count: g.count,
      base: g.base,
      svc: g.svc,
      services: g.services,
    }));
    return { name: d.domain, count: d.count, base: d.base, svc: d.svc, groups, ...meta };
  });
  const services = Array.from(new Set(items.filter((it) => it.s).map((it) => it.s))).sort();
  return {
    domains,
    total: domains.reduce((n, d) => n + d.count, 0),
    base: domains.reduce((n, d) => n + d.base, 0),
    svc: domains.reduce((n, d) => n + d.svc, 0),
    services,
  };
}

/** 把 `/editors` 的 schema 转成组编辑页需要的字段描述（只取白名单字段，非法项丢弃）。 */
function toGroupEditor(record: api.EditorRecord): GroupEditor | null {
  const schema = record?.schema;
  if (!schema || !Array.isArray(schema.fields)) return null;
  const fields: Field[] = schema.fields
    .filter((f): f is api.EditorField => !!f && typeof f.label === 'string')
    .map((f) => {
      const kind: Field['kind'] = f.kind === 'int' || f.kind === 'bool' || f.kind === 'text' ? f.kind : undefined;
      const keys = Array.isArray(f.keys) ? f.keys.filter((k): k is string => typeof k === 'string' && k !== '') : [];
      const secret = Array.isArray(f.secret) ? f.secret.filter((k): k is string => typeof k === 'string' && k !== '') : undefined;
      return { label: f.label, keys, kind, secret, secretRef: f.secretRef, hint: f.hint };
    })
    .filter((f) => f.keys.length > 0 || (f.secret?.length ?? 0) > 0);
  if (!fields.length) return null;
  return { note: schema.note ?? '', fields };
}

export type Store = {
  mode: 'mock' | 'api';
  /** 写操作是否落在本机（mock）——决定是否展示「重置」与演示横幅。 */
  localWrites: boolean;
  canReset: boolean;
  /** 是否用 `/effective` 取组生效项（api 模式）。 */
  remoteEffective: boolean;
  /** 是否用 `/editors` 取组编辑器 schema（api 模式）。 */
  remoteEditor: boolean;
  load(): Promise<{ items: Item[]; meta: Meta }>;
  upsert(item: Item, reason: string): Promise<void>;
  remove(item: Item, reason: string): Promise<void>;
  rollback(item: Item, revision: number, reason: string): Promise<void>;
  history(item: Item): Promise<HistoryEntry[]>;
  importBulk(entries: api.ImportEntry[], replaceExisting: boolean, reason: string): Promise<api.ImportOutcome[]>;
  effective(scope: string, domain: string, group: string): Promise<EffectiveRow[] | null>;
  editor(domain: string, group: string): Promise<GroupEditor | null>;
  /** 导出文件文本（mock 本地生成；api 走后端 `/export`，含服务端遮罩）。 */
  exportConfig(format: api.ExportFormat): Promise<string>;
  /** 导入预检/差异（mock 本地计算；api 走 `/import/preview`，只读不写库）。 */
  previewImport(entries: ParsedEntry[]): Promise<api.ImportPreviewResult>;
  /** 影响面：该键可能被哪些服务读取（mock 用本地演示数据，source=demo）。 */
  consumers(key: string): Promise<ConsumersInfo>;
  reset(): void;
};

/** 影响面视图（api: allowlist|unavailable；mock: demo）。 */
export type ConsumersInfo = {
  key: string;
  services: string[];
  source: 'allowlist' | 'unavailable' | 'demo';
  note?: string;
};

/* --------------------------------- mock --------------------------------- */

const mockStore: Store = {
  mode: 'mock',
  localWrites: true,
  canReset: true,
  remoteEffective: false,
  remoteEditor: false,

  async load() {
    const items = applyOverrides(loadOverrides());
    return { items, meta: buildMeta(items) };
  },

  async upsert(item: Item) {
    const current = loadOverrides();
    const id = itemId(item.s, item.k);
    saveOverrides({
      upsert: { ...current.upsert, [id]: item },
      deleted: current.deleted.filter((x) => x !== id),
    });
  },

  async remove(item: Item) {
    const current = loadOverrides();
    const id = itemId(item.s, item.k);
    const upsert = { ...current.upsert };
    delete upsert[id];
    saveOverrides({ upsert, deleted: Array.from(new Set([...current.deleted, id])) });
  },

  async rollback() {
    throw new Error('演示模式不支持回滚（请切换到 VITE_DATA_MODE=api）');
  },

  async history() {
    return [];
  },

  async importBulk() {
    throw new Error('演示模式不支持导入（请切换到 VITE_DATA_MODE=api）');
  },

  async effective() {
    return null;
  },

  async editor() {
    return null;
  },

  async exportConfig(format) {
    // mock：本地生成与后端同结构的文件（敏感项在演示数据里已是遮罩占位，原样搬运）。
    return stringifyExport(buildExportDoc(applyOverrides(loadOverrides())), format);
  },

  async previewImport(entries) {
    // mock：只在本地算差异，绝不写任何存储（提交入口在 mock 模式被禁用）。
    return diffEntries(entries, applyOverrides(loadOverrides()));
  },

  async consumers(key) {
    return demoConsumers(key, applyOverrides(loadOverrides()));
  },

  reset() {
    clearOverrides();
  },
};

/* ---------------------------------- api --------------------------------- */

/**
 * 记录服务端原始 value_type：前端展示类型会把 json 归到 yaml、text 归到 scalar，
 * 编辑时若用户没有改变类型，必须回写原始枚举，避免把 json 项悄悄改成 yaml。
 */
const originalValueType = new Map<string, string>();

function rowId(serviceName: string, key: string): string {
  return `${serviceName}|${key}`;
}

const apiStore: Store = {
  mode: 'api',
  localWrites: false,
  canReset: false,
  remoteEffective: true,
  remoteEditor: true,

  async load() {
    const rows = await api.listAllItems();
    originalValueType.clear();
    for (const row of rows) originalValueType.set(rowId(row.service_name, row.key), row.value_type);
    const items = rows.map(toItem);
    // 域/组统计以服务端聚合为准；`/groups` 失败不阻断列表（退回本地聚合）。
    let view: api.GroupsResult | null = null;
    try {
      view = await api.groups();
    } catch {
      view = null;
    }
    return { items, meta: view ? metaFromGroups(view, items) : buildMeta(items) };
  },

  async upsert(item: Item, reason: string) {
    const raw = originalValueType.get(rowId(item.s, item.k));
    const valueType = raw && toItemType(raw) === item.t ? raw : item.t;
    await api.upsert({
      service_name: item.s,
      key: item.k,
      value: item.v,
      value_type: valueType,
      reason,
    });
  },

  async remove(item: Item, reason: string) {
    await api.remove({ service_name: item.s, key: item.k, reason });
  },

  async rollback(item: Item, revision: number, reason: string) {
    await api.rollback({ service_name: item.s, key: item.k, revision, reason });
  },

  async history(item: Item) {
    const res = await api.history({ service_name: item.s, key: item.k, page: 1, page_size: 20 });
    return res.items ?? [];
  },

  async importBulk(entries, replaceExisting, reason) {
    const res = await api.importBulk({ entries, replace_existing: replaceExisting, reason });
    return res.results ?? [];
  },

  async effective(scope, domain, group) {
    const view = await api.effective({ service_name: scope || undefined, domain, group });
    return (view.items ?? []).map((row) => toEffectiveRow(row, scope));
  },

  async editor(domain, group) {
    try {
      const record = await api.editors({ domain, group });
      return toGroupEditor(record);
    } catch (err) {
      if (err instanceof api.ApiError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }
  },

  async exportConfig(format) {
    return api.exportConfig(format);
  },

  async previewImport(entries) {
    // 后端为权威预检（与 /import 同一套规则）；剥掉本地 masked 字段再提交。
    const body = entries.map((e) => ({
      service_name: e.service_name,
      key: e.key,
      value: e.value,
      value_type: e.value_type,
      validation: e.validation,
    }));
    return api.previewImport({ entries: body });
  },

  async consumers(key) {
    const res = await api.consumers(key);
    return { key: res.key, services: res.services ?? [], source: res.source, note: res.note };
  },

  reset() {
    /* api 模式禁用本地持久化：无「重置」 */
  },
};

export const store: Store = DATA_MODE === 'api' ? apiStore : mockStore;

/** UI 统一错误文案（ApiError 带状态码，其余取 message）。 */
export function errorText(err: unknown): string {
  if (err instanceof api.ApiError) {
    if (err.status === 403) return `无权限：${err.message}`;
    if (err.status === 503) return `服务暂不可用：${err.message}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 状态码提取（供 403 / 401 分流）。 */
export function errorStatus(err: unknown): number {
  return err instanceof api.ApiError ? err.status : 0;
}
