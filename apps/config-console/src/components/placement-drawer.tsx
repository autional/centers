import { useEffect, useState } from 'react';
import { Alert, Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { Drawer, DataTable } from '@autional/ui/antd';
import { useTranslation } from 'react-i18next';
import { reveal as revealApi } from '@/lib/api';
import { errorStatus, errorText, store } from '@/lib/data';
import type { ConsumersInfo, HistoryEntry } from '@/lib/data';
import type { Item } from '@/lib/model';
import { itemId, scopeLabel } from '@/lib/model';
import { RevealCache, isMasked } from '@/lib/reveal';
import { ReasonModal } from './reason-modal';

/**
 * 取值抽屉：同一个键在各作用域（基座 + 各服务）的取值、影响面、版本历史与回滚入口。
 * 明文只进进程内缓存（RevealCache），关闭抽屉即清。
 */
export function PlacementDrawer(props: {
  state: { domain: string; key: string } | null;
  items: Item[];
  onClose: () => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  historyFor?: (item: Item) => Promise<HistoryEntry[]>;
  onRollback?: (item: Item, revision: number) => void;
}) {
  const { t } = useTranslation();
  const { state, items, onClose, onEdit, onDelete, historyFor, onRollback } = props;
  const [consumers, setConsumers] = useState<ConsumersInfo | null>(null);
  const [consumersError, setConsumersError] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealFor, setRevealFor] = useState<Item | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [history, setHistory] = useState<{ item: Item; rows: HistoryEntry[]; loading: boolean; error: string } | null>(null);

  const openKey = state?.key ?? '';

  useEffect(() => {
    if (!openKey) return;
    setRevealed({});
    setRevealFor(null);
    setRevealError('');
    setHistory(null);
    return () => RevealCache.clear({ key: openKey });
  }, [openKey]);

  useEffect(() => {
    if (!state) {
      setConsumers(null);
      return;
    }
    let alive = true;
    setConsumers(null);
    setConsumersError('');
    store
      .consumers(state.key)
      .then((next) => alive && setConsumers(next))
      .catch((err) => alive && setConsumersError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [state?.domain, state?.key]);

  const list = state
    ? items.filter((item) => item.d === state.domain && item.k === state.key).sort((a, b) => (a.s || '').localeCompare(b.s || ''))
    : [];
  const base = list.find((item) => item.s === '');
  const canReveal = store.mode === 'api';

  const doReveal = async (item: Item, reason: string) => {
    setRevealBusy(true);
    setRevealError('');
    try {
      const res = await revealApi({ service_name: item.s || undefined, key: item.k, reason });
      RevealCache.put(item.s, item.k, res.value);
      setRevealed((prev) => ({ ...prev, [itemId(item.s, item.k)]: res.value }));
      setRevealFor(null);
    } catch (err) {
      setRevealError(errorStatus(err) === 403 ? t('reveal.forbidden') : errorText(err));
    } finally {
      setRevealBusy(false);
    }
  };

  const openHistory = async (item: Item) => {
    if (!historyFor) return;
    setHistory({ item, rows: [], loading: true, error: '' });
    try {
      const rows = await historyFor(item);
      setHistory({ item, rows, loading: false, error: '' });
    } catch (err) {
      setHistory({ item, rows: [], loading: false, error: errorText(err) });
    }
  };

  return (
    <Drawer open={!!state} onClose={onClose} size="md" title={state?.key}>
      {state ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Typography.Text type="secondary">{t('placement.domain')}</Typography.Text>
              <div>{state.domain}</div>
            </div>
            <div>
              <Typography.Text type="secondary">{t('placement.overrides')}</Typography.Text>
              <div>
                {t('placement.summary', { count: list.length, distinct: new Set(list.map((item) => item.v)).size })}
              </div>
            </div>
          </div>

          {consumers ? (
            <Alert
              type="info"
              showIcon
              title={t('placement.consumers', { count: consumers.services.length })}
              description={consumers.services.length ? consumers.services.join(' / ') : t('placement.consumersNone')}
            />
          ) : null}
          {consumersError ? <Alert type="warning" showIcon title={consumersError} /> : null}

          <div className="divide-y divide-[var(--color-border-subtle)]">
            {list.map((item) => {
              const id = itemId(item.s, item.k);
              const plain = revealed[id] ?? RevealCache.get(item.s, item.k);
              const masked = isMasked({ value: item.v, masked: item.masked });
              const sameAsBase = base && item.s ? item.v === base.v : false;
              return (
                <div key={id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{scopeLabel(item.s)}</b>
                    <Tag color={item.s ? (sameAsBase ? 'default' : 'blue') : 'default'}>
                      {item.s ? (sameAsBase ? t('placement.sameAsBase') : t('placement.overridesBase')) : t('placement.defaultValue')}
                    </Tag>
                    <div className="flex-1" />
                    <Space size={0}>
                      {canReveal && masked ? (
                        <Button size="small" type="link" onClick={() => setRevealFor(item)}>
                          {t('reveal.action')}
                        </Button>
                      ) : null}
                      {historyFor ? (
                        <Button size="small" type="link" onClick={() => void openHistory(item)}>
                          {t('placement.history')}
                        </Button>
                      ) : null}
                      <Button size="small" type="link" onClick={() => onEdit(item)}>
                        {t('common.edit')}
                      </Button>
                      <Popconfirm title={t('placement.deleteConfirm')} onConfirm={() => onDelete(item)}>
                        <Button size="small" type="link" danger>
                          {t('common.delete')}
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  <div className="mt-1 break-all font-mono text-xs">{plain ?? (masked ? '••••••' : item.v)}</div>
                </div>
              );
            })}
          </div>

          {history ? (
            <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
              <div className="mb-2 text-sm font-semibold">
                {t('placement.historyTitle', { scope: scopeLabel(history.item.s) })}
              </div>
              <DataTable
                size="small"
                rowKey={(row) => String(row.revision)}
                loading={history.loading}
                dataSource={history.rows}
                pagination={false}
                locale={{ emptyText: history.error || t('placement.noHistory') }}
                columns={[
                  { title: t('placement.revision'), dataIndex: 'revision', width: 90 },
                  { title: t('placement.value'), dataIndex: 'value', ellipsis: true, render: (v: string) => <span className="font-mono text-xs">{v}</span> },
                  {
                    title: '',
                    width: 90,
                    render: (_: unknown, row: HistoryEntry) =>
                      onRollback ? (
                        <Button size="small" type="link" onClick={() => onRollback(history.item, row.revision)}>
                          {t('placement.rollback')}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {revealFor ? (
        <ReasonModal
          title={t('reveal.title')}
          description={<Alert type="warning" showIcon title={t('reveal.description')} />}
          confirmText={t('reveal.action')}
          busy={revealBusy}
          onCancel={() => setRevealFor(null)}
          onConfirm={(reason) => void doReveal(revealFor, reason)}
        />
      ) : null}
      {revealError ? <Alert className="mt-3" type="error" showIcon title={revealError} /> : null}
    </Drawer>
  );
}
