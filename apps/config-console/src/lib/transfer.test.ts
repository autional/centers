/**
 * transfer.ts 单测（纯逻辑，无 DOM/网络）：
 *   - 导出结构（与后端 API.md §3 `GET /export` 对齐）
 *   - JSON / YAML 往返一致（导出 → 解析 → 逐条相同）
 *   - 遮罩项在差异计算时 skipped、提交时被过滤
 *   - `toImportEntries` 只提交 create/update 且剥掉本地字段
 *   - 非法条目（键/类型/值）判 invalid，`writable` 随之为 false
 *   - `diffEntries` 计数：create/update/unchanged/invalid/skipped
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_COUNTS,
  EXPORT_VERSION,
  MASK_PLACEHOLDER,
  buildExportDoc,
  diffEntries,
  entryProblem,
  exportFilename,
  parseImportText,
  stringifyExport,
  toImportEntries,
  toValueType,
} from './transfer';
import type { ParsedEntry } from './transfer';
import type { Item } from './model';

const items: Item[] = [
  { s: 'gateway-service', k: 'log.level', t: 'scalar', v: 'info', d: '日志与观测', g: '日志' },
  { s: '', k: 'log.level', t: 'scalar', v: 'warn', d: '日志与观测', g: '日志' },
  { s: '', k: 'email.password', t: 'scalar', v: MASK_PLACEHOLDER, d: '邮件与短信', g: '邮件发送' },
];

describe('导出结构 buildExportDoc', () => {
  it('生成与后端一致的文档骨架（version/时间/作用域/items）', () => {
    const doc = buildExportDoc(items, { tenantId: 't-1', appId: 'a-1' });
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.tenant_id).toBe('t-1');
    expect(doc.app_id).toBe('a-1');
    expect(Number.isNaN(Date.parse(doc.exported_at))).toBe(false);
    expect(doc.items).toHaveLength(items.length);
  });

  it('条目按 (service_name, key) 升序，字段为导出语义字段', () => {
    const doc = buildExportDoc(items);
    expect(doc.items.map((r) => `${r.service_name}|${r.key}`)).toEqual([
      '|email.password',
      '|log.level',
      'gateway-service|log.level',
    ]);
    expect(doc.items[1]).toMatchObject({
      service_name: '',
      key: 'log.level',
      value: 'warn',
      value_type: 'scalar',
      domain: '日志与观测',
      group: '日志',
      masked: false,
      sensitive: false,
      revision: 0,
    });
  });

  it('遮罩占位值 → masked=true + sensitive=true 并计入 masked_count', () => {
    const doc = buildExportDoc(items);
    const masked = doc.items.filter((r) => r.masked);
    expect(masked).toHaveLength(1);
    expect(masked[0].key).toBe('email.password');
    expect(masked[0].value).toBe(MASK_PLACEHOLDER);
    expect(masked[0].sensitive).toBe(true);
    expect(doc.masked_count).toBe(1);
  });

  it('前端展示类型 → 后端 value_type', () => {
    expect(toValueType('int')).toBe('int');
    expect(toValueType('bool')).toBe('bool');
    expect(toValueType('yaml')).toBe('yaml');
    expect(toValueType('scalar')).toBe('scalar');
  });

  it('导出的值类型映射进文档', () => {
    const doc = buildExportDoc([{ s: '', k: 'x', t: 'yaml', v: 'a: 1', d: 'D', g: 'G' }]);
    expect(doc.items[0].value_type).toBe('yaml');
  });
});

describe('JSON / YAML 往返', () => {
  const doc = buildExportDoc(items, { tenantId: 'tenant-x', appId: 'app-x' });

  for (const format of ['json', 'yaml'] as const) {
    it(`${format}：导出 → 解析后条目逐条一致（含 masked 标记）`, () => {
      const text = stringifyExport(doc, format);
      const parsed = parseImportText(text, `export.${format}`);
      expect(parsed.format).toBe(format);
      expect(parsed.tenantId).toBe('tenant-x');
      expect(parsed.appId).toBe('app-x');
      expect(
        parsed.entries.map((e) => [e.service_name, e.key, e.value, e.value_type, e.masked]),
      ).toEqual(doc.items.map((i) => [i.service_name, i.key, i.value, i.value_type, i.masked]));
    });
  }

  it('json 用 2 空格缩进；yaml 保留缩进 2 且不折行', () => {
    expect(stringifyExport(doc, 'json')).toContain('\n  "version": 1');
    expect(stringifyExport(doc, 'yaml')).toContain('version: 1');
  });
});

describe('导入解析 parseImportText', () => {
  it('接受裸条目数组，并兼容短字段别名（s/k/v/t）', () => {
    const parsed = parseImportText(JSON.stringify([{ s: 'svc', k: 'a.b', v: '1', t: 'INT' }]));
    expect(parsed.entries[0]).toMatchObject({
      service_name: 'svc',
      key: 'a.b',
      value: '1',
      value_type: 'int',
      masked: false,
    });
  });

  it('value_type 缺省 scalar；非字符串值转字符串', () => {
    const parsed = parseImportText(JSON.stringify([{ key: 'a.b', value: 42 }]));
    expect(parsed.entries[0]).toMatchObject({ value: '42', value_type: 'scalar' });
  });

  it('masked 标记或值等于占位符 → 条目标记 masked', () => {
    const parsed = parseImportText(
      JSON.stringify([
        { key: 'a.b', value: 'x', masked: true },
        { key: 'c.d', value: MASK_PLACEHOLDER },
      ]),
    );
    expect(parsed.entries.map((e) => e.masked)).toEqual([true, true]);
  });

  it('错误：空文件 / 无法识别结构 / 没有条目', () => {
    expect(() => parseImportText('   ')).toThrow('文件为空');
    expect(() => parseImportText('{"foo":1}')).toThrow('无法识别的结构');
    expect(() => parseImportText('{"items":[]}')).toThrow('文件里没有配置项');
    expect(() => parseImportText('[{"unknown":1}]')).toThrow('文件里没有可用的配置项');
  });

  it('错误：条目超过上限', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ key: `k.${i}`, value: 'v' }));
    expect(() => parseImportText(JSON.stringify(rows))).toThrow('条目过多');
  });

  it('错误：既不是 JSON 也不是 YAML', () => {
    expect(() => parseImportText('a: [1, 2', 'broken.yaml')).toThrow('无法解析文件');
  });
});

describe('单条预检 entryProblem', () => {
  const base: ParsedEntry = { service_name: 'svc', key: 'a.b', value: '1', value_type: 'scalar' };

  it('合法条目无问题', () => {
    expect(entryProblem(base)).toBe('');
    expect(entryProblem({ ...base, value_type: 'int', value: '42' })).toBe('');
    expect(entryProblem({ ...base, value_type: 'bool', value: 'TRUE' })).toBe('');
  });

  it('键非法：空 / 超长 / 含 .. 或路径分隔或换行', () => {
    expect(entryProblem({ ...base, key: '' })).toBe('键为空');
    expect(entryProblem({ ...base, key: 'k'.repeat(513) })).toContain('键超长');
    expect(entryProblem({ ...base, key: 'a..b' })).toContain('非法字符');
    expect(entryProblem({ ...base, key: 'a/b' })).toContain('非法字符');
    expect(entryProblem({ ...base, key: 'a\\b' })).toContain('非法字符');
    expect(entryProblem({ ...base, key: 'a\nb' })).toContain('非法字符');
  });

  it('服务名非法：超长 / 含分隔符', () => {
    expect(entryProblem({ ...base, service_name: 's'.repeat(65) })).toContain('服务名超长');
    expect(entryProblem({ ...base, service_name: 'a/b' })).toContain('服务名含非法字符');
  });

  it('类型/值非法：未知 value_type、int 非整数、bool 非法', () => {
    expect(entryProblem({ ...base, value_type: 'float' })).toContain('value_type 非法');
    expect(entryProblem({ ...base, value_type: 'int', value: '1.5' })).toContain('不是整数');
    expect(entryProblem({ ...base, value_type: 'bool', value: 'yes' })).toContain('bool 类型的值非法');
  });

  it('值超限（>1MiB）', () => {
    expect(entryProblem({ ...base, value: 'x'.repeat((1 << 20) + 1) })).toContain('值超限');
  });
});

describe('差异计算 diffEntries', () => {
  const entries: ParsedEntry[] = [
    // create：服务里不存在该键
    { service_name: 'gateway-service', key: 'log.format', value: 'json', value_type: 'scalar' },
    // update：存在但值不同（当前 info）
    { service_name: 'gateway-service', key: 'log.level', value: 'debug', value_type: 'scalar' },
    // unchanged：值与类型都相同（当前 warn，基座）
    { service_name: '', key: 'log.level', value: 'warn', value_type: 'scalar' },
    // invalid：键为空
    { service_name: '', key: '', value: 'x', value_type: 'scalar' },
    // skipped：导出遮罩占位
    { service_name: '', key: 'email.password', value: MASK_PLACEHOLDER, value_type: 'scalar' },
  ];

  it('逐条 action 与计数正确，writable=false（存在 invalid）', () => {
    const res = diffEntries(entries, items);
    expect(res.items.map((r) => r.action)).toEqual(['create', 'update', 'unchanged', 'invalid', 'skipped']);
    expect(res.counts).toEqual({ create: 1, update: 1, unchanged: 1, invalid: 1, skipped: 1 });
    expect(res.writable).toBe(false);
  });

  it('update 行带 current_value，create 行为 null；invalid/skipped 带 reason', () => {
    const res = diffEntries(entries, items);
    expect(res.items[0].current_value).toBeNull();
    expect(res.items[1].current_value).toBe('info');
    expect(res.items[2].current_value).toBe('warn');
    expect(res.items[3].reason).toBe('键为空');
    expect(res.items[4].reason).toContain('已脱敏');
  });

  it('字符串值相同但类型不同 → update', () => {
    const res = diffEntries(
      [{ service_name: 'gateway-service', key: 'log.level', value: 'info', value_type: 'yaml' }],
      items,
    );
    expect(res.items[0].action).toBe('update');
  });

  it('全部合法时 writable=true；计数从 EMPTY_COUNTS 起算', () => {
    const res = diffEntries([entries[0]], items);
    expect(res.writable).toBe(true);
    expect(res.counts).toEqual({ ...EMPTY_COUNTS, create: 1 });
  });

  it('空条目列表 → 全零计数且 writable=true', () => {
    const res = diffEntries([], items);
    expect(res.items).toEqual([]);
    expect(res.counts).toEqual(EMPTY_COUNTS);
    expect(res.writable).toBe(true);
  });
});

describe('提交过滤 toImportEntries', () => {
  it('只保留 create/update，并剥掉 reason/current_value 等本地字段', () => {
    const res = diffEntries(
      [
        { service_name: 'gateway-service', key: 'log.format', value: 'json', value_type: 'scalar' },
        { service_name: 'gateway-service', key: 'log.level', value: 'debug', value_type: 'scalar' },
        { service_name: '', key: 'log.level', value: 'warn', value_type: 'scalar' },
        { service_name: '', key: '', value: 'x', value_type: 'scalar' },
      ],
      items,
    );
    const out = toImportEntries(res.items);
    expect(out).toEqual([
      { service_name: 'gateway-service', key: 'log.format', value: 'json', value_type: 'scalar' },
      { service_name: 'gateway-service', key: 'log.level', value: 'debug', value_type: 'scalar' },
    ]);
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual(['key', 'service_name', 'value', 'value_type']);
    }
  });

  it('skipped（遮罩占位）绝不提交', () => {
    const res = diffEntries(
      [{ service_name: '', key: 'email.password', value: MASK_PLACEHOLDER, value_type: 'scalar' }],
      items,
    );
    expect(toImportEntries(res.items)).toEqual([]);
  });
});

describe('导出文件名', () => {
  it('含 UTC 时间戳与格式扩展名', () => {
    expect(exportFilename('json', new Date('2026-01-02T03:04:05.678Z'))).toBe(
      'config-export-20260102T030405Z.json',
    );
    expect(exportFilename('yaml', new Date('2026-01-02T03:04:05.678Z'))).toMatch(/\.yaml$/);
  });
});
