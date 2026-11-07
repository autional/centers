import { describe, expect, it } from 'vitest';
import { legacyHashToPath } from './legacy-hash';

describe('legacyHashToPath', () => {
  it('概览', () => {
    expect(legacyHashToPath('#/')).toBeNull();
  });

  it('域与组编辑', () => {
    expect(legacyHashToPath('#/d/数据库')).toBe('/domains/%E6%95%B0%E6%8D%AE%E5%BA%93');
    expect(legacyHashToPath('#/d/数据库/edit/PostgreSQL')).toBe(
      '/domains/%E6%95%B0%E6%8D%AE%E5%BA%93/PostgreSQL',
    );
  });

  it('变更记录与变更单', () => {
    expect(legacyHashToPath('#/changes')).toBe('/changes');
    expect(legacyHashToPath('#/changesets')).toBe('/changesets');
  });

  it('未知 hash 原样返回 null，不猜', () => {
    expect(legacyHashToPath('')).toBeNull();
    expect(legacyHashToPath('#/unknown')).toBeNull();
    expect(legacyHashToPath('#/d')).toBeNull();
  });
});
