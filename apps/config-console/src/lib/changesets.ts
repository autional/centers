/**
 * 「变更单」页的纯逻辑（无 DOM / 无网络，可在 node 环境直接单测）：
 *   1. 三态标签/颜色（draft|published|rejected）；
 *   2. 筛选条件 → 查询参数（空值不出现、分页默认值）；
 *   3. 导入预览行 → 变更单条目（只取 create/update）；
 *   4. 状态 → 是否可发布 / 可拒绝（仅 draft）。
 *
 * 契约见 `lite/cfg-changeset-fe/requirements-dev.md` R1（后端 T15）：
 *   `GET /changesets?status&page&page_size` → `{ items: Changeset[], total, page, page_size }`
 *   `POST /changesets/{id}/publish|reject` 仅对 draft 生效，非 draft → 400。
 */
import type { ChangesetEntryInput, ChangesetStatus, ImportPreviewRow } from './api';

/** 默认页大小（需求：默认 20，可 20/50）。 */
export const CHANGESETS_PAGE_SIZE = 20;

/** 可选页大小（不给自由输入，避免撞后端上限）。 */
export const CHANGESETS_PAGE_SIZE_OPTIONS = [20, 50];

/** 标题 / 原因的长度上限（与后端 `title`/`reason` 1..200 对齐）。 */
export const CHANGESET_TEXT_MAX = 200;

/** 三态展示文案（后端只回这三个值；未知值由 {@link statusLabel} 兜底原样展示）。 */
export const STATUS_LABEL: Record<ChangesetStatus, string> = {
  draft: '草稿',
  published: '已发布',
  rejected: '已拒绝',
};

/** 三态标签颜色（antd Tag 的 color 值）。 */
export const STATUS_COLOR: Record<ChangesetStatus, string> = {
  draft: 'orange',
  published: 'green',
  rejected: 'red',
};

/** 状态筛选选项（`''` = 全部，即不带 `status` 参数）。 */
export const STATUS_FILTER_OPTIONS: Array<{ value: '' | ChangesetStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'draft', label: STATUS_LABEL.draft },
  { value: 'published', label: STATUS_LABEL.published },
  { value: 'rejected', label: STATUS_LABEL.rejected },
];

/** 状态 → 文案（未知状态不白屏，原样展示）。 */
export function statusLabel(status?: string | null): string {
  const text = (status ?? '').trim();
  if (!text) return '—';
  return (STATUS_LABEL as Record<string, string>)[text] ?? text;
}

/** 状态 → Tag 颜色（未知状态回落 `default`）。 */
export function statusColor(status?: string | null): string {
  const text = (status ?? '').trim();
  return (STATUS_COLOR as Record<string, string>)[text] ?? 'default';
}

/** 标题 / 原因是否合法：去两端空白后 1..200 字。 */
export function isValidText(value?: string | null, max: number = CHANGESET_TEXT_MAX): boolean {
  const text = (value ?? '').trim();
  return text.length >= 1 && text.length <= max;
}

function pageNumber(value: number | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  return int >= 1 ? int : fallback;
}

/** `/changesets` 的 query 参数（分页恒有值；`status` 为空时不出现 = 不过滤）。 */
export type ChangesetQuery = {
  status?: ChangesetStatus;
  page: number;
  page_size: number;
};

export type ChangesetQueryInput = { status?: ChangesetStatus | ''; page?: number; pageSize?: number };

/**
 * 筛选条件 → `/changesets` 的 query 参数。
 *
 * - `status` 空串 / 纯空白 / 未知值一律**不出现**（后端缺省 = 全部）；
 * - `page` / `page_size` 恒有值（默认 1 / 20），非法值回落默认。
 */
export function buildChangesetQuery(input: ChangesetQueryInput = {}): ChangesetQuery {
  const query: ChangesetQuery = {
    page: pageNumber(input.page, 1),
    page_size: pageNumber(input.pageSize, CHANGESETS_PAGE_SIZE),
  };
  const status = (input.status ?? '').trim();
  if (status === 'draft' || status === 'published' || status === 'rejected') query.status = status;
  return query;
}

/**
 * 导入预览行 → 变更单条目。
 *
 * 只保留 `create` / `update`（`unchanged` 无需写入、`skipped` 是遮罩占位、`invalid` 预检不通过），
 * 且只发后端认识的字段（本地 `action` / `current_value` / `reason` 不外泄）。顺序与预览一致。
 */
export function toChangesetEntries(rows: ImportPreviewRow[] | null | undefined): ChangesetEntryInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && (row.action === 'create' || row.action === 'update'))
    .map((row) => ({
      service_name: row.service_name,
      key: row.key,
      value: row.value,
      value_type: row.value_type,
    }));
}

/** 仅草稿可发布（后端非 draft → 400，前端先隐藏按钮）。 */
export function canPublish(status?: string | null): boolean {
  return (status ?? '').trim() === 'draft';
}

/** 仅草稿可拒绝。 */
export function canReject(status?: string | null): boolean {
  return (status ?? '').trim() === 'draft';
}

/**
 * 时间展示复用「变更记录」页的实现（RFC3339Nano → 本地时区 `YYYY-MM-DD HH:mm:ss`，非法值 → `—`），
 * 保证两个页面的时间口径完全一致。
 */
export { formatChangeTime as formatChangesetTime } from './changes';
