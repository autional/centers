/**
 * 导入 / 导出 的纯逻辑层（无 React、无网络）：解析文件、构造导出文档、计算差异。
 *
 * 设计要点：
 *   - **导出结构与后端一致**（API.md §3 `GET /export`）：`{version, exported_at, tenant_id, app_id, items:[...]}`，
 *     JSON 与 YAML 只是同一结构的两种序列化；mock 模式用本模块在浏览器本地生成，api 模式直接用后端文件体。
 *   - **导出不含密钥值**：后端/演示数据里敏感项的值是遮罩占位（`••••••`），本模块只搬运，不做明文兜底。
 *   - **导入只做预览计算**：解析 → 归一 → 与现有条目逐条比对（create/update/unchanged/invalid/skipped），
 *     本身不写任何存储；提交由 UI 在 api 模式调用 `/import`（mock 模式仅预览）。
 *   - 遮罩占位项（`masked: true` 或值等于占位）一律 skipped：绝不把占位值回灌成真实配置。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ExportFormat, ImportEntry, ImportPreviewCounts, ImportPreviewResult, ImportPreviewRow } from './api';
import { itemId, toItemType } from './model';
import type { Item } from './model';

/** 导出结构版本（与后端 service.ExportSchemaVersion 对齐）。 */
export const EXPORT_VERSION = 1;
/** 遮罩占位（与后端 service.ExportMaskPlaceholder 同字面量）。 */
export const MASK_PLACEHOLDER = '••••••';

/** 导入条目上限（防超大文件把浏览器打满）。 */
const MAX_IMPORT_ENTRIES = 5000;
const MAX_KEY_LEN = 512;
const MAX_SERVICE_LEN = 64;
const MAX_VALUE_BYTES = 1 << 20;
const VALUE_TYPES = new Set(['scalar', 'int', 'bool', 'yaml', 'json', 'text']);

export type ExportItem = {
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  validation?: string;
  description?: string;
  owner?: string;
  domain: string;
  group: string;
  tags?: string[];
  sensitive: boolean;
  masked: boolean;
  revision: number;
};

export type ExportDoc = {
  version: number;
  exported_at: string;
  tenant_id: string;
  app_id: string;
  items: ExportItem[];
  masked_count: number;
};

/** 前端展示类型 → 后端 value_type（与 lib/data.ts 的 toItemType 反向对应）。 */
export function toValueType(type: Item['t']): string {
  switch (type) {
    case 'int':
      return 'int';
    case 'bool':
      return 'bool';
    case 'yaml':
      return 'yaml';
    default:
      return 'scalar';
  }
}

/** 用本地条目构造导出文档（mock 模式；api 模式由后端生成同结构文件）。 */
export function buildExportDoc(items: Item[], scope: { tenantId?: string; appId?: string } = {}): ExportDoc {
  const rows: ExportItem[] = items
    .map((it) => {
      const masked = it.v === MASK_PLACEHOLDER;
      return {
        service_name: it.s,
        key: it.k,
        value: it.v,
        value_type: toValueType(it.t),
        domain: it.d,
        group: it.g,
        sensitive: masked,
        masked,
        revision: 0,
      };
    })
    .sort((a, b) => (a.service_name === b.service_name ? a.key.localeCompare(b.key) : a.service_name.localeCompare(b.service_name)));
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    tenant_id: scope.tenantId ?? '',
    app_id: scope.appId ?? '',
    items: rows,
    masked_count: rows.filter((r) => r.masked).length,
  };
}

/** 序列化导出文档（JSON 2 空格 / YAML 缩进 2、不折行，便于人工 diff）。 */
export function stringifyExport(doc: ExportDoc, format: ExportFormat): string {
  if (format === 'yaml') return stringifyYaml(doc, { indent: 2, lineWidth: 0 });
  return JSON.stringify(doc, null, 2);
}

/** 导出文件名（含时间戳，避免多次下载互相覆盖）。 */
export function exportFilename(format: ExportFormat, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  return `config-export-${stamp}.${format}`;
}

/* --------------------------------- 解析 --------------------------------- */

/** 解析后的条目（带 masked 标记，提交前会剥掉该字段）。 */
export type ParsedEntry = ImportEntry & { masked?: boolean };

export type ParsedImport = {
  entries: ParsedEntry[];
  /** 文件里识别到的结构类型（仅用于提示）。 */
  format: 'json' | 'yaml';
  tenantId?: string;
  appId?: string;
};

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

/** 从一条原始记录归一为导入条目（兼容导出结构 snake_case / 前端演示结构短字段）。 */
function toParsedEntry(raw: unknown): ParsedEntry {
  const row = (raw ?? {}) as Record<string, unknown>;
  const value = asString(row.value ?? row.v);
  return {
    service_name: asString(row.service_name ?? row.serviceName ?? row.s).trim(),
    key: asString(row.key ?? row.k).trim(),
    value,
    value_type: (asString(row.value_type ?? row.valueType ?? row.type ?? row.t) || 'scalar').toLowerCase(),
    validation: asString(row.validation) || undefined,
    masked: row.masked === true || value === MASK_PLACEHOLDER,
  };
}

/**
 * 解析导入文件（先按 JSON 试，失败再按 YAML）。
 * 接受两种结构：导出结构 `{items:[...]}`，或裸条目数组 `[...]`。
 */
