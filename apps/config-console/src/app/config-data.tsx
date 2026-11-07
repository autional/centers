import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useConfigStore } from '@/hooks/use-config-store';
import type { LoadStatus } from '@/hooks/use-config-store';
import type { Meta } from '@/lib/data';
import type { Item } from '@/lib/model';

type ConfigData = {
  items: Item[];
  meta: Meta;
  status: LoadStatus;
  error: string;
  reload: (silent?: boolean) => Promise<void>;
  reset: () => Promise<void>;
};

const ConfigDataContext = createContext<ConfigData | null>(null);

export function ConfigDataProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const store = useConfigStore(enabled);
  return (
    <ConfigDataContext.Provider
      value={{
        items: store.items,
        meta: store.meta,
        status: store.status,
        error: store.error,
        reload: store.load,
        reset: store.reset,
      }}
    >
      {children}
    </ConfigDataContext.Provider>
  );
}

export function useConfigData(): ConfigData {
  const value = useContext(ConfigDataContext);
  if (!value) throw new Error('useConfigData 必须在 ConfigDataProvider 内使用');
  return value;
}
