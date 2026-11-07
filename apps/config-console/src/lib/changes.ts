/**
 * 「变更记录」页的纯逻辑（无 DOM / 无网络，可在 node 环境直接单测）：
 *   1. 筛选条件 → 查询参数（空值不出现、时间转 RFC3339、分页默认值）；
 *   2. `Version` 行（= 后端 `/changes` 返回的 item）→ 展示行（本地时区时间、缺失字段补 `—`）；
 *   3. `key` (+ 服务) → `(domain, group)` 反查，供「点击键跳到配置组」使用。
 *
 * 契约见 `lite/cfg-changes-fe/requirements-dev.md` R1（后端 T3 已实现，前端只消费）：
 *   `GET /admin/config/changes?service_name&domain&group&key_prefix&created_by&from&to&page&page_size`
 *   → `{ items: Version[], total, page, page_size }`，排序 `created_at DESC, id DESC`。
 */
import type { HistoryItem } from './api';
import type { Item } from './model';

/** 默认页大小（后端 dto 页大小上限为 100，见 lib/api.ts `listAllItems` 注释）。 */
export const CHANGES_PAGE_SIZE = 50;

/** 可选页大小（不给自由输入，避免撞后端上限）。 */
export const CHANGES_PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * 筛选条件。时间用「日」粒度的 `Date`（来自 antd DatePicker 的 `toDate()`）：
 * 选择器只选日期不选时刻，因此起止分别对齐到当天的首/末毫秒（本地时区）。
 */
export type ChangesFilters = {
  service_name?: string;
  domain?: string;
  created_by?: string;
  key_prefix?: string;
  from?: Date | null;
  to?: Date | null;
};

/** `/changes` 的 query 参数（与 `lib/api.ts` 的 `ChangesQuery` 同形；分页恒有值）。 */
export type ChangesQuery = {
  service_name?: string;
  domain?: string;
  created_by?: string;
  key_prefix?: string;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
};

function startOfDay(value?: Date | null): Date | null {
  if (!value) return null;
  const at = value.getTime();
  if (!Number.isFinite(at)) return null;
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day;
}

function endOfDay(value?: Date | null): Date | null {
  if (!value) return null;
  const at = value.getTime();
  if (!Number.isFinite(at)) return null;
  const day = new Date(at);
  day.setHours(23, 59, 59, 999);
  return day;
}

function pageNumber(value: number | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  return int >= 1 ? int : fallback;
}

/**
 * 筛选条件 → `/changes` 的 query 参数。
 *
 * - 空串 / 纯空白 / undefined 一律**不出现**在 query 里（后端缺省 = 不过滤）；
 * - `from` / `to` 取自然日边界后 `toISOString()`（RFC3339，`Z` 结尾；`URLSearchParams` 负责编码）；
 * - `page` / `page_size` 恒有值（默认 1 / 50），非法值回落默认。
 */
export function buildChangesQuery(
  filters: ChangesFilters = {},
  page: number = 1,
  pageSize: number = CHANGES_PAGE_SIZE,
): ChangesQuery {
  const query: ChangesQuery = { page: pageNumber(page, 1), page_size: pageNumber(pageSize, CHANGES_PAGE_SIZE) };
  const put = (key: 'service_name' | 'domain' | 'created_by' | 'key_prefix', raw?: string) => {
    const text = (raw ?? '').trim();
    if (text) query[key] = text;
  };
  put('service_name', filters.service_name);
  put('domain', filters.domain);
  put('created_by', filters.created_by);
  put('key_prefix', filters.key_prefix);

  const from = startOfDay(filters.from);
  if (from) query.from = from.toISOString();
  const to = endOfDay(filters.to);
  if (to) query.to = to.toISOString();

  return query;
}

/**
 * 解析后端时间串（Go `time.RFC3339Nano`，可能带 9 位小数秒；`Date` 只认 3 位）。
 * 解析失败返回 `null`，由调用方渲染 `—`（不抛错，页面不会因脏数据白屏）。
 */
export function parseTimestamp(value?: string | null): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const normalized = text.replace(/(\.\d{3})\d+/, '$1');
  const at = new Date(normalized);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 时间 → 本地时区展示串 `YYYY-MM-DD HH:mm:ss`；缺失/非法 → `—`。 */
