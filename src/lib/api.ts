/**
 * 配置中心管理面 API 客户端（`/api/v1/admin/config`，网关 `/bff/config/...`）。
 *
 * 契约见 `butler/plan/config-console/API.md`：
 *   - 鉴权：`Authorization: Bearer <JWT>` + `X-Tenant-ID` + `X-App-ID`；
 *   - 读：`GET /items /item /effective /groups /history /editors`；
 *   - 写：`POST /item`、`DELETE /item`、`POST /rollback`、`POST /import`（reason 必填 1–200 字）；
 *   - 错误：RFC 7807 problem JSON（`title` / `detail` / `code`），401 无令牌、403 无权限、503 审计或装配不可用。
 *
 * 租户/应用一律取自登录令牌（后端会以 JWT 为准做一致性校验），`VITE_TENANT_ID` / `VITE_APP_ID` 只做兜底。
 */
import { refreshSession, currentSession } from './auth';
import { API_BASE, APP_ID, AUTH_MODE, TENANT_ID } from './config';

/** 管理面错误（统一携带 HTTP 状态与业务错误码，便于 UI 分流 401/403/503）。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, message: string, code = '', detail = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** 401 事件：由 App 监听后切到「需要登录」状态。 */
export const UNAUTHORIZED_EVENT = 'config-console:unauthorized';

type ProblemBody = { title?: string; detail?: string; code?: string; status?: number; message?: string } | null;

export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** 内部用：401 后已重试过一次 */
  retried?: boolean;
  timeoutMs?: number;
};

function scopeHeaders(): Record<string, string> {
  const session = currentSession();
  const headers: Record<string, string> = {};
  const tenant = session?.user.tenantId || TENANT_ID;
  const app = session?.user.appId || APP_ID;
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  // 后端 ExtractTenantFromHeaderStrict 要求该头必填；值为空时交给后端判 401（不伪造）。
  if (tenant) headers['X-Tenant-ID'] = tenant;
  if (app) headers['X-App-ID'] = app;
  return headers;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseProblem(res: Response): Promise<ProblemBody> {
  try {
    return (await res.json()) as ProblemBody;
  } catch {
    return null;
  }
}

function problemMessage(res: Response, problem: ProblemBody): string {
  const detail = problem?.detail || problem?.message || problem?.title;
  if (detail) return `${detail}（HTTP ${res.status}${problem?.code ? ` · ${problem.code}` : ''}）`;
  if (res.status === 401) return '未登录或登录已过期（HTTP 401）';
  if (res.status === 403) return '无权限：需要 config:read / config:write / config:publish（HTTP 403）';
  if (res.status === 503) return '服务暂不可用（审计/鉴权装配缺失，写面 fail-closed；HTTP 503）';
  return `请求失败（HTTP ${res.status}）`;
}

/** 统一请求入口：带作用域头、可被 401 触发一次静默续期、错误归一为 ApiError。 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options, 'application/json');
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, '响应不是合法 JSON');
  }
}

/**
 * 取原始文本（导出接口返回 JSON/YAML 文件体，不是统一 JSON 信封）。
 * 401 重试/错误归一口径与 request 完全一致。
 */
export async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
  const res = await send(path, { timeoutMs: 60_000, ...options }, '*/*');
  return res.text();
}

/**
 * 发请求并归一错误（401 可静默续期一次）。`request` / `requestText` 共用本函数，
 * 保证鉴权、超时、错误文案只有一套实现。
 */
