/**
 * `lib/changes.ts` 单测（`environment: 'node'`，纯函数，不触网/不碰 DOM）：
 *   - 查询串序列化：空值不出现、时间转 RFC3339（自然日边界）、分页默认值；
 *   - 行映射：`created_at` → 本地展示串、缺 reason/changeset/created_by 显示 `—`；
 *   - key → (domain, group) 反查：命中 / 基座 / 未命中 / 不确定；
 *   - 响应形状容错。
 *
 * 时间断言一律用「同一本地时钟构造再回读」的写法（`new Date(...)` ↔ `toISOString()`），
 * 因此不依赖运行机器的时区。
 */
import { describe, expect, it } from 'vitest';

import {
  CHANGES_PAGE_SIZE,
  buildChangesQuery,
  formatChangeTime,
  hasActiveFilters,
  locateItem,
  normalizeChanges,
  parseTimestamp,
  toChangeRow,
} from './changes';
import type { HistoryItem } from './api';
import type { Item } from './model';

function item(over: Partial<Item>): Item {
  return { s: '', k: 'db.host', t: 'scalar', v: 'x', d: '数据库', g: 'PostgreSQL', ...over };
}

function version(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 'v-1',
    item_id: 'it-1',
    service_name: 'svc-a',
    key: 'db.host',
    revision: 7,
    value: 'db.internal',
    value_type: 'scalar',
    created_by: 'alice',
    created_at: '2026-11-06T01:02:03+08:00',
    reason: '调整连接地址',
    changeset_id: 'cs-1',
    ...over,
  };
}

describe('buildChangesQuery', () => {
  it('空筛选只带分页默认值（page=1 / page_size=50）', () => {
    expect(buildChangesQuery()).toEqual({ page: 1, page_size: CHANGES_PAGE_SIZE });
  });

  it('空串与纯空白不出现，值两端空白被裁剪', () => {
    const q = buildChangesQuery({
      service_name: ' svc-a ',
      domain: '   ',
      created_by: '',
      key_prefix: 'db.',
    });
    expect(q).toEqual({ service_name: 'svc-a', key_prefix: 'db.', page: 1, page_size: CHANGES_PAGE_SIZE });
    expect(Object.keys(q)).not.toContain('domain');
    expect(Object.keys(q)).not.toContain('created_by');
  });

  it('时间按自然日边界转 RFC3339（from=当日 00:00:00.000 / to=当日 23:59:59.999 本地）', () => {
    const from = new Date(2026, 10, 1, 13, 45, 7);
    const to = new Date(2026, 10, 5, 8, 0, 1);
    const q = buildChangesQuery({ from, to });

    expect(q.from).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).toISOString());
    expect(q.to).toBe(new Date(2026, 10, 5, 23, 59, 59, 999).toISOString());
    expect(String(q.from)).toMatch(/Z$/);
    expect(String(q.to)).toMatch(/Z$/);
  });

  it('无效日期被忽略，不产生 from/to', () => {
    const q = buildChangesQuery({ from: new Date('nope'), to: null });
    expect(q).not.toHaveProperty('from');
    expect(q).not.toHaveProperty('to');
  });

  it('分页参数透传；0 / 负数 / NaN 回落默认值', () => {
    expect(buildChangesQuery({}, 3, 100)).toMatchObject({ page: 3, page_size: 100 });
    expect(buildChangesQuery({}, 0, 0)).toMatchObject({ page: 1, page_size: CHANGES_PAGE_SIZE });
    expect(buildChangesQuery({}, -2, -5)).toMatchObject({ page: 1, page_size: CHANGES_PAGE_SIZE });
    expect(buildChangesQuery({}, Number.NaN, Number.NaN)).toMatchObject({ page: 1, page_size: CHANGES_PAGE_SIZE });
  });
});

describe('formatChangeTime', () => {
  it('本地时区展示串 YYYY-MM-DD HH:mm:ss（同一本地时钟往返一致）', () => {
    const local = new Date(2026, 4, 6, 9, 3, 5);
    expect(formatChangeTime(local.toISOString())).toBe('2026-05-06 09:03:05');
  });

  it('容忍 Go RFC3339Nano 的 9 位小数秒（截断到毫秒，不 Invalid Date）', () => {
    const parsed = parseTimestamp('2026-11-06T01:02:03.123456789+08:00');
    expect(parsed?.toISOString()).toBe(new Date('2026-11-06T01:02:03.123+08:00').toISOString());
  });

  it('缺失 / 空白 / 非法 → —', () => {
    expect(formatChangeTime(undefined)).toBe('—');
    expect(formatChangeTime(null)).toBe('—');
    expect(formatChangeTime('   ')).toBe('—');
    expect(formatChangeTime('not-a-date')).toBe('—');
  });
});

