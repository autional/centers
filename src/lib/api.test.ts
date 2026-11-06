/**
 * api.ts 单测（`environment: 'node'`，mock `globalThis.fetch`，不真连网）：
 *   - `listAllItems` 并发翻页：页数按第 1 页的 `total` 推导（不多请求一页）、并发度 ≤ 4；
 *   - 顺序稳定（= 页序 + 页内序）、`id || service|key` 去重；
 *   - 任一页失败 → 整体 reject（不静默吞）。
 *
 * 注：`config.ts` / `api.ts` 在模块初始化/建 URL 时读 `window.location`，
 * node 环境用 `vi.hoisted` 垫一个最小 window（必须在 import 之前生效）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) {
    g.window = {
      location: { origin: 'http://localhost:13120', pathname: '/', search: '', hash: '' },
      setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id: number) => globalThis.clearTimeout(id),
      dispatchEvent: () => true,
    };
  }
});

import { listAllItems } from './api';
import type { ApiItem } from './api';

function item(index: number, id = `item-${index}`): ApiItem {
  return {
    id,
    tenant_id: '',
    app_id: '',
    service_name: 'svc',
    key: `k.${index}`,
    value: 'v',
    value_type: 'scalar',
    revision: 1,
    domain: '运行与接口',
    group: '服务与端口',
  };
}

type FetchState = { active: number; peak: number; pages: number[] };

/**
 * 装一个按页返回 `{items,total,page,page_size}` 的 fetch mock。
 * `override(page)` 可替换某页的条目（用于构造重复键 / 短页）。
 */
function installFetch(opts: {
  total: number;
  delayMs?: number;
  failPage?: number;
  override?: (page: number) => ApiItem[] | null;
}) {
  const state: FetchState = { active: 0, peak: 0, pages: [] };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('page_size') ?? '100');
    state.pages.push(page);
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    try {
      // 让并发请求有时间重叠，否则峰值永远是 1
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 2));
      if (opts.failPage === page) {
        return new Response(JSON.stringify({ title: 'boom' }), { status: 500 });
      }
      const custom = opts.override?.(page) ?? null;
      const start = (page - 1) * pageSize;
      const end = Math.min(start + pageSize, opts.total);
      const items = custom ?? Array.from({ length: Math.max(0, end - start) }, (_, i) => item(start + i));
      return new Response(JSON.stringify({ items, total: opts.total, page, page_size: pageSize }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      state.active -= 1;
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listAllItems 并发翻页', () => {
  it('total=250 / page_size=100 → 3 页、250 条、顺序稳定、并发峰值 2..4', async () => {
    const { state } = installFetch({ total: 250 });

    const rows = await listAllItems(100);

    expect(rows).toHaveLength(250);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 250 }, (_, i) => `item-${i}`));
    // 只请求 1..3 页（第 4 页不存在，不得多拉）
    expect([...state.pages].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // 第 1 页单独先发，其余页并发：峰值 ≥ 2 且 ≤ 4
    expect(state.peak).toBeGreaterThanOrEqual(2);
    expect(state.peak).toBeLessThanOrEqual(4);
  });

  it('并发度上限 4（total=1050 → 11 页）', async () => {
    const { state } = installFetch({ total: 1050, delayMs: 3 });

    const rows = await listAllItems(100);

    expect(rows).toHaveLength(1050);
    expect(state.pages).toHaveLength(11);
    expect(state.peak).toBeLessThanOrEqual(4);
  });

  it('跨页重复键按 id 去重且顺序不变', async () => {
    // 第 1 页 [A,B]，第 2 页 [B,C]：B 与第 1 页重复
    installFetch({
      total: 3,
      override: (page) => (page === 1 ? [item(0, 'A'), item(1, 'B')] : [item(1, 'B'), item(2, 'C')]),
    });

    const rows = await listAllItems(2);

    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  it('任一页失败 → 整体 reject', async () => {
    installFetch({ total: 250, failPage: 2 });

    await expect(listAllItems(100)).rejects.toMatchObject({ status: 500 });
  });
});
