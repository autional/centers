import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Segmented, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { AppPageHeader } from '@autional/ui';
import { PageSection } from '@/components/page-section';
import { Drawer, DataTable } from '@autional/ui/antd';
import { CHANGESETS_PAGE_SIZE, buildChangesetQuery, canPublish, canReject, statusColor, statusLabel } from '@/lib/changesets';
import type { ChangesetStatus } from '@/lib/api';
import { getChangeset, listChangesets, publishChangeset, rejectChangeset } from '@/lib/api';
import type { Changeset, ChangesetDetail } from '@/lib/api';
import { DATA_MODE } from '@/lib/config';
import { errorText } from '@/lib/data';
import { formatChangesetTime } from '@/lib/changesets';
import { ReasonModal } from '@/components/reason-modal';

type Filter = '' | ChangesetStatus;

/** 变更单：草稿 → 发布 / 拒绝。演示模式无后端，只给说明。 */
export default function ChangesetsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [filter, setFilter] = useState<Filter>('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Changeset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<{ kind: 'publish' | 'reject'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (DATA_MODE !== 'api') return;
    setLoading(true);
    setError('');
    try {
      const result = await listChangesets(buildChangesetQuery({ status: filter, page, pageSize: CHANGESETS_PAGE_SIZE }));
      setRows(result.items ?? []);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(errorText(err));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await getChangeset(id));
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const submitAction = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'publish') await publishChangeset(action.id, { reason });
      else await rejectChangeset(action.id, { reason });
      message.success(action.kind === 'publish' ? t('changesets.published') : t('changesets.rejected'));
      setAction(null);
      setDetail(null);
      await load();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppPageHeader title={t('changesets.title')} description={t('changesets.description')} />
      {DATA_MODE !== 'api' ? (
        <Alert className="mb-4" type="info" showIcon title={t('changesets.demoHint')} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={filter}
              onChange={(value) => {
                setFilter(value as Filter);
                setPage(1);
              }}
              options={[
                { value: '', label: t('changesets.all') },
                { value: 'draft', label: statusLabel('draft') },
                { value: 'published', label: statusLabel('published') },
                { value: 'rejected', label: statusLabel('rejected') },
              ]}
            />
          </div>
          {error ? <Alert className="mb-3" type="error" showIcon title={error} /> : null}
          <PageSection >
            <DataTable
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={rows}
              pagination={{ current: page, pageSize: CHANGESETS_PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }}
              columns={[
                { title: t('changesets.col.title'), dataIndex: 'title' },
                {
                  title: t('changesets.col.status'),
                  dataIndex: 'status',
                  width: 110,
                  render: (value: ChangesetStatus) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
                },
                { title: t('changesets.col.entries'), dataIndex: 'entry_count', width: 90 },
                { title: t('changesets.col.creator'), dataIndex: 'created_by', width: 140 },
                {
                  title: t('changesets.col.createdAt'),
                  dataIndex: 'created_at',
                  width: 180,
                  render: (value: string) => formatChangesetTime(value),
                },
                {
                  title: t('changesets.col.actions'),
                  width: 100,
                  render: (_: unknown, row: Changeset) => (
                    <Button size="small" type="link" onClick={() => void openDetail(row.id)}>
                      {t('common.view')}
                    </Button>
                  ),
                },
              ]}
            />
          </PageSection>
        </>
      )}

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail?.changeset.title || t('changesets.detail')}
        loading={detailLoading}
        extra={
          detail ? (
            <Space size={8}>
              {canPublish(detail.changeset.status) ? (
                <Button type="primary" size="small" onClick={() => setAction({ kind: 'publish', id: detail.changeset.id })}>
                  {t('changesets.publish')}
                </Button>
              ) : null}
              {canReject(detail.changeset.status) ? (
                <Button danger size="small" onClick={() => setAction({ kind: 'reject', id: detail.changeset.id })}>
                  {t('changesets.reject')}
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Tag color={statusColor(detail.changeset.status)}>{statusLabel(detail.changeset.status)}</Tag>
              <span className="text-[var(--color-text-secondary)]">{t('changesets.reason')}：{detail.changeset.reason || '—'}</span>
            </div>
            <DataTable
              size="small"
              rowKey={(row) => `${row.service_name}|${row.key}`}
              dataSource={detail.entries}
              pagination={false}
              columns={[
                { title: t('domains.col.key'), dataIndex: 'key', render: (value: string) => <code className="font-mono text-xs">{value}</code> },
                { title: t('domains.col.scope'), dataIndex: 'service_name', width: 140, render: (value: string) => value || t('domains.base') },
                { title: t('domains.col.type'), dataIndex: 'value_type', width: 90 },
              ]}
            />
          </div>
        ) : null}
      </Drawer>

      {action ? (
        <ReasonModal
          title={action.kind === 'publish' ? t('changesets.publish') : t('changesets.reject')}
          description={<Alert type="warning" showIcon title={t('changesets.reasonHint')} />}
          confirmText={action.kind === 'publish' ? t('changesets.publish') : t('changesets.reject')}
          danger={action.kind === 'reject'}
          busy={busy}
          onCancel={() => setAction(null)}
          onConfirm={(reason) => void submitAction(reason)}
        />
      ) : null}
    </>
  );
}