describe('toChangeRow', () => {
  it('完整行：时间本地化、字段直出', () => {
    const row = toChangeRow(version());
    expect(row.id).toBe('v-1');
    expect(row.time).toBe(formatChangeTime('2026-11-06T01:02:03+08:00'));
    expect(row.timeRaw).toBe('2026-11-06T01:02:03+08:00');
    expect(row).toMatchObject({
      createdBy: 'alice',
      serviceName: 'svc-a',
      key: 'db.host',
      revision: 7,
      reason: '调整连接地址',
      changeset: 'cs-1',
    });
  });

  it('缺 reason / changeset / created_by / 时间 一律显示 —', () => {
    const row = toChangeRow({
      id: 'v-2',
      service_name: '',
      key: 'k',
      revision: 1,
      value: '',
      value_type: 'scalar',
    });
    expect(row).toMatchObject({
      time: '—',
      timeRaw: '—',
      createdBy: '—',
      reason: '—',
      changeset: '—',
      serviceName: '',
    });
  });

  it('id 缺失时用 服务|键|版本|序号 兜底（保证表格 rowKey 唯一）', () => {
    expect(toChangeRow(version({ id: '' }), 4).id).toBe('svc-a|db.host|7|4');
  });
});

describe('locateItem', () => {
  const items: Item[] = [
    item({ s: 'svc-a', k: 'db.host', d: '数据库', g: 'PostgreSQL' }),
    item({ s: 'svc-b', k: 'db.host', d: '数据库', g: 'PostgreSQL' }),
    item({ s: '', k: 'log.level', d: '日志与观测', g: '日志级别' }),
    item({ s: 'svc-a', k: 'dup.key', d: '数据库', g: 'PostgreSQL' }),
    item({ s: 'svc-b', k: 'dup.key', d: '运行与接口', g: '服务与端口' }),
  ];

  it('精确命中 (service, key)', () => {
    expect(locateItem(items, 'svc-a', 'db.host')).toEqual({ domain: '数据库', group: 'PostgreSQL' });
  });

  it('平台基座（service 为空串）命中', () => {
    expect(locateItem(items, '', 'log.level')).toEqual({ domain: '日志与观测', group: '日志级别' });
  });

  it('服务对不上但同键的组唯一 → 仍可跳转', () => {
    expect(locateItem(items, 'svc-deleted', 'db.host')).toEqual({ domain: '数据库', group: 'PostgreSQL' });
  });

  it('未命中返回 null（页面只提示，不报错）', () => {
    expect(locateItem(items, 'svc-a', 'no.such.key')).toBeNull();
    expect(locateItem(items, 'svc-a', '  ')).toBeNull();
  });

  it('同键落在多个配置组 → 不猜，返回 null', () => {
    expect(locateItem(items, 'svc-x', 'dup.key')).toBeNull();
  });
});

describe('normalizeChanges', () => {
  it('形状缺失/非法 → 空列表 + 请求页码回落', () => {
    expect(normalizeChanges(null, 2, 20)).toEqual({ items: [], total: 0, page: 2, page_size: 20 });
    expect(normalizeChanges({ items: 'nope', total: 'x' }, 3, 50)).toEqual({
      items: [],
      total: 0,
      page: 3,
      page_size: 50,
    });
  });

  it('total 缺失时用本页条数，保留响应里的 page/page_size', () => {
    const res = normalizeChanges({ items: [version()], page: 4, page_size: 50 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.page).toBe(4);
    expect(res.page_size).toBe(50);
  });

  it('丢弃数组里的空元素（不因脏行渲染崩溃）', () => {
    const res = normalizeChanges({ items: [version(), null, 0], total: 3 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(3);
  });
});

describe('hasActiveFilters', () => {
  it('空条件为 false，任一条件即 true（空白不算）', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ service_name: '  ', domain: '', created_by: ' ' })).toBe(false);
    expect(hasActiveFilters({ key_prefix: 'db.' })).toBe(true);
    expect(hasActiveFilters({ from: new Date(2026, 0, 1) })).toBe(true);
  });
});
