/**
 * model.ts 单测（纯逻辑，无 DOM）：
 *   - 域/组统计与未知域回退（DOMAIN_META 缺省 → mono '?'）
 *   - `effective` 的生效语义：base（基座自身）/ override（服务覆盖）；
 *     API 侧另有的 inherit（服务未定义、值来自基座）由 data.ts 映射，本地聚合把这类键记为 base。
 *   - `aggregate` 按 key 去重、N 种取值（distinct）、遮罩值不计入取值集合、过滤与排序
 */
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_META,
  aggregate,
  buildMeta,
  effective,
  groupEffective,
  isRule,
  itemId,
  scopeLabel,
  servicesInGroup,
  splitId,
  toItemType,
} from './model';
import type { Item } from './model';

const MASK = '••••••';

describe('基础映射', () => {
  it('itemId / splitId 往返（第一个 | 分隔服务与键）', () => {
    expect(itemId('svc', 'a.b')).toBe('svc|a.b');
    expect(splitId(itemId('svc', 'a.b'))).toEqual({ s: 'svc', k: 'a.b' });
    expect(splitId(itemId('', 'a.b'))).toEqual({ s: '', k: 'a.b' });
    // 键里再有 | 时仍归到键（只切第一个分隔符）
    expect(splitId('svc|a|b')).toEqual({ s: 'svc', k: 'a|b' });
  });

  it('toItemType 归一（json→yaml，text/未知→scalar）', () => {
    expect(toItemType('int')).toBe('int');
    expect(toItemType('INTEGER')).toBe('int');
    expect(toItemType('bool')).toBe('bool');
    expect(toItemType('boolean')).toBe('bool');
    expect(toItemType('yaml')).toBe('yaml');
    expect(toItemType('json')).toBe('yaml');
    expect(toItemType('text')).toBe('scalar');
    expect(toItemType(undefined)).toBe('scalar');
  });

  it('isRule 识别校验规则键；scopeLabel 空服务=平台基座', () => {
    expect(isRule({ s: '', k: 'validation.max', t: 'scalar', v: '', d: 'D', g: 'G' })).toBe(true);
    expect(isRule({ s: '', k: 'a.validation.min', t: 'scalar', v: '', d: 'D', g: 'G' })).toBe(true);
    expect(isRule({ s: '', k: 'a.b', t: 'scalar', v: '', d: 'D', g: 'G' })).toBe(false);
    expect(scopeLabel('')).toBe('平台基座');
    expect(scopeLabel('gateway-service')).toBe('gateway-service');
  });
});

describe('buildMeta：域/组统计与回退', () => {
  const items: Item[] = [
    { s: '', k: 'db.host', t: 'scalar', v: 'h', d: '数据库', g: '连接' },
    { s: 'svc-a', k: 'db.host', t: 'scalar', v: 'h2', d: '数据库', g: '连接' },
    { s: 'svc-b', k: 'db.host', t: 'scalar', v: 'h2', d: '数据库', g: '连接' },
    { s: '', k: 'mystery.k', t: 'int', v: '1', d: '未知域', g: '其他' },
  ];

  it('域按条目数降序，base/svc 与 total 汇总正确', () => {
    const meta = buildMeta(items);
    expect(meta.domains.map((d) => d.name)).toEqual(['数据库', '未知域']);
    expect(meta.total).toBe(4);
    expect(meta.base).toBe(2);
    expect(meta.svc).toBe(2);
    expect(meta.services).toEqual(['svc-a', 'svc-b']);
    expect(meta.domains[0]).toMatchObject({ count: 3, base: 1, svc: 2 });
  });

  it('组统计：count/base/svc + 该组不同服务数', () => {
    const meta = buildMeta(items);
    const groups = meta.domains.find((d) => d.name === '数据库')!.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ name: '连接', count: 3, base: 1, svc: 2, services: 2 });
  });

  it('域回退：DOMAIN_META 未登记的域用 mono ? + 灰色，不丢数据', () => {
    const meta = buildMeta(items);
    const unknown = meta.domains.find((d) => d.name === '未知域')!;
    expect(unknown).toMatchObject({ mono: '?', color: '#94a3b8', desc: '', count: 1 });
    // 已登记域沿用 DOMAIN_META
    const known = meta.domains.find((d) => d.name === '数据库')!;
    expect(known.mono).toBe(DOMAIN_META['数据库'].mono);
    expect(known.color).toBe(DOMAIN_META['数据库'].color);
  });

  it('同组内服务去重（同一服务多条只算 1 个服务）', () => {
    const meta = buildMeta([
      { s: 'svc-a', k: 'a.1', t: 'scalar', v: '1', d: '数据库', g: '连接' },
      { s: 'svc-a', k: 'a.2', t: 'scalar', v: '2', d: '数据库', g: '连接' },
    ]);
    expect(meta.domains[0].groups[0]).toMatchObject({ count: 2, svc: 2, services: 1 });
  });

  it('空输入不炸', () => {
    expect(buildMeta([])).toEqual({ domains: [], total: 0, base: 0, svc: 0, services: [] });
  });
});

