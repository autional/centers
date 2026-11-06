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
 * 管理面一次需要「跨服务 + 基座」全量才能构建域/组树，故这里顺序翻页。
 */
export async function listAllItems(pageSize = 100, maxPages = 200): Promise<ApiItem[]> {
  const out: ApiItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await listItems({ page, page_size: pageSize });
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
