import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Popconfirm, Segmented, Select, Space, Switch, Table, Tag } from 'antd';
import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppPageHeader, SectionCard } from '@autional/ui';
import { aggregate, isRule, itemId } from '@/lib/model';
import type { Item, ItemType } from '@/lib/model';
import { store } from '@/lib/data';
import { useConfigData } from '../config-data';
import { useWriteGate } from '@/hooks/use-write-gate';
import { ItemModal } from '@/components/item-modal';
import type { ItemModalState } from '@/components/item-modal';
import { PlacementDrawer } from '@/components/placement-drawer';
import { maskText } from '@/lib/reveal';

const TYPE_TAG: Record<ItemType, string> = { int: 'blue', bool: 'green', yaml: 'orange', scalar: 'default' };

export default function DomainDetailPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { domain = '' } = useParams();
  const { items, meta, reload } = useConfigData();
  const { requestWrite, node: writeNode } = useWriteGate(reload);

  const [group, setGroup] = useState('');
  const [service, setService] = useState('all');
  const [scope, setScope] = useState<'all' | 'base' | 'svc'>('all');
  const [keyword, setKeyword] = useState('');
  const [hideRules, setHideRules] = useState(true);
  const [modal, setModal] = useState<ItemModalState | null>(null);
  const [viewing, setViewing] = useState<{ domain: string; key: string } | null>(null);

  const detail = meta.domains.find((item) => item.name === domain);
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) if (item.d === domain && item.s) set.add(item.s);
    return Array.from(set).sort();
  }, [items, domain]);

  const single = service !== 'all';
  const rows = useMemo(() => {
    if (!single) {
      return aggregate(items, domain, {
        group: group || undefined,
        scope,
        q: keyword,
        hideRules,
      });
    }
    let list = items.filter((item) => item.d === domain && item.s === service);
    if (group) list = list.filter((item) => item.g === group);
    if (hideRules) list = list.filter((item) => !isRule(item));
    const q = keyword.trim().toLowerCase();
    if (q) list = list.filter((item) => item.k.toLowerCase().includes(q) || item.v.toLowerCase().includes(q));
    return list;
  }, [single, items, domain, group, scope, keyword, hideRules, service]);

  const openAdd = () => {
    const targetGroup = group || detail?.groups[0]?.name || '';
    setModal({
      mode: 'add',
      domain,
      group: targetGroup,
      scope: service === 'all' ? '' : service,
      item: { s: service === 'all' ? '' : service, k: '', t: 'scalar', v: '', d: domain, g: targetGroup },
    });
  };

  return (
    <>
      <AppPageHeader
        title={domain}
        description={detail?.desc || t('domains.detailFallback')}
        actions={
          <Space size={8} wrap>
            <Link to="/domains" className="text-sm text-[var(--color-primary-600)]">
              {t('common.back')}
            </Link>
            <Button type="primary" icon={<Plus size={14} />} onClick={openAdd}>
              {t('domains.addItem')}
            </Button>
          </Space>
        }
      />

      <Alert className="mb-4" type="info" showIcon title={t('domains.inheritHint')} />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <SectionCard padding="none" className="self-start">
          <div className="px-3 py-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            {t('domains.groupList')}
          </div>
          <ul>
            <li>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  group === '' ? 'bg-[var(--color-bg-muted)] font-semibold' : ''
                }`}
                onClick={() => setGroup('')}
              >
                <span>{t('domains.allGroups')}</span>
                <span className="text-xs text-[var(--color-text-secondary)]">{detail?.count ?? 0}</span>
              </button>
            </li>
            {detail?.groups.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    group === entry.name ? 'bg-[var(--color-bg-muted)] font-semibold' : ''
                  }`}
                  onClick={() => setGroup(entry.name)}
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="text-xs text-[var(--color-text-secondary)]">{entry.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input.Search
              allowClear
              className="w-64"
              placeholder={t('domains.search')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              className="w-56"
              value={service}
              onChange={setService}
              options={[
                { value: 'all', label: t('domains.allServices') },
                { value: '', label: t('domains.baseOnly') },
                ...services.map((name) => ({ value: name, label: name })),
              ]}
            />
            <Segmented
              value={scope}
              onChange={(value) => setScope(value as 'all' | 'base' | 'svc')}
              options={[
                { value: 'all', label: t('domains.scopeAll') },
                { value: 'base', label: t('domains.scopeBase') },
                { value: 'svc', label: t('domains.scopeSvc') },
              ]}
            />
            <span className="flex items-center gap-2 text-sm">
              <Switch size="small" checked={hideRules} onChange={setHideRules} />
              {t('domains.hideRules')}
            </span>
          </div>

          <Table
            size="small"
            rowKey={(row: any) => (single ? itemId(row.s, row.k) : row.k)}
            dataSource={rows as any[]}
            pagination={{ pageSize: 50, showSizeChanger: false }}
            scroll={{ x: 900 }}
            columns={
              single
                ? [
                    { title: t('domains.col.key'), dataIndex: 'k', width: '32%', render: (v: string) => <code className="font-mono text-xs">{v}</code> },
                    { title: t('domains.col.group'), dataIndex: 'g', width: 140 },
                    { title: t('domains.col.value'), dataIndex: 'v', ellipsis: true, render: (v: string) => <span className="font-mono text-xs">{maskText({ value: v })}</span> },
                    { title: t('domains.col.type'), dataIndex: 't', width: 80, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
                    {
                      title: t('domains.col.actions'),
                      width: 140,
                      render: (_: unknown, row: Item) => (
                        <Space size={0}>
                          <Button size="small" type="link" onClick={() => setModal({ mode: 'edit', item: row, domain, group: row.g, scope: row.s })}>
                            {t('common.edit')}
                          </Button>
                          <Popconfirm title={t('domains.deleteConfirm')} onConfirm={() => requestWrite({ kind: 'delete', item: row })}>
                            <Button size="small" type="link" danger>
                              {t('common.delete')}
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]
                : [
                    {
                      title: t('domains.col.key'),
                      dataIndex: 'k',
                      width: '30%',
                      render: (v: string) => (
                        <button
                          type="button"
                          className="font-mono text-xs text-[var(--color-primary-600)] hover:underline"
                          onClick={() => setViewing({ domain, key: v })}
                        >
                          {v}
                        </button>
                      ),
                    },
                    { title: t('domains.col.group'), dataIndex: 'g', width: 130 },
                    {
                      title: t('domains.col.value'),
                      dataIndex: 'v',
                      ellipsis: true,
                      render: (v: string, row: any) => (
                        <Space size={6}>
                          <span className="font-mono text-xs">{maskText({ value: v })}</span>
                          {row.distinct > 1 ? <Tag color="blue">{t('domains.distinct', { count: row.distinct })}</Tag> : null}
                        </Space>
                      ),
                    },
                    { title: t('domains.col.type'), dataIndex: 't', width: 80, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
                    {
                      title: t('domains.col.scope'),
                      width: 110,
                      render: (_: unknown, row: any) =>
                        row.base && row.services ? <Tag color="purple">{t('domains.mixed')}</Tag> : row.base ? <Tag>{t('domains.base')}</Tag> : <Tag color="blue">{t('domains.svc')}</Tag>,
                    },
                    {
                      title: t('domains.col.actions'),
                      width: 90,
                      render: (_: unknown, row: any) => (
                        <Button size="small" type="link" onClick={() => setViewing({ domain, key: row.k })}>
                          {t('common.view')}
                        </Button>
                      ),
                    },
                  ]
            }
          />
        </SectionCard>
      </div>

      {modal ? (
        <ItemModal
          state={modal}
          onCancel={() => setModal(null)}
          onSubmit={(item) => {
            setModal(null);
            requestWrite({ kind: 'upsert', item });
          }}
        />
      ) : null}

      <PlacementDrawer
        state={viewing}
        items={items}
        onClose={() => setViewing(null)}
        onEdit={(item) => setModal({ mode: 'edit', item, domain, group: item.g, scope: item.s })}
        onDelete={(item) => requestWrite({ kind: 'delete', item })}
        historyFor={store.remoteEffective ? (item) => store.history(item) : undefined}
        onRollback={(item, revision) => requestWrite({ kind: 'rollback', item, revision })}
      />

      {writeNode}
    </>
  );
}