describe('effective：生效三态', () => {
  const items: Item[] = [
    { s: '', k: 'k.only_base', t: 'scalar', v: 'b', d: 'D', g: 'G1' },
    { s: '', k: 'k.overridden', t: 'scalar', v: 'base', d: 'D', g: 'G1' },
    { s: 'svc', k: 'k.overridden', t: 'scalar', v: 'svc', d: 'D', g: 'G1' },
    { s: 'svc', k: 'k.only_svc', t: 'int', v: '1', d: 'D', g: 'G2' },
    { s: '', k: 'other.domain', t: 'scalar', v: 'x', d: 'OTHER', g: 'G1' },
  ];

  it('无 scope：只看基座，全部 src=base（服务专属键不出现）', () => {
    const rows = effective(items, 'D', '');
    expect(rows.map((r) => r.k)).toEqual(['k.only_base', 'k.overridden']);
    expect(rows.every((r) => r.src === 'base')).toBe(true);
    expect(rows.map((r) => r.v)).toEqual(['b', 'base']);
  });

  it('有 scope：服务覆盖 → src=override，未被覆盖的基座键仍 src=base（UI 视作「继承基座」）', () => {
    const rows = effective(items, 'D', 'svc');
    const byKey = new Map(rows.map((r) => [r.k, r]));
    expect(byKey.get('k.overridden')!.src).toBe('override');
    expect(byKey.get('k.overridden')!.v).toBe('svc');
    expect(byKey.get('k.only_base')!.src).toBe('base');
    expect(byKey.get('k.only_base')!.v).toBe('b');
    expect(byKey.get('k.only_svc')!.src).toBe('override');
    expect(rows).toHaveLength(3);
  });

  it('本地聚合不产生 inherit（该值由 API /effective 映射，见 data.ts toEffectiveRow）', () => {
    expect(effective(items, 'D', 'svc').some((r) => (r.src as string) === 'inherit')).toBe(false);
  });

  it('只返回指定域；groupEffective 再按组过滤', () => {
    expect(effective(items, 'D', '').every((r) => r.d === 'D')).toBe(true);
    expect(groupEffective(items, 'D', 'G1', '').map((r) => r.k)).toEqual(['k.only_base', 'k.overridden']);
    expect(groupEffective(items, 'D', 'G2', 'svc').map((r) => r.k)).toEqual(['k.only_svc']);
  });

  it('servicesInGroup 列该组出现过的服务（去重升序，不含基座）', () => {
    expect(servicesInGroup(items, 'D', 'G1')).toEqual(['svc']);
    expect(servicesInGroup(items, 'D', 'G2')).toEqual(['svc']);
    expect(servicesInGroup(items, 'D', 'NOPE')).toEqual([]);
  });
});

