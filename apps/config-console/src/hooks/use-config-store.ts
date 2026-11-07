import { useCallback, useEffect, useState } from 'react';
import { EMPTY_META, errorStatus, errorText, store } from '@/lib/data';
import type { Meta } from '@/lib/data';
import type { Item } from '@/lib/model';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unauthorized';

/** 配置快照（items + 域/组统计）。页面只依赖这一层，不直接碰 store。 */
export function useConfigStore(enabled: boolean) {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setStatus('loading');
    try {
      const snapshot = await store.load();
      setItems(snapshot.items);
      setMeta(snapshot.meta);
      setError('');
      setStatus('ready');
    } catch (err) {
      const code = errorStatus(err);
      setError(errorText(err));
      setStatus(code === 401 ? 'unauthorized' : code === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const reset = useCallback(async () => {
    store.reset();
    await load(true);
  }, [load]);

  return { items, meta, status, error, load, reset, setItems, setMeta };
}
