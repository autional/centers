import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Empty, Popconfirm, Select, Space, Spin, Tag } from 'antd';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppPageHeader } from '@autional/ui';
import { PageSection } from '@/components/page-section';
import { DataTable } from '@autional/ui/antd';
import { editorOf, coveredKeys } from '@/lib/editors';
import { localizeEditorText } from '@/lib/editor-i18n';
import type { GroupEditor } from '@/lib/editors';
import { groupEffective, servicesInGroup } from '@/lib/model';
import type { Item } from '@/lib/model';
import { store } from '@/lib/data';
import { isMasked } from '@/lib/reveal';
import { useConfigData } from '../config-data';
import { useWriteGate } from '@/hooks/use-write-gate';
import { ItemModal } from '@/components/item-modal';
import type { ItemModalState } from '@/components/item-modal';

export default function GroupEditorPage() {
  const { t, i18n } = useTranslation();
  const { domain = '', group = '' } = useParams();
  const { items, reload } = useConfigData();
  const { requestWrite, node: writeNode } = useWriteGate(reload);
  const [scope, setScope] = useState('');
  const [modal, setModal] = useState<ItemModalState | null>(null);
  const [remoteEditor, setRemoteEditor] = useState<GroupEditor | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState('');

  const localEditor = editorOf(domain, group) ?? null;
  const services = useMemo(() => servicesInGroup(items, domain, group), [items, domain, group]);
  const rows = useMemo(() => groupEffective(items, domain, group, scope), [items, domain, group, scope]);

  useEffect(() => {
    if (!store.remoteEditor) return;
    let alive = true;
    setEditorLoading(true);
    setEditorError('');
    store
      .editor(domain, group)
      .then((next) => alive && setRemoteEditor(next))
      .catch((err) => alive && setEditorError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setEditorLoading(false));
    return () => {
      alive = false;
    };
  }, [domain, group]);

  const editor = remoteEditor ?? localEditor;
  const covered = coveredKeys(domain, group);
  const others = useMemo(
    () => (covered ? rows.filter((row) => !covered.has(row.k)) : rows),
    [rows, covered],
  );

  const resolveField = (keys: string[]) => {
    for (const key of keys) {
      const hit = rows.find((row) => row.k === key);
      if (hit) return hit;
    }
    return null;
  };

  return (
    <>
      <AppPageHeader
        title={group}
        description={localizeEditorText(editor?.note, i18n.language) || t('group.noEditorNote')}
        actions={
          <Space size={8} wrap>
            <Link to={`/domains/${encodeURIComponent(domain)}`} className="text-sm text-[var(--color-primary-600)]">
              {t('common.back')}
            </Link>
            <Select
              className="w-44"
              value={scope}
              onChange={setScope}
              options={[
                { value: '', label: t('group.scopeBase') },
                ...services.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Space>
        }
      />

      {editorError ? <Alert className="mb-4" type="warning" showIcon title={t('group.editorFallback')} description={editorError} /> : null}
      {!editor ? <Alert className="mb-4" type="info" showIcon title={t('group.defaultForm')} /> : null}

      {editorLoading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : editor ? (
        <PageSection className="mb-4">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {editor.fields.map((field) => {
              const hit = resolveField(field.keys);
              const secretKeys = (field.secret ?? []).join(' / ');
              return (
                <div key={field.label} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[220px_1fr_auto] sm:items-center">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">{localizeEditorText(field.label, i18n.language)}</div>
                    {field.hint ? <div className="text-xs text-[var(--color-text-secondary)]">{localizeEditorText(field.hint, i18n.language)}</div> : null}
                  </div>
                  <div className="min-w-0">
                    {secretKeys ? (
                      <div className="space-y-1">
                        <code className="text-xs">{secretKeys}</code>
                        <div className="text-xs text-[var(--color-text-secondary)]">{t('group.secretRefHint')}</div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="break-all font-mono text-xs">{hit ? (isMasked({ value: hit.v, masked: hit.masked }) ? t('common.masked') : hit.v) : '—'}</span>
                        {hit ? (
                          <Tag color={hit.src === 'override' ? 'blue' : hit.src === 'inherit' ? 'default' : 'default'}>
                            {hit.src === 'override' ? t('group.override') : hit.src === 'inherit' ? t('group.inherit') : t('group.base')}
                          </Tag>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div>
                    {field.keys.length || field.secret?.length ? (
                      <Button
                        size="small"
                        onClick={() =>
                          setModal({
                            mode: hit ? 'edit' : 'add',
                            domain,
                            group,
                            scope,
                            suggestedKey: field.keys[0],
                            item: hit ?? {
                              s: scope,
                              k: field.keys[0] ?? '',
                              t: field.kind === 'int' ? 'int' : field.kind === 'bool' ? 'bool' : 'scalar',
                              v: '',
                              d: domain,
                              g: group,
                            },
                          })
                        }
                        disabled={!!secretKeys}
                      >
                        {hit ? t('common.edit') : t('group.define')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </PageSection>
      ) : null}

      <PageSection title={t('group.otherItems', { count: others.length })}>
        {others.length === 0 ? (
          <Empty description={t('group.otherEmpty')} />
        ) : (
          <DataTable
            size="small"
            rowKey={(row: Item) => `${row.s}|${row.k}`}
            dataSource={others}
            pagination={{ pageSize: 50, showSizeChanger: false }}
            columns={[
              { title: t('domains.col.key'), dataIndex: 'k', render: (v: string) => <code className="font-mono text-xs">{v}</code> },
              { title: t('domains.col.value'), dataIndex: 'v', ellipsis: true, render: (v: string, row: Item) => <span className="font-mono text-xs">{isMasked({ value: v, masked: row.masked }) ? t('common.masked') : v}</span> },
              {
                title: t('domains.col.scope'),
                width: 110,
                render: (_: unknown, row: any) => (row.src === 'override' ? <Tag color="blue">{t('group.override')}</Tag> : row.src === 'inherit' ? <Tag>{t('group.inherit')}</Tag> : <Tag>{t('group.base')}</Tag>),
              },
              {
                title: t('domains.col.actions'),
                width: 140,
                render: (_: unknown, row: Item) => (
                  <Space size={0}>
                    <Button size="small" type="link" onClick={() => setModal({ mode: 'edit', item: row, domain, group, scope: row.s })}>
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
            ]}
          />
        )}
      </PageSection>

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

      {writeNode}
    </>
  );
}