describe('aggregate：去重 / N 种取值 / 过滤 / 排序', () => {
  const items: Item[] = [
    { s: '', k: 'k1', t: 'scalar', v: 'a', d: 'D', g: 'G1' },
    { s: 's1', k: 'k1', t: 'scalar', v: 'a', d: 'D', g: 'G1' },
    { s: 's2', k: 'k1', t: 'scalar', v: 'b', d: 'D', g: 'G1' },
    { s: 's1', k: 'k2', t: 'int', v: '1', d: 'D', g: 'G2' },
    { s: '', k: 'k3', t: 'scalar', v: MASK, d: 'D', g: 'G2' },
    { s: 's3', k: 'k3', t: 'scalar', v: MASK, d: 'D', g: 'G2' },
    { s: '', k: 'validation.x', t: 'scalar', v: 'v', d: 'D', g: 'G1' },
  ];

  it('按 key 去重并统计 total/base/services/distinct', () => {
    const rows = aggregate(items, 'D');
    const k1 = rows.find((r) => r.k === 'k1')!;
    expect(k1).toMatchObject({ total: 3, base: true, services: 2, distinct: 2, t: 'scalar', g: 'G1' });
    // 取第一个非遮罩值（插入顺序）
    expect(k1.v).toBe('a');

    const k2 = rows.find((r) => r.k === 'k2')!;
    expect(k2).toMatchObject({ total: 1, base: false, services: 1, distinct: 1, v: '1', t: 'int' });
  });

  it('N 种取值：distinct 统计不同值个数（同值多次只算 1 种）', () => {
    const rows = aggregate(
      [
        { s: 's1', k: 'x', t: 'scalar', v: '1', d: 'D', g: 'G' },
        { s: 's2', k: 'x', t: 'scalar', v: '2', d: 'D', g: 'G' },
        { s: 's3', k: 'x', t: 'scalar', v: '3', d: 'D', g: 'G' },
        { s: 's4', k: 'x', t: 'scalar', v: '3', d: 'D', g: 'G' },
      ],
      'D',
    );
    expect(rows[0]).toMatchObject({ total: 4, services: 4, distinct: 3 });
  });

  it('遮罩值不计入取值集合：全遮罩 → v=占位符 + distinct=0', () => {
    const k3 = aggregate(items, 'D').find((r) => r.k === 'k3')!;
    expect(k3).toMatchObject({ v: MASK, distinct: 0, total: 2, base: true, services: 1 });
  });

  it('混合遮罩：v 取真实值，distinct 只数真实值', () => {
    const rows = aggregate(
      [
        { s: '', k: 'x', t: 'scalar', v: MASK, d: 'D', g: 'G' },
        { s: 's1', k: 'x', t: 'scalar', v: 'real', d: 'D', g: 'G' },
      ],
      'D',
    );
    expect(rows[0]).toMatchObject({ v: 'real', distinct: 1, total: 2, base: true, services: 1 });
  });

  it('排序：先按组的出现顺序，再按 key 升序', () => {
    expect(aggregate(items, 'D').map((r) => r.k)).toEqual(['k1', 'validation.x', 'k2', 'k3']);
  });

  it('过滤：group / service / scope(base|svc) / q / hideRules', () => {
    expect(aggregate(items, 'D', { group: 'G2' }).map((r) => r.k)).toEqual(['k2', 'k3']);
    expect(aggregate(items, 'D', { service: 's1' }).map((r) => r.k)).toEqual(['k1', 'k2']);
    expect(aggregate(items, 'D', { scope: 'base' }).map((r) => r.k)).toEqual([
      'k1',
      'validation.x',
      'k3',
    ]);
    expect(aggregate(items, 'D', { scope: 'svc' }).map((r) => r.k)).toEqual(['k1', 'k2', 'k3']);
    expect(aggregate(items, 'D', { hideRules: true }).map((r) => r.k)).toEqual(['k1', 'k2', 'k3']);
    // q 命中值（大小写不敏感）
    expect(aggregate(items, 'D', { q: 'B' }).map((r) => r.k)).toEqual(['k1']);
    // q 命中键
    expect(aggregate(items, 'D', { q: 'K2' }).map((r) => r.k)).toEqual(['k2']);
    // q 命中服务名
    expect(aggregate(items, 'D', { q: 'S3' }).map((r) => r.k)).toEqual(['k3']);
  });

  it('其他域不参与聚合', () => {
    expect(aggregate(items, 'NOPE')).toEqual([]);
  });
});
