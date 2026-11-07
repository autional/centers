import { useState } from 'react';
import { App, Button, Space } from 'antd';
import { Download, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { store } from '@/lib/data';
import { downloadText, exportFilename } from '@/lib/transfer';
import { ImportWizard } from './import-wizard';

/** 导出 JSON/YAML + 导入向导。概览页与配置域页共用同一份实现。 */
export function TransferActions({ onImported }: { onImported?: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [importing, setImporting] = useState(false);

  const doExport = async (format: 'json' | 'yaml') => {
    try {
      const text = await store.exportConfig(format);
      downloadText(exportFilename(format), text, format === 'yaml' ? 'application/yaml' : 'application/json');
      message.success(t('overview.exportDone', { format: format.toUpperCase() }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Space size={8} wrap>
        <Button icon={<Download size={14} />} onClick={() => void doExport('json')}>
          JSON
        </Button>
        <Button icon={<Download size={14} />} onClick={() => void doExport('yaml')}>
          YAML
        </Button>
        <Button icon={<Upload size={14} />} onClick={() => setImporting(true)}>
          {t('import.title')}
        </Button>
      </Space>
      <ImportWizard open={importing} onClose={() => setImporting(false)} onDone={async () => { await onImported?.(); }} />
    </>
  );
}
