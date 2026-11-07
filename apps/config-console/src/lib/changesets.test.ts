/**
 * `lib/changesets.ts` 单测（`environment: 'node'`，纯函数，不触网/不碰 DOM）：
 *   - 三态标签/颜色齐全 + 未知状态兜底；
 *   - 查询串：空 `status` 不出现、分页默认值（1 / 20）、非法值回落；
 *   - 导入预览 → 变更单条目：只留 create/update，字段不外泄，空入参安全；
 *   - 发布/拒绝闸门：仅 draft 为真。
 */
import { describe, expect, it } from 'vitest';

import type { ImportPreviewRow } from './api';
import {
  CHANGESETS_PAGE_SIZE,
  STATUS_COLOR,
  STATUS_FILTER_OPTIONS,
  STATUS_LABEL,
  buildChangesetQuery,
  canPublish,
  canReject,
  isValidText,
  statusColor,
  statusLabel,
  toChangesetEntries,
} from './changesets';

function row(over: Partial<ImportPreviewRow> = {}): ImportPreviewRow {
  return {
    service_name: 'svc-a',
    key: 'log.level',
    action: 'update',
    value: 'debug',
    value_type: 'scalar',
    ...over,
  };
}

describe('STATUS_LABEL / statusColor', () => {
  it('三态齐全（草稿 / 已发布 / 已拒绝）', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(['draft', 'published', 'rejected']);
    expect(STATUS_LABEL.draft).toBe('草稿');
    expect(STATUS_LABEL.published).toBe('已发布');
    expect(STATUS_LABEL.rejected).toBe('已拒绝');
    expect(Object.keys(STATUS_COLOR).sort()).toEqual(['draft', 'published', 'rejected']);
  });

  it('未知状态原样展示、颜色回落 default，空值显示 —', () => {
    expect(statusLabel('archived')).toBe('archived');
    expect(statusColor('archived')).toBe('default');
    expect(statusLabel('')).toBe('—');
    expect(statusLabel(null)).toBe('—');
  });

  it('筛选选项含「全部」+ 三态', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual(['', 'draft', 'published', 'rejected']);
  });
});

describe('buildChangesetQuery', () => {
  it('不传参数只带分页默认值（page=1 / page_size=20）', () => {
    expect(buildChangesetQuery()).toEqual({ page: 1, page_size: CHANGESETS_PAGE_SIZE });
    expect(CHANGESETS_PAGE_SIZE).toBe(20);
  });

  it('空 status 不出现；有效 status 原样带出', () => {
    expect(Object.keys(buildChangesetQuery({ status: '' }))).not.toContain('status');
    // 运行期可能收到 URL / 后端传来的空白 status：与空串同义
    expect(Object.keys(buildChangesetQuery({ status: '   ' as never }))).not.toContain('status');
    expect(buildChangesetQuery({ status: 'draft' })).toEqual({ status: 'draft', page: 1, page_size: CHANGESETS_PAGE_SIZE });
    expect(buildChangesetQuery({ status: 'rejected' }).status).toBe('rejected');
  });

  it('非法 status / 分页值回落默认', () => {
    const query = buildChangesetQuery({
      // 运行期可能收到后端/URL 传来的脏值，这里用 as 模拟
      status: 'archived' as never,
      page: 0,
      pageSize: 0,
    });
    expect(query).toEqual({ page: 1, page_size: CHANGESETS_PAGE_SIZE });
    expect(buildChangesetQuery({ page: 3, pageSize: 50 })).toEqual({ page: 3, page_size: 50 });
    expect(buildChangesetQuery({ page: Number.NaN, pageSize: Number.NaN })).toEqual({
      page: 1,
      page_size: CHANGESETS_PAGE_SIZE,
    });
  });
});

describe('toChangesetEntries', () => {
  it('只保留 create / update，并丢弃本地字段', () => {
    const entries = toChangesetEntries([
      row({ key: 'a', action: 'create', value: '1', value_type: 'int' }),
      row({ key: 'b', action: 'update', value: '2' }),
      row({ key: 'c', action: 'unchanged' }),
      row({ key: 'd', action: 'skipped' }),
      row({ key: 'e', action: 'invalid' }),
    ]);
    expect(entries).toEqual([
      { service_name: 'svc-a', key: 'a', value: '1', value_type: 'int' },
      { service_name: 'svc-a', key: 'b', value: '2', value_type: 'scalar' },
    ]);
    // 本地预览字段（current_value / action / reason）不得出现在请求体里
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(['key', 'service_name', 'value', 'value_type']);
  });

  it('顺序与预览一致，平台基座（service_name 空串）保留', () => {
    const entries = toChangesetEntries([
      row({ service_name: '', key: 'jwt.secret', action: 'update' }),
      row({ service_name: 'svc-b', key: 'a', action: 'create' }),
    ]);
    expect(entries.map((e) => `${e.service_name}|${e.key}`)).toEqual(['|jwt.secret', 'svc-b|a']);
  });

  it('空数组 / 缺失入参 → 空数组（不会抛错）', () => {
    expect(toChangesetEntries([])).toEqual([]);
    expect(toChangesetEntries(null)).toEqual([]);
    expect(toChangesetEntries(undefined)).toEqual([]);
    expect(toChangesetEntries([row({ action: 'unchanged' })])).toEqual([]);
  });
});

describe('canPublish / canReject', () => {
  it('draft 为真', () => {
    expect(canPublish('draft')).toBe(true);
    expect(canReject('draft')).toBe(true);
  });

  it('published / rejected / 空 / 未知 为假', () => {
    for (const status of ['published', 'rejected', '', null, undefined, 'archived']) {
      expect(canPublish(status)).toBe(false);
      expect(canReject(status)).toBe(false);
    }
  });
});

describe('isValidText', () => {
  it('去空白后 1..200 字合法', () => {
    expect(isValidText('  改连接池  ')).toBe(true);
    expect(isValidText('x')).toBe(true);
    expect(isValidText('   ')).toBe(false);
    expect(isValidText('')).toBe(false);
    expect(isValidText(null)).toBe(false);
    expect(isValidText('a'.repeat(200))).toBe(true);
    expect(isValidText('a'.repeat(201))).toBe(false);
  });
});
