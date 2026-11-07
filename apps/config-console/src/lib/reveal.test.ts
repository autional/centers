/**
 * reveal.ts 单测（`environment: 'node'`，纯函数 + 模块级 Map，无 DOM / 无网络）：
 *   - `isMasked`：后端 masked 标记 / 占位字面量 / 正常值 / 空值；
 *   - `maskText`：遮罩项显示 `已脱敏`，否则原值（`value` 与 `v` 双形状）；
 *   - `RevealCache`：put / get / 按 key 清 / 按作用域清 / 全清（不越界删）；
 *   - `validateReason`：空、纯空白、200 / 201 字、首尾空格（trim 后计数）、码点计数。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MASK_PLACEHOLDER, MASK_TEXT, REVEAL_REASON_MAX, RevealCache, isMasked, maskText, validateReason } from './reveal';

beforeEach(() => {
  RevealCache.clear();
});

describe('isMasked', () => {
  it('后端 masked=true 即遮罩（即使值看起来正常）', () => {
    expect(isMasked({ value: 's3cr3t', masked: true })).toBe(true);
  });

  it('认占位字面量（老响应只有占位值、没有 masked 字段）', () => {
    expect(isMasked({ value: MASK_PLACEHOLDER })).toBe(true);
    expect(isMasked({ v: MASK_PLACEHOLDER })).toBe(true);
  });

  it('正常值 / 空值都不是遮罩', () => {
    expect(isMasked({ value: 'postgres://db', masked: false })).toBe(false);
    expect(isMasked({ value: '' })).toBe(false);
    expect(isMasked(null)).toBe(false);
    expect(isMasked(undefined)).toBe(false);
  });
});

describe('maskText', () => {
  it('遮罩项显示「已脱敏」', () => {
    expect(maskText({ value: MASK_PLACEHOLDER })).toBe(MASK_TEXT);
    expect(maskText({ value: 'real', masked: true })).toBe(MASK_TEXT);
  });

  it('非遮罩项显示原值', () => {
    expect(maskText({ value: 'localhost:5432' })).toBe('localhost:5432');
    expect(maskText({ v: '8080' })).toBe('8080');
  });

  it('空值 / null → 空串（UI 侧另用自己的占位文案）', () => {
    expect(maskText(null)).toBe('');
    expect(maskText({})).toBe('');
  });
});

describe('RevealCache', () => {
  it('put / get 按作用域隔离', () => {
    RevealCache.put('audit-service', 'jwt.secret', 'A');
    RevealCache.put('', 'jwt.secret', 'BASE');
    expect(RevealCache.get('audit-service', 'jwt.secret')).toBe('A');
    expect(RevealCache.get('', 'jwt.secret')).toBe('BASE');
    expect(RevealCache.get('other-service', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('audit-service', 'other.key')).toBeUndefined();
  });

  it('clear({ key }) 只清该键的所有作用域', () => {
    RevealCache.put('audit-service', 'jwt.secret', 'A');
    RevealCache.put('', 'jwt.secret', 'BASE');
    RevealCache.put('audit-service', 'smtp.password', 'P');
    RevealCache.clear({ key: 'jwt.secret' });
    expect(RevealCache.get('audit-service', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('audit-service', 'smtp.password')).toBe('P');
  });

  it('clear({ service_name, key }) 只清单条', () => {
    RevealCache.put('audit-service', 'jwt.secret', 'A');
    RevealCache.put('', 'jwt.secret', 'BASE');
    RevealCache.clear({ service_name: 'audit-service', key: 'jwt.secret' });
    expect(RevealCache.get('audit-service', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('', 'jwt.secret')).toBe('BASE');
  });

  it('clear({ service_name }) / clear() 分别清该服务与全部', () => {
    RevealCache.put('audit-service', 'jwt.secret', 'A');
    RevealCache.put('audit-service', 'smtp.password', 'P');
    RevealCache.put('', 'jwt.secret', 'BASE');
    RevealCache.clear({ service_name: 'audit-service' });
    expect(RevealCache.get('audit-service', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('audit-service', 'smtp.password')).toBeUndefined();
    expect(RevealCache.get('', 'jwt.secret')).toBe('BASE');

    RevealCache.clear();
    expect(RevealCache.get('', 'jwt.secret')).toBeUndefined();
  });

  it('同名键不会被「按 key 清」误删（键含点号 / 前缀相似）', () => {
    RevealCache.put('svc', 'jwt.secret', 'A');
    RevealCache.put('svc', 'jwt.secret.old', 'B');
    RevealCache.clear({ key: 'jwt.secret' });
    expect(RevealCache.get('svc', 'jwt.secret')).toBeUndefined();
    expect(RevealCache.get('svc', 'jwt.secret.old')).toBe('B');
  });
});

describe('validateReason', () => {
  it('空 / 纯空白 / 空值都拒绝', () => {
    expect(validateReason('').ok).toBe(false);
    expect(validateReason('   ').ok).toBe(false);
    expect(validateReason('\n\t ').ok).toBe(false);
    expect(validateReason(null).ok).toBe(false);
    expect(validateReason(undefined).ok).toBe(false);
  });

  it('恰好 200 字通过，201 字拒绝', () => {
    const ok = 'a'.repeat(REVEAL_REASON_MAX);
    const tooLong = 'a'.repeat(REVEAL_REASON_MAX + 1);
    expect(validateReason(ok)).toMatchObject({ ok: true, value: ok });
    const rejected = validateReason(tooLong);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain(String(REVEAL_REASON_MAX));
  });

  it('首尾空格被 trim，且不因空格把 200 字顶成超长', () => {
    const body = 'a'.repeat(REVEAL_REASON_MAX);
    const padded = `  ${body}  `;
    const check = validateReason(padded);
    expect(check.ok).toBe(true);
    expect(check.value).toBe(body);
    expect(check.value.length).toBe(REVEAL_REASON_MAX);
  });

  it('按字符（码点）计数：200 个汉字通过，201 个拒绝', () => {
    expect(validateReason('排'.repeat(REVEAL_REASON_MAX)).ok).toBe(true);
    expect(validateReason('排'.repeat(REVEAL_REASON_MAX + 1)).ok).toBe(false);
  });
});