export function formatChangeTime(value?: string | null): string {
  const at = parseTimestamp(value);
  if (!at) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/** 表格行（字段已归一，UI 不再做空值判定）。 */
export type ChangeRow = {
  /** 行唯一键（后端 id；缺失时用 服务|键|版本|序号 兜底） */
  id: string;
  /** 本地时区展示串 */
  time: string;
  /** 原始时间串（Tooltip 展示，保留时区信息） */
  timeRaw: string;
  createdBy: string;
  /** 服务名（`''` = 平台基座，展示层用 `scopeLabel`） */
  serviceName: string;
  key: string;
  revision: number;
  reason: string;
  changeset: string;
};

const DASH = '—';

function textOrDash(value?: string | null): string {
  const text = (value ?? '').trim();
  return text || DASH;
}

/** `Version` → 表格行：缺 reason / changeset / created_by 显示 `—`。 */
export function toChangeRow(item: HistoryItem, index = 0): ChangeRow {
  const serviceName = item.service_name ?? '';
  const key = item.key ?? '';
  const revision = Number.isFinite(Number(item.revision)) ? Number(item.revision) : 0;
  return {
    id: item.id || `${serviceName}|${key}|${revision}|${index}`,
    time: formatChangeTime(item.created_at),
    timeRaw: (item.created_at ?? '').trim() || DASH,
    createdBy: textOrDash(item.created_by),
    serviceName,
    key,
    revision,
    reason: textOrDash(item.reason),
    changeset: textOrDash(item.changeset_id),
  };
}

export type ItemLocation = { domain: string; group: string };

/**
 * 用已加载的配置项把 `(service_name, key)` 反查成 `(domain, group)`。
 *
 * 策略（从严到宽，任一命中即返回）：
 *   1. 精确 `(service, key)`；
 *   2. 同键的任意条目——仅当它们全部落在**同一个** `(domain, group)` 时才采用
 *      （服务被删除/改名后仍能跳转；多个组并存说明不确定，返回 `null` 不猜）。
 * 未命中返回 `null`，调用方只提示、不报错。
 */
export function locateItem(items: Item[], serviceName: string, key: string): ItemLocation | null {
  const target = (key ?? '').trim();
  if (!target) return null;
  const service = serviceName ?? '';
  const exact = items.filter((it) => it.s === service && it.k === target);
  const pool = exact.length ? exact : items.filter((it) => it.k === target);
  if (!pool.length) return null;

  const pairs = new Map<string, ItemLocation>();
  for (const it of pool) {
    const domain = it.d || '';
    const group = it.g || '';
    if (!domain) continue;
    pairs.set(`${domain}\u0000${group}`, { domain, group });
  }
  if (pairs.size !== 1) return null;
  return Array.from(pairs.values())[0] as ItemLocation;
}

export type ChangesResult = { items: HistoryItem[]; total: number; page: number; page_size: number };

/**
 * 响应形状容错：`items` 非数组按空数组处理；`total` / `page` / `page_size` 缺失或非法时回落
 * （`total` 用本页条数，`page`/`page_size` 用本次请求值）。页面因此不会因形状漂移白屏。
 */
export function normalizeChanges(raw: unknown, page = 1, pageSize = CHANGES_PAGE_SIZE): ChangesResult {
  const body = (raw ?? {}) as Partial<ChangesResult>;
  const items = Array.isArray(body.items)
    ? body.items.filter((row): row is HistoryItem => !!row && typeof row === 'object')
    : [];
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : items.length;
  return {
    items,
    total,
    page: pageNumber(body.page, page),
    page_size: pageNumber(body.page_size, pageSize),
  };
}

/** 是否设置了任何筛选（决定「空结果」文案与「重置」按钮的可用性）。 */
export function hasActiveFilters(filters: ChangesFilters): boolean {
  return Boolean(
    (filters.service_name ?? '').trim() ||
      (filters.domain ?? '').trim() ||
      (filters.created_by ?? '').trim() ||
      (filters.key_prefix ?? '').trim() ||
      filters.from ||
      filters.to,
  );
}
