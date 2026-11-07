import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Input, Select, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { AppPageHeader, SectionCard } from '@autional/ui';
import { DataTable, DateRangeFilter } from '@autional/ui/antd';
import { CHANGES_PAGE_SIZE, buildChangesQuery, normalizeChanges, toChangeRow } from '@/lib/changes';
import type { ChangeRow } from '@/lib/changes';
import { changes as fetchChanges } from '@/lib/api';
import { DATA_MODE } from '@/lib/config';
import { errorText } from '@/lib/data';
import { useConfigData } from '../config-data';
import { scopeLabel } from '@/lib/model';

/** 变更记录：跨服务的配置项历史（只读）。演示数据没有后端历史，故 mock 模式只给说明。 */
export default function ChangesPage() {
  const { t } = useTranslation();
  const { meta } = useConfigData();
  const [service, setService] = useState('');
  const [prefix, setPrefix] = useState('');
  const [operator, setOperator] = useState('');
  const [range, setRange] = useState<[string, string] | null>(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (DATA_MODE !== 'api') return;
    setLoading(true);
    setError('');
    try {
      const query = buildChangesQuery(
        {
          service_name: service || undefined,
          key_prefix: prefix || undefined,
          created_by: operator || undefined,
          from: range ? new Date(range[0]) : null,
          to: range ? new Date(range[1]) : null,
        },
        page,
        CHANGES_PAGE_SIZE,
      );
      const result = normalizeChanges(await fetchChanges(query), page, CHANGES_PAGE_SIZE);
      setRows((result.items ?? []).map((item, index) => toChangeRow(item, index)));
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(errorText(err));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, prefix, service, operator, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(
    () => [
      {
        title: t('changes.col.time'),
        dataIndex: 'time',
        width: 180,
        render: (value: string, row: ChangeRow) => <Tooltip title={row.timeRaw}>{value}</Tooltip>,
      },
      { title: t('changes.col.scope'), width: 150, render: (_: unknown, row: ChangeRow) => scopeLabel(row.serviceName) },
      { title: t('changes.col.key'), dataIndex: 'key', render: (value: string) => <code className="font-mono text-xs">{value}</code> },
      { title: t('changes.col.revision'), dataIndex: 'revision', width: 90 },
      { title: t('changes.col.operator'), dataIndex: 'createdBy', width: 140 },
      { title: t('changes.col.reason'), dataIndex: 'reason', ellipsis: true },
      { title: t('changes.col.changeset'), dataIndex: 'changeset', width: 150, ellipsis: true },
    ],
    [t],
  );

  return (
    <>
      <AppPageHeader title={t('changes.title')} description={t('changes.description')} />
      {DATA_MODE !== 'api' ? (
        <Alert className="mb-4" type="info" showIcon title={t('changes.demoHint')} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              className="w-56"
              value={service}
              onChange={(value) => {
                setService(value);
                setPage(1);
              }}
              options={[
                { value: '', label: t('changes.allServices') },
                ...meta.services.map((name) => ({ value: name, label: name })),
              ]}
            />
            <Input.Search
              className="w-64"
              allowClear
              placeholder={t('changes.keyPrefix')}
              onSearch={(value) => {
                setPrefix(value.trim());
                setPage(1);
              }}
            />
            <Input.Search
              className="w-56"
              allowClear
              placeholder={t('changes.operator')}
              onSearch={(value) => {
                setOperator(value.trim());
                setPage(1);
              }}
            />
            <DateRangeFilter
              value={range}
              onChange={(value) => {
                setRange(value);
                setPage(1);
              }}
            />
          </div>
          {error ? <Alert className="mb-3" type="error" showIcon title={error} /> : null}
          <SectionCard padding="none">
            <DataTable
              size="small"
              rowKey="id"
              loading={loading}
              dataSource={rows}
              columns={columns as any}
              scroll={{ x: 1000 }}
              pagination={{
                current: page,
                pageSize: CHANGES_PAGE_SIZE,
                total,
                showSizeChanger: false,
                onChange: setPage,
              }}
            />
          </SectionCard>
        </>
      )}
    </>
  );
}
