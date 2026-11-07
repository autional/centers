import { useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Tag, Upload } from 'antd';
import { Upload as UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, DataTable } from '@autional/ui/antd';
import { createChangeset } from '@/lib/api';
import type { ImportPreviewResult } from '@/lib/api';
import { errorText, store } from '@/lib/data';
import { toChangesetEntries } from '@/lib/changesets';
import { parseImportText, toImportEntries } from '@/lib/transfer';
import type { ParsedEntry } from '@/lib/transfer';
import { ReasonModal } from './reason-modal';

type Step = 'input' | 'review';

/** 导入向导：粘贴/上传 → 解析 → 预检（只读）→ 应用 或 存为变更单。 */
export function ImportWizard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');

  const reset = () => {
    setStep('input');
    setText('');
    setEntries([]);
    setPreview(null);
    setError('');
    setTitle('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const doPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const parsed = parseImportText(text, '');
      setEntries(parsed.entries);
      const result = await store.previewImport(parsed.entries);
      setPreview(result);
      setStep('review');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const doApply = async (reason: string) => {
    setBusy(true);
    try {
      const outcomes = await store.importBulk(toImportEntries(preview?.items ?? []), replaceExisting, reason);
      const failed = outcomes.filter((row) => !row.ok);
      if (failed.length) message.warning(t('import.partial', { count: failed.length }));
      else message.success(t('import.applied', { count: outcomes.length }));
      setApplying(false);
      close();
      await onDone();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const doSaveChangeset = async (reason: string) => {
    if (!preview || !title.trim()) return;
    setBusy(true);
    try {
      const detail = await createChangeset({ title: title.trim(), reason, entries: toChangesetEntries(preview.items) });
      message.success(t('import.changesetSaved', { title: detail.changeset.title }));
      setSaving(false);
      close();
      await onDone();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = preview?.counts;
  const canWrite = preview?.writable !== false && store.mode === 'api';

  const columns = useMemo(
    () => [
      {
        title: t('import.col.action'),
        dataIndex: 'action',
        width: 110,
        render: (value: string) => (
          <Tag color={value === 'create' ? 'green' : value === 'update' ? 'blue' : value === 'invalid' ? 'red' : 'default'}>
            {t(`import.action.${value}`)}
          </Tag>
        ),
      },
      { title: t('import.col.scope'), dataIndex: 'service_name', width: 140, render: (value: string) => value || t('domains.base') },
      { title: t('import.col.key'), dataIndex: 'key', render: (value: string) => <code className="font-mono text-xs">{value}</code> },
      { title: t('import.col.value'), dataIndex: 'value', ellipsis: true, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
      { title: t('import.col.reason'), dataIndex: 'reason', width: 200, ellipsis: true },
    ],
    [t],
  );

  return (
    <Modal
      open={open}
      onCancel={close}
      width={880}
      title={t('import.title')}
      footer={
        step === 'input' ? (
          <Button type="primary" loading={busy} disabled={!text.trim()} onClick={() => void doPreview()}>
            {t('import.preview')}
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => setStep('input')}>{t('common.back')}</Button>
            <Button loading={busy} disabled={!canWrite} onClick={() => setSaving(true)}>
              {t('import.saveChangeset')}
            </Button>
            <Button type="primary" loading={busy} disabled={!canWrite} onClick={() => setApplying(true)}>
              {t('import.apply')}
            </Button>
          </div>
        )
      }
    >
      {step === 'input' ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-secondary)]">{t('import.hint')}</p>
          <Upload
            accept=".json,.yaml,.yml"
            showUploadList={false}
            beforeUpload={(file) => {
              void file.text().then((content) => setText(content));
              return false;
            }}
          >
            <Button icon={<UploadIcon size={14} />}>{t('import.pickFile')}</Button>
          </Upload>
          <Input.TextArea
            rows={12}
            className="font-mono"
            placeholder={t('import.placeholder')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {error ? <Alert type="error" showIcon title={error} /> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {counts ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Tag color="green">{t('import.action.create')} {counts.create}</Tag>
              <Tag color="blue">{t('import.action.update')} {counts.update}</Tag>
              <Tag>{t('import.action.unchanged')} {counts.unchanged}</Tag>
              <Tag color="red">{t('import.action.invalid')} {counts.invalid}</Tag>
              <Tag>{t('import.action.skipped')} {counts.skipped}</Tag>
            </div>
          ) : null}
          {!canWrite ? <Alert type="info" showIcon title={t('import.readOnly')} /> : null}
          <Checkbox checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)}>
            {t('import.replaceExisting')}
          </Checkbox>
          <DataTable
            size="small"
            rowKey={(row) => `${row.service_name}|${row.key}`}
            dataSource={preview?.items ?? []}
            columns={columns as any}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
          />
        </div>
      )}

      {applying ? (
        <ReasonModal
          title={t('import.apply')}
          description={<Alert type="warning" showIcon title={t('import.applyHint')} />}
          confirmText={t('import.apply')}
          busy={busy}
          onCancel={() => setApplying(false)}
          onConfirm={(reason) => void doApply(reason)}
        />
      ) : null}

      {saving ? (
        <Modal
          open
          title={t('import.saveChangeset')}
          onCancel={() => setSaving(false)}
          onOk={() => setSaving(true)}
          footer={null}
        >
          <div className="space-y-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('import.changesetTitle')} maxLength={200} />
            <ReasonModalInline busy={busy} onCancel={() => setSaving(false)} onConfirm={(reason) => void doSaveChangeset(reason)} />
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}

function ReasonModalInline({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const invalid = !reason.trim() || reason.trim().length > 200;
  return (
    <div className="space-y-2">
      <Input.TextArea rows={3} maxLength={200} showCount value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reason.placeholder')} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="primary" loading={busy} disabled={invalid} onClick={() => onConfirm(reason.trim())}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