async function send(path: string, options: RequestOptions, accept: string): Promise<Response> {
  const { method = 'GET', query, body, retried = false, timeoutMs = 20_000 } = options;
  const headers: Record<string, string> = { Accept: accept, ...scopeHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch (cause) {
    const aborted = (cause as Error)?.name === 'AbortError';
    throw new ApiError(0, aborted ? `请求超时（${timeoutMs / 1000}s）` : `无法连接配置中心：${(cause as Error).message}`);
  } finally {
    window.clearTimeout(timer);
  }

  if (res.status === 401) {
    if (!retried && AUTH_MODE === 'oidc') {
      const renewed = await refreshSession();
      if (renewed) return send(path, { ...options, retried: true }, accept);
    }
    const problem = await parseProblem(res);
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(401, problemMessage(res, problem), problem?.code ?? 'unauthorized', problem?.detail ?? '');
  }

  if (!res.ok) {
    const problem = await parseProblem(res);
    throw new ApiError(res.status, problemMessage(res, problem), problem?.code ?? '', problem?.detail ?? '');
  }
  return res;
}

/* ------------------------------- 响应形状 ------------------------------- */

/** 管理面条目 = config_items 行 + taxonomy 推导的 domain/group（service_admin_read.go AdminItem）。 */
export type ApiItem = {
  id: string;
  tenant_id: string;
  app_id: string;
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  validation?: string;
  revision: number;
  md5?: string;
  status?: string;
  description?: string;
  owner?: string;
  group_name?: string;
  tags?: string[] | null;
  sensitive?: boolean;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  /** 生效配置域（后端 taxonomy 推导） */
  domain: string;
  /** 生效配置组 */
  group: string;
  /** 敏感项遮罩标记（true 时 `value` 是占位 `••••••`，需 POST /reveal 才拿到明文）。 */
  masked?: boolean;
};

export type ListItemsResult = { items: ApiItem[]; total: number; page: number; page_size: number };

export type GetItemResult = ApiItem & { source: 'exact' | 'inherit' };

export type EffectiveItem = {
  key: string;
  value: string;
  value_type: string;
  source: 'base' | 'inherit' | 'override';
  base_value: string | null;
  revision: number;
  description?: string;
  owner?: string;
  domain: string;
  group: string;
  sensitive: boolean;
  /** 敏感项遮罩标记（true 时 `value` / `base_value` 是占位，需 POST /reveal）。 */
  masked?: boolean;
};

export type EffectiveResult = { service_name: string; revision: number; items: EffectiveItem[] };

export type GroupStat = { group: string; count: number; base: number; svc: number; services: number };
export type DomainStat = { domain: string; count: number; base: number; svc: number; groups: GroupStat[] };
export type GroupsResult = { domains: DomainStat[] };

export type HistoryItem = {
  id: string;
  item_id?: string;
  service_name: string;
  key: string;
  revision: number;
  value: string;
  value_type: string;
  created_by?: string;
  created_at?: string;
  reason?: string;
  changeset_id?: string;
};

export type HistoryResult = { items: HistoryItem[]; total: number; page: number; page_size: number };

export type EditorField = {
  label: string;
  keys?: string[];
  kind?: string;
  secret?: string[];
  secretRef?: boolean;
  hint?: string;
};

export type EditorSchema = { note?: string; fields?: EditorField[]; actions?: string[] };

export type EditorRecord = {
  id?: string;
  tenant_id?: string;
  app_id?: string;
  domain: string;
  group_name: string;
  schema: EditorSchema;
  version?: number;
};

/* --------------------------------- 读面 --------------------------------- */

export type ListItemsQuery = {
  service_name?: string;
  domain?: string;
  group?: string;
  key_prefix?: string;
  page?: number;
  page_size?: number;
  include_deleted?: boolean;
};

export function listItems(query: ListItemsQuery = {}): Promise<ListItemsResult> {
  return request<ListItemsResult>('/items', { query: { ...query } });
}

/**
 * 拉全量条目（管理面按页返回，页大小上限由共享 dto 归一为 100）。
 * 管理面一次需要「跨服务 + 基座」全量才能构建域/组树。
 *
 * 并发策略：**第 1 页先取**拿到 `total`，由此推导总页数 `ceil(total / pageSize)`（受 `maxPages` 限制），
 * 其余页用固定并发池拉取（上限 {@link LIST_CONCURRENCY}）。语义与顺序翻页保持一致：
 * 按 `id || service|key` 去重、结果顺序 = 页序 + 页内序、任一路径失败整体 reject。
 * （实测 2,025 条约 21 页：由「21 次串行」降为「1 + 20 并发」≈ 6 个来回。）
 */
export async function listAllItems(pageSize = 100, maxPages = 200): Promise<ApiItem[]> {
  if (maxPages <= 0) return [];

  const first = await listItems({ page: 1, page_size: pageSize });
  const pages: ListItemsResult[] = [first];

  const total = typeof first.total === 'number' && Number.isFinite(first.total) ? first.total : null;
  const firstCount = (first.items ?? []).length;
  // 页数：第 1 页就不满一页 → 只有 1 页（与顺序翻页的「提前结束」等价）；
  // total 缺失 → 退化为顺序翻页（null）；否则 ceil(total/pageSize)，受 maxPages 限制。
  let knownPages: number | null;
  if (firstCount < pageSize) knownPages = 1;
  else if (total === null) knownPages = null;
  else knownPages = Math.min(maxPages, Math.max(1, Math.ceil(total / Math.max(1, pageSize))));

  if (knownPages === null) {
    // 后端未回 total（理论不会发生）：退化为顺序翻页，保持原语义不变。
    for (let page = 2; page <= maxPages; page += 1) {
      const res = await listItems({ page, page_size: pageSize });
      pages.push(res);
      if ((res.items ?? []).length < pageSize) break;
    }
  } else {
    const rest = Array.from({ length: knownPages - 1 }, (_, i) => i + 2);
    pages.push(...(await poolMap(rest, LIST_CONCURRENCY, (page) => listItems({ page, page_size: pageSize }))));
  }

  const out: ApiItem[] = [];
  const seen = new Set<string>();
  for (const res of pages) {
    const batch = res.items ?? [];
    for (const row of batch) {
      const id = row.id || `${row.service_name}|${row.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
    if (batch.length < pageSize) break;
    if (typeof res.total === 'number' && out.length >= res.total) break;
  }
  return out;
}

/** 全量翻页的并发上限（逐页请求较贵，4 路足够把 21 页压到 6 个来回且不打爆网关）。 */
const LIST_CONCURRENCY = 4;

/** 固定并发度的 map：保持结果下标与输入一致；任一任务失败整体 reject。 */
async function poolMap<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function getItem(serviceName: string, key: string): Promise<GetItemResult> {
  return request<GetItemResult>('/item', { query: { service_name: serviceName, key } });
}

/** 契约名别名（API.md §2 `GET /item`）。 */
export const item = getItem;

export function effective(query: { service_name?: string; domain?: string; group?: string; key_prefix?: string }): Promise<EffectiveResult> {
  return request<EffectiveResult>('/effective', { query: { ...query } });
}

export function groups(): Promise<GroupsResult> {
  return request<GroupsResult>('/groups');
}

export function history(query: { service_name?: string; key: string; page?: number; page_size?: number }): Promise<HistoryResult> {
  return request<HistoryResult>('/history', { query: { page: 1, page_size: 20, ...query } });
}

/**
 * 变更记录（跨键、跨服务，`GET /changes`，需 config:read）。
 *
 * 排序由服务端保证 `created_at DESC, id DESC`；`from` / `to` 为 RFC3339 串
 * （`+08:00` 这类偏移由 `URLSearchParams` 编码，调用方不必手写 encodeURIComponent）。
 * 空值（`''` / `null` / `undefined`）由 `buildUrl` 自动剔除 = 不过滤。
 */
export type ChangesQuery = {
  service_name?: string;
  domain?: string;
  group?: string;
  key_prefix?: string;
  created_by?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
};

export function changes(query: ChangesQuery = {}): Promise<HistoryResult> {
  return request<HistoryResult>('/changes', { query: { page: 1, page_size: 50, ...query } });
}

/** 读组编辑器 schema；不存在时后端 404（调用方用默认表单）。 */
export function editors(query: { domain: string; group: string }): Promise<EditorRecord> {
  return request<EditorRecord>('/editors', { query: { ...query } });
}

/** 写编辑器 schema（PUT /editors，需 config:write）。当前控制台不暴露入口，保留给后续变更单流程。 */
export function saveEditor(input: { domain: string; group: string; schema: EditorSchema }): Promise<EditorRecord> {
  return request<EditorRecord>('/editors', { method: 'PUT', body: { ...input } });
}

/* --------------------------------- 写面 --------------------------------- */

/** 所有写操作必须带原因（1–200 字），后端写审计。 */
export function assertReason(reason: string): string {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ApiError(400, '请填写变更原因（1–200 字）', 'invalid_param');
  if (trimmed.length > 200) throw new ApiError(400, '变更原因超长（≤200 字）', 'invalid_param');
  return trimmed;
}

export type UpsertInput = {
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  validation?: string;
  reason: string;
};

export function upsert(input: UpsertInput): Promise<{ item: ApiItem; changed: boolean; revision: number }> {
  return request('/item', {
    method: 'POST',
    body: {
      service_name: input.service_name,
      key: input.key,
      value: input.value,
      value_type: input.value_type,
      validation: input.validation ?? '',
      reason: assertReason(input.reason),
    },
  });
}

export function remove(input: { service_name: string; key: string; reason: string }): Promise<{ deleted: boolean }> {
  return request('/item', {
    method: 'DELETE',
    body: { service_name: input.service_name, key: input.key, reason: assertReason(input.reason) },
  });
}

export function rollback(input: { service_name: string; key: string; revision: number; reason: string }): Promise<{ item: ApiItem; revision: number }> {
  return request('/rollback', {
    method: 'POST',
    body: {
      service_name: input.service_name,
      key: input.key,
      revision: input.revision,
      reason: assertReason(input.reason),
    },
  });
}

export type ImportEntry = {
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  validation?: string;
};

export type ImportOutcome = { service_name: string; key: string; ok: boolean; error?: string };

export function importBulk(input: { entries: ImportEntry[]; replace_existing?: boolean; reason: string }): Promise<{
  results: ImportOutcome[];
  applied: number;
  rejected: number;
  skipped?: number;
}> {
  return request('/import', {
    method: 'POST',
    body: {
      replace_existing: Boolean(input.replace_existing),
      reason: assertReason(input.reason),
      entries: input.entries,
    },
  });
}

/* ------------------------ 导出 / 导入预检 / 影响面（CC-12） ------------------------ */

export type ExportFormat = 'json' | 'yaml';

/**
 * 全量导出（`GET /export`）：返回文件体（JSON 或 YAML 文本，同一结构）。
 * 敏感/密钥项已由服务端替换为遮罩占位（`masked` item），绝不携带真实密钥值。
 */
export function exportConfig(format: ExportFormat): Promise<string> {
  return requestText('/export', { query: { format } });
}

/** 导入预检条目（与 /import 的 entries 同结构；tenant/app 由令牌决定）。 */
export type ImportPreviewRow = {
  service_name: string;
  key: string;
  action: 'create' | 'update' | 'unchanged' | 'invalid' | 'skipped';
  value: string;
  value_type: string;
  current_value?: string | null;
  reason?: string;
};

export type ImportPreviewCounts = { create: number; update: number; unchanged: number; invalid: number; skipped: number };

/** 导入预检结果：`writable=false` 表示存在 invalid（提交会被整批拒绝）。 */
export type ImportPreviewResult = { items: ImportPreviewRow[]; counts: ImportPreviewCounts; writable: boolean };

/** 导入预检（`POST /import/preview`）：**只读**，不写库、不产生 revision。 */
export function previewImport(input: { entries: ImportEntry[] }): Promise<ImportPreviewResult> {
  return request('/import/preview', { method: 'POST', body: { entries: input.entries } });
}

/** 影响面：该键可能被哪些服务读取（数据源 = allowlist；不可达时 source=unavailable）。 */
export type ConsumersResult = {
  key: string;
  services: string[];
  source: 'allowlist' | 'unavailable';
  note?: string;
};

export function consumers(key: string): Promise<ConsumersResult> {
  return request('/consumers', { query: { key } });
}

/* ------------------------------- 查看明文（reveal） ------------------------------- */

/**
 * 查看明文入参：`service_name` 省略 / 空串 = 平台基座作用域，`key` 必填，
 * `reason` 必填 1–200 字（后端每次查看都写审计，前端只做同名归一校验）。
 */
export type RevealInput = { service_name?: string; key: string; reason: string };

/** 查看明文结果：`source=inherit` 表示该键在目标服务下继承自基座。 */
export type RevealResult = {
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  revision: number;
  source: 'exact' | 'inherit';
  masked: boolean;
};

/**
 * 查看单个敏感项的明文（`POST /reveal`，需 `config:write`；无权限 → 403）。
 *
 * 明文**不得**持久化：调用方只允许放进内存缓存（`lib/reveal.ts` 的 `RevealCache`），
 * 关闭抽屉 / 保存成功后立即清除。
 */
export function reveal(input: RevealInput): Promise<RevealResult> {
  return request<RevealResult>('/reveal', {
    method: 'POST',
    body: {
      service_name: input.service_name || '',
      key: input.key,
      reason: assertReason(input.reason),
    },
  });
}

/* --------------------------------- 变更单 --------------------------------- */

/**
 * 变更单（`/changesets`，CC-04）：把一批待生效条目存成草稿，确认后一次性发布。
 *
 * 契约（后端 T15）：
 *   - `POST   /changesets`                     （config:write，title/reason 各 1–200，entries 1–200 条）
 *   - `GET    /changesets?status=&page=&page_size=` （config:read，status 空 = 全部）
 *   - `GET    /changesets/{id}`                （config:read，entries[].value 已遮罩 `••••••`）
 *   - `POST   /changesets/{id}/publish`        （config:publish，仅 draft；非 draft → 400）
 *   - `POST   /changesets/{id}/reject`         （config:write，仅 draft）
 * 发布/拒绝都必须带 `reason`（1–200 字，写审计）。
 */

/** 变更单条目入参（与 `/import` 的 entries 同形；`validation` 可空）。 */
export type ChangesetEntryInput = {
  service_name: string;
  key: string;
  value: string;
  value_type: string;
  validation?: string;
};

/** 变更单条目（详情返回；`value` 已按读面规则遮罩，前端只做原样展示）。 */
export type ChangesetEntry = ChangesetEntryInput;

export type ChangesetStatus = 'draft' | 'published' | 'rejected';

export type Changeset = {
  id: string;
  title: string;
  reason: string;
  status: ChangesetStatus;
  entry_count: number;
  created_by: string;
  created_at: string;
  published_by?: string;
  published_at?: string | null;
  rejected_by?: string;
  rejected_at?: string | null;
  reject_reason?: string;
};

export type ChangesetDetail = { changeset: Changeset; entries: ChangesetEntry[] };

export type ListChangesetsResult = { items: Changeset[]; total: number; page: number; page_size: number };

/** `/changesets` 的 query（`status` 空串由 `buildUrl` 剔除 = 不过滤）。 */
export type ListChangesetsQuery = { status?: ChangesetStatus | ''; page?: number; page_size?: number };

export function listChangesets(query: ListChangesetsQuery = {}): Promise<ListChangesetsResult> {
  return request<ListChangesetsResult>('/changesets', {
    query: { status: query.status, page: query.page, page_size: query.page_size },
  });
}

export function getChangeset(id: string): Promise<ChangesetDetail> {
  return request<ChangesetDetail>(`/changesets/${encodeURIComponent(id)}`);
}

/** 标题校验口径与 reason 一致（1–200 字，去两端空白）。 */
function assertTitle(title: string): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) throw new ApiError(400, '请填写变更单标题（1–200 字）', 'invalid_param');
  if (trimmed.length > 200) throw new ApiError(400, '变更单标题超长（≤200 字）', 'invalid_param');
  return trimmed;
}

/** 创建变更单（草稿）。条目只发后端认识的字段，本地标记不随请求外泄。 */
export function createChangeset(input: {
  title: string;
  reason: string;
  entries: ChangesetEntryInput[];
}): Promise<ChangesetDetail> {
  return request<ChangesetDetail>('/changesets', {
    method: 'POST',
    body: {
      title: assertTitle(input.title),
      reason: assertReason(input.reason),
      entries: (input.entries ?? []).map((e) => ({
        service_name: e.service_name,
        key: e.key,
        value: e.value,
        value_type: e.value_type,
        validation: e.validation ?? '',
      })),
    },
  });
}

export type PublishChangesetResult = { id: string; status: ChangesetStatus; applied: number; changed: number };

/** 发布（需 config:publish）：把草稿条目逐条落库并把 `changeset_id` 写进版本流水。 */
export function publishChangeset(id: string, input: { reason: string }): Promise<PublishChangesetResult> {
  return request<PublishChangesetResult>(`/changesets/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: { reason: assertReason(input.reason) },
  });
}

export type RejectChangesetResult = { id: string; status: ChangesetStatus };

/** 拒绝（需 config:write）：仅 draft 可拒绝，写入 `reject_reason`。 */
export function rejectChangeset(id: string, input: { reason: string }): Promise<RejectChangesetResult> {
  return request<RejectChangesetResult>(`/changesets/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { reason: assertReason(input.reason) },
  });
}
