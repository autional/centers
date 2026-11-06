/**
 * 「查看明文」（reveal）的前端纯逻辑：遮罩判定 / 展示文案 / 原因校验 / 进程内明文缓存。
 *
 * 设计约束（契约 see `lite/cfg-reveal-fe/requirements-dev.md`）：
 *   - 明文**只允许**停留在内存（{@link RevealCache}），**禁止**写入任何浏览器持久化存储
 *     （Web Storage / IndexedDB / cookie 一律不用）——每次查看都由后端写审计，
 *     刷新或关闭抽屉即散失；
 *   - 本模块是纯逻辑 + 一个模块级 Map，不触碰 DOM，`environment: 'node'` 下可直接单测；
 *   - 遮罩判定同时认后端标记（`masked === true`）与历史占位字面量（`'••••••'`），
 *     这样旧响应（只有占位值、没有 masked 字段）也不会把假值当成真实值。
 */

/** 后端遮罩占位（T10-BE 读面返回的字面量）。 */
export const MASK_PLACEHOLDER = '••••••';

/** 遮罩项在 UI 上的展示文案。 */
export const MASK_TEXT = '已脱敏';

/** 查看原因长度上限（与后端 `reason` 1–200 字一致）。 */
export const REVEAL_REASON_MAX = 200;

/**
 * 可判定遮罩的最小形状：后端行用 `value`，前端 `Item` 用 `v`，两者都接受。
 * 这样 `isMasked` / `maskText` 既能在数据层用（ApiItem / EffectiveItem），也能在 UI 层用（Item）。
 */
export type Maskable = { masked?: boolean; value?: string; v?: string };

function rawValue(item: Maskable | null | undefined): string {
  if (!item) return '';
  const value = item.value ?? item.v;
  return typeof value === 'string' ? value : '';
}

/** 是否为遮罩项：后端标记优先，其次认占位字面量。 */
export function isMasked(item: Maskable | null | undefined): boolean {
  if (!item) return false;
  return item.masked === true || rawValue(item) === MASK_PLACEHOLDER;
}

/** 展示文案：遮罩项 → `已脱敏`，否则原值（`undefined` / `null` → 空串）。 */
export function maskText(item: Maskable | null | undefined): string {
  if (!item) return '';
  return isMasked(item) ? MASK_TEXT : rawValue(item);
}

export type ReasonCheck = { ok: boolean; value: string; error?: string };

/**
 * 校验查看原因：去首尾空白后按**字符**（码点）计 1–200 字。
 * 返回规范化后的值（已 trim），调用方直接拿去发请求，避免前后端重复 trim。
 */
export function validateReason(reason: string | null | undefined): ReasonCheck {
  const value = String(reason ?? '').trim();
  const length = Array.from(value).length;
  if (length === 0) return { ok: false, value, error: `请填写查看原因（1–${REVEAL_REASON_MAX} 字）` };
  if (length > REVEAL_REASON_MAX) return { ok: false, value, error: `查看原因超长（≤${REVEAL_REASON_MAX} 字）` };
  return { ok: true, value };
}

/** 缓存键：`<service_name>|<key>`（基座作用域 service_name 为空串）。 */
function cacheId(serviceName: string | undefined, key: string): string {
  return `${serviceName ?? ''}|${key}`;
}

/** 模块级明文缓存：进程内有效，**不落任何持久化存储**。 */
const plaintext = new Map<string, string>();

/**
 * 明文缓存（进程内）。
 *
 * - `put` / `get` 以 `service_name + key` 定位（同一键在不同作用域可以是不同值）；
 * - `clear()` 全清；`clear({ key })` 清该键的所有作用域（抽屉关闭时用）；
 * - `clear({ service_name, key })` 清单条（保存成功后用）。
 */
export const RevealCache = {
  put(serviceName: string | undefined, key: string, value: string): void {
    plaintext.set(cacheId(serviceName, key), value);
  },

  get(serviceName: string | undefined, key: string): string | undefined {
    return plaintext.get(cacheId(serviceName, key));
  },

  clear(target?: { service_name?: string; key?: string }): void {
    if (!target) {
      plaintext.clear();
      return;
    }
    const { service_name: serviceName, key } = target;
    if (key !== undefined) {
      if (serviceName !== undefined) {
        plaintext.delete(cacheId(serviceName, key));
        return;
      }
      // 只给 key：清掉该键在所有作用域的明文（`<service>|<key>`，service 不含 `|`）。
      for (const id of Array.from(plaintext.keys())) {
        const sep = id.indexOf('|');
        if (sep >= 0 && id.slice(sep + 1) === key) plaintext.delete(id);
      }
      return;
    }
    if (serviceName !== undefined) {
      const prefix = `${serviceName}|`;
      for (const id of Array.from(plaintext.keys())) {
        if (id.startsWith(prefix)) plaintext.delete(id);
      }
    }
  },
};
