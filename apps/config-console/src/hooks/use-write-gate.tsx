import { useCallback, useState } from 'react';
import { Alert, App } from 'antd';
import { useTranslation } from 'react-i18next';
import { errorText, store } from '@/lib/data';
import type { Item } from '@/lib/model';
import { scopeLabel } from '@/lib/model';
import { RevealCache } from '@/lib/reveal';
import { ReasonModal } from '@/components/reason-modal';

export type PendingWrite =
  | { kind: 'upsert'; item: Item }
  | { kind: 'delete'; item: Item }
  | { kind: 'rollback'; item: Item; revision: number };

/**
 * 写操作闸门：演示模式（本地可编辑）直接落盘，真实 API 模式先收集变更原因（1–200 字）。
 * 返回的 `node` 必须渲染在页面里（它承载原因弹窗）。
 */
export function useWriteGate(onDone: () => Promise<void>) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (write: PendingWrite, reason: string) => {
      setBusy(true);
      try {
        if (write.kind === 'upsert') await store.upsert(write.item, reason);
        else if (write.kind === 'delete') await store.remove(write.item, reason);
        else await store.rollback(write.item, write.revision, reason);
        if (write.kind === 'upsert') RevealCache.clear({ service_name: write.item.s, key: write.item.k });
        message.success(
          write.kind === 'delete' ? t('write.deleted') : write.kind === 'rollback' ? t('write.rolledBack') : t('write.saved'),
        );
        setPending(null);
        await onDone();
      } catch (err) {
        message.error(errorText(err));
        if (!store.localWrites) setPending(null);
      } finally {
        setBusy(false);
      }
    },
    [message, onDone, t],
  );

  const requestWrite = useCallback(
    (write: PendingWrite) => {
      if (store.localWrites) {
        void run(write, '');
        return;
      }
      setPending(write);
    },
    [run],
  );

  const node = pending ? (
    <ReasonModal
      title={
        pending.kind === 'delete' ? t('write.deleteTitle') : pending.kind === 'rollback' ? t('write.rollbackTitle') : t('write.saveTitle')
      }
      description={
        <div className="mb-3 space-y-1 text-sm">
          <div>
            <b>{pending.item.k}</b>
            <span className="ml-2 text-[var(--color-text-secondary)]">{scopeLabel(pending.item.s)}</span>
          </div>
          {pending.kind === 'rollback' ? (
            <Alert type="warning" showIcon title={t('write.rollbackHint', { revision: pending.revision })} />
          ) : (
            <div className="break-all font-mono text-xs text-[var(--color-text-secondary)]">{pending.item.v}</div>
          )}
        </div>
      }
      confirmText={
        pending.kind === 'delete' ? t('common.delete') : pending.kind === 'rollback' ? t('common.rollback') : t('common.save')
      }
      danger={pending.kind === 'delete'}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={(reason) => void run(pending, reason)}
    />
  ) : null;

  return { requestWrite, node };
}
