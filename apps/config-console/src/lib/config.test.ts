/**
 * config.ts 单测（纯逻辑，无 DOM）：
 *   - `envLabelOf` 三类 hostname：本地（localhost / 127.0.0.1 / *.local）、生产（com / cn）、其它取首段；
 *   - `VITE_ENV_LABEL` 非空覆盖（优先于 hostname 推导）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envLabelOf } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('envLabelOf', () => {
  it('本地：localhost / 127.0.0.1 / *.local', () => {
    expect(envLabelOf('localhost')).toBe('本地');
    expect(envLabelOf('127.0.0.1')).toBe('本地');
    expect(envLabelOf('macbook.local')).toBe('本地');
    // 大小写 / 尾点 / 端口都不影响判定
    expect(envLabelOf('LOCALHOST')).toBe('本地');
    expect(envLabelOf('box.local.')).toBe('本地');
    expect(envLabelOf('localhost:13120')).toBe('本地');
  });

  it('生产：config.autional.com / config.autional.cn', () => {
    expect(envLabelOf('config.autional.com')).toBe('生产');
    expect(envLabelOf('config.autional.cn')).toBe('生产');
  });

  it('其它：取 hostname 首段', () => {
    expect(envLabelOf('preview')).toBe('preview');
    expect(envLabelOf('config-preview.vercel.app')).toBe('config-preview');
    expect(envLabelOf(' staging.autional.com ')).toBe('staging');
  });
});

describe('ENV_LABEL', () => {
  it('VITE_ENV_LABEL 非空时覆盖 hostname 推导', async () => {
    vi.stubEnv('VITE_ENV_LABEL', 'staging-7');
    const mod = await import('./config');
    expect(mod.ENV_LABEL).toBe('staging-7');
  });

  it('VITE_ENV_LABEL 为空串时回落 hostname 推导（node 无 window → 生产兜底）', async () => {
    vi.stubEnv('VITE_ENV_LABEL', '  ');
    const mod = await import('./config');
    expect(mod.ENV_LABEL).toBe('生产');
  });
});
