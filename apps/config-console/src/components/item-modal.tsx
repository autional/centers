import { useEffect } from 'react';
import { Alert, Form, Input, InputNumber, Select, Switch } from 'antd';
import { Modal } from '@autional/ui/antd';
import { useTranslation } from 'react-i18next';
import type { Item, ItemType, Scope } from '@/lib/model';
import { scopeLabel } from '@/lib/model';
import { MASK_TEXT, RevealCache, isMasked } from '@/lib/reveal';

export type ItemModalState = {
  mode: 'add' | 'edit';
  item: Item;
  domain: string;
  group: string;
  scope: Scope;
  suggestedKey?: string;
};

/** 新增 / 编辑配置项。遮罩值未查看明文前禁止编辑（避免把占位值写回后端）。 */
export function ItemModal(props: {
  state: ItemModalState;
  onCancel: () => void;
  onSubmit: (item: Item) => void;
}) {
  const { t } = useTranslation();
  const { state, onCancel, onSubmit } = props;
  const [form] = Form.useForm<Item>();
  const type = Form.useWatch('t', form) ?? state.item.t;

  const cached = state.mode === 'edit' ? RevealCache.get(state.item.s, state.item.k) : undefined;
  const masked = isMasked({ value: state.item.v, masked: state.item.masked });
  const valueLocked = state.mode === 'edit' && masked && cached === undefined;

  useEffect(() => {
    form.setFieldsValue({
      ...state.item,
      k: state.item.k || state.suggestedKey || '',
      v: cached ?? (valueLocked ? MASK_TEXT : state.item.v),
    });
  }, [form, state, cached, valueLocked]);

  return (
    <Modal
      open
      title={state.mode === 'add' ? t('item.add') : t('item.edit')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: valueLocked }}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          const item: Item = {
            s: state.scope,
            k: String(values.k).trim(),
            t: values.t,
            v: String(values.v ?? ''),
            d: state.domain,
            g: state.group,
            masked: false,
          };
          if (!item.k) return;
          onSubmit(item);
        }}
      >
        <Form.Item label={t('item.scope')}>
          <Input value={scopeLabel(state.scope)} disabled />
        </Form.Item>
        <Form.Item name="k" label={t('item.key')} rules={[{ required: true, message: t('item.keyRequired') }]}>
          <Input className="font-mono" disabled={state.mode === 'edit'} placeholder="smtp.host" />
        </Form.Item>
        <Form.Item name="t" label={t('item.type')} rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'scalar', label: 'scalar' },
              { value: 'int', label: 'int' },
              { value: 'bool', label: 'bool' },
              { value: 'yaml', label: 'yaml' },
            ]}
          />
        </Form.Item>
        <Form.Item name="v" label={t('item.value')}>
          {type === 'bool' ? (
            <Switch disabled={valueLocked} />
          ) : type === 'int' ? (
            <InputNumber className="w-full" disabled={valueLocked} />
          ) : (
            <Input.TextArea rows={3} className="font-mono" disabled={valueLocked} />
          )}
        </Form.Item>
        {valueLocked ? <Alert type="warning" showIcon title={t('item.needReveal')} /> : null}
        {cached !== undefined && masked ? <Alert type="info" showIcon title={t('item.revealedFilled')} /> : null}
        {state.mode === 'add' ? (
          <Alert type="info" showIcon title={t('item.writeTarget', { scope: scopeLabel(state.scope), group: state.group })} />
        ) : null}
      </Form>
    </Modal>
  );
}