export function parseImportText(text: string, filename = ''): ParsedImport {
  const body = text.trim();
  if (!body) throw new Error('文件为空');
  let doc: unknown;
  let format: 'json' | 'yaml' = 'json';
  try {
    doc = JSON.parse(body);
  } catch {
    format = 'yaml';
    try {
      doc = parseYaml(body);
    } catch (err) {
      throw new Error(`无法解析文件（${filename || '未命名'}）：既不是合法 JSON 也不是合法 YAML（${(err as Error).message}）`);
    }
  }
  if (doc === null || doc === undefined) throw new Error('文件内容为空');

  let rows: unknown[];
  let tenantId: string | undefined;
  let appId: string | undefined;
  if (Array.isArray(doc)) {
    rows = doc;
  } else if (typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).items)) {
    const obj = doc as Record<string, unknown>;
    rows = obj.items as unknown[];
    tenantId = asString(obj.tenant_id) || undefined;
    appId = asString(obj.app_id) || undefined;
  } else {
    throw new Error('无法识别的结构：需要导出结构 {items:[...]} 或条目数组');
  }
  if (rows.length === 0) throw new Error('文件里没有配置项');
  if (rows.length > MAX_IMPORT_ENTRIES) throw new Error(`条目过多（${rows.length} > ${MAX_IMPORT_ENTRIES}），请拆分文件`);

  const entries = rows.map(toParsedEntry).filter((e) => e.key !== '' || e.service_name !== '' || e.value !== '');
  if (entries.length === 0) throw new Error('文件里没有可用的配置项');
  return { entries, format, tenantId, appId };
}

/* --------------------------------- 差异 --------------------------------- */

/** 单条预检（与后端 precheckEntry 的主要规则对齐；后端仍会做权威校验）。 */
export function entryProblem(e: ParsedEntry): string {
  if (!e.key) return '键为空';
  if (e.key.length > MAX_KEY_LEN) return `键超长（>${MAX_KEY_LEN}）`;
  if (e.key.includes('..') || /[/\\\n\r]/.test(e.key)) return '键含非法字符（禁 ..、路径分隔、换行）';
  if (e.service_name.length > MAX_SERVICE_LEN) return `服务名超长（>${MAX_SERVICE_LEN}）`;
  if (/[/\\\n\r]/.test(e.service_name)) return '服务名含非法字符';
  if (!VALUE_TYPES.has(e.value_type)) return `value_type 非法（${e.value_type}）`;
  if (new Blob([e.value]).size > MAX_VALUE_BYTES) return '值超限（>1MiB）';
  if (e.value_type === 'int' && !/^-?\d+$/.test(e.value.trim())) return 'int 类型的值不是整数';
  if (e.value_type === 'bool' && !['true', 'false', '1', '0'].includes(e.value.trim().toLowerCase())) return 'bool 类型的值非法';
  return '';
}

export const EMPTY_COUNTS: ImportPreviewCounts = { create: 0, update: 0, unchanged: 0, invalid: 0, skipped: 0 };

/**
 * 本地差异计算（mock 模式；api 模式以 `/import/preview` 为权威）。
 * 与后端口径一致：遮罩占位 → skipped；预检不通过 → invalid；不存在 → create；值/类型相同 → unchanged；否则 update。
 */
export function diffEntries(entries: ParsedEntry[], items: Item[]): ImportPreviewResult {
  const byId = new Map(items.map((it) => [itemId(it.s, it.k), it]));
  const counts: ImportPreviewCounts = { ...EMPTY_COUNTS };
  const rows: ImportPreviewRow[] = entries.map((e) => {
    const base: ImportPreviewRow = {
      service_name: e.service_name,
      key: e.key,
      action: 'create',
      value: e.value,
      value_type: e.value_type,
      current_value: null,
    };
    if (e.masked || e.value === MASK_PLACEHOLDER) {
      counts.skipped += 1;
      return { ...base, action: 'skipped', reason: '已脱敏项不含值（导出遮罩），回灌时跳过' };
    }
    const problem = entryProblem(e);
    if (problem) {
      counts.invalid += 1;
      return { ...base, action: 'invalid', reason: problem };
    }
    const cur = byId.get(itemId(e.service_name, e.key));
    if (!cur) {
      counts.create += 1;
      return base;
    }
    const same = cur.v === e.value && cur.t === toItemType(e.value_type);
    counts[same ? 'unchanged' : 'update'] += 1;
    return { ...base, action: same ? 'unchanged' : 'update', current_value: cur.v };
  });
  return { items: rows, counts, writable: counts.invalid === 0 };
}

/** 提交前剥掉本地字段（masked 不应发给后端）；skipped/invalid 行不提交。 */
export function toImportEntries(rows: ImportPreviewRow[]): ImportEntry[] {
  return rows
    .filter((r) => r.action === 'create' || r.action === 'update')
    .map((r) => ({ service_name: r.service_name, key: r.key, value: r.value, value_type: r.value_type }));
}

/** mock 模式的影响面演示数据：本地条目里定义过该键的服务（标注 source=demo，不冒充 allowlist）。 */
export function demoConsumers(key: string, items: Item[]): { key: string; services: string[]; source: 'demo'; note: string } {
  const services = Array.from(new Set(items.filter((it) => it.k === key && it.s).map((it) => it.s))).sort();
  return {
    key,
    services,
    source: 'demo',
    note: services.length
      ? '演示数据：按本机条目推导（真实环境读 allowlist 白名单）'
      : '演示数据：本机没有服务显式定义该键（真实环境读 allowlist 白名单）',
  };
}

/* --------------------------------- 下载 --------------------------------- */

/** 浏览器下载文本文件（导出用；不触碰网络）。 */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
