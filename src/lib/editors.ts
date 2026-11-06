export type FieldKind = 'text' | 'int' | 'bool';

export type Field = {
  label: string;
  /** 候选键：按顺序取当前作用域，其次基座 */
  keys: string[];
  kind?: FieldKind;
  /** 关联密钥（只显示键名） */
  secret?: string[];
  /** 保存的是「密钥键名」而不是值 */
  secretRef?: boolean;
  hint?: string;
};

export type GroupEditor = { note: string; fields: Field[] };

/** 注册键 = 域|组。组名跨域唯一，但仍带域以防将来重名。 */
export const EDITORS: Record<string, GroupEditor> = {
  '邮件与短信|邮件发送': {
    note: 'SMTP 连接与发件人。合并 smtp.* / notification.smtp.* / email.* 三套键。',
    fields: [
      { label: '主机', keys: ['notification.smtp.host', 'email.host', 'smtp.host'], hint: '支持 ${ENV} 占位' },
      { label: '端口', kind: 'int', keys: ['notification.smtp.port', 'email.port', 'smtp.port'] },
      { label: '用户名', keys: ['email.username', 'smtp.username'] },
      { label: '密码', keys: [], secret: ['EMAIL_PASSWORD', 'SMTP_PASSWORD'], hint: '值存于密钥中心；此处只显示键名' },
      { label: '启用 TLS', kind: 'bool', keys: ['email.use_tls', 'smtp.use_tls'] },
      { label: '启用 SSL', kind: 'bool', keys: ['email.use_ssl', 'smtp.use_ssl'] },
      { label: '发件地址', keys: ['email.from'] },
      { label: '发件人名称', keys: ['email.from_name'] },
    ],
  },
  '邮件与短信|短信与推送': {
    note: '短信服务商与推送通道。',
    fields: [
      { label: '短信提供方', keys: ['sms.provider'] },
      { label: '短信签名', keys: ['sms.pnvs.sign_name'] },
      { label: '默认模板', keys: ['sms.pnvs.template_code'] },
      { label: '允许真实发送', kind: 'bool', keys: ['sms.pnvs.allow_real_send_in_dev'] },
      { label: '推送提供方', keys: ['push.provider'] },
      { label: '推送端点', keys: ['push.fcm_endpoint'] },
    ],
  },
  '数据库|PostgreSQL': {
    note: '端点 + 身份 + 凭据引用。定位（host/port）由部署环境提供。',
    fields: [
      { label: '驱动', keys: ['db.driver', 'gorm.driver'] },
      { label: '主机', keys: ['db.postgres.host', 'postgres.host', 'gorm.postgres.host'] },
      { label: '端口', kind: 'int', keys: ['db.postgres.port', 'postgres.port', 'gorm.postgres.port'] },
      { label: '库名', keys: ['db.postgres.database', 'postgres.database', 'gorm.postgres.database'] },
      { label: '用户名', keys: ['db.postgres.username', 'postgres.username', 'gorm.postgres.username'] },
      { label: '口令密钥键', secretRef: true, keys: ['db.postgres.password_key', 'postgres.password_key', 'gorm.postgres.password_key'] },
    ],
  },
  '数据库|连接池': {
    note: '按服务调整；基座值是默认。',
    fields: [
      { label: '最大连接', kind: 'int', keys: ['db.postgres.max_open_conns', 'postgres.max_open_conns', 'gorm.postgres.max_open_conns'] },
      { label: '最大空闲', kind: 'int', keys: ['db.postgres.max_idle_conns', 'postgres.max_idle_conns', 'gorm.postgres.max_idle_conns'] },
      { label: '连接生命周期', keys: ['db.postgres.max_conn_lifetime', 'postgres.max_conn_lifetime', 'gorm.postgres.max_conn_lifetime'] },
      { label: '空闲超时', keys: ['db.postgres.conn_max_idle_time', 'postgres.conn_max_idle_time'] },
    ],
  },
};

export const RATE_LIMIT_GROUP = '限流与配额|接口限流';

export const editorOf = (domain: string, group: string) => EDITORS[`${domain}|${group}`];

/** 组内被定制表单覆盖的键（含候选键）。 */
export function coveredKeys(domain: string, group: string): Set<string> | null {
  const ed = editorOf(domain, group);
  if (!ed) return null;
  const s = new Set<string>();
  for (const f of ed.fields) for (const k of f.keys) s.add(k);
  return s;
}
