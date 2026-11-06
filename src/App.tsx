import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  App as AntdApp,
  Breadcrumb,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Result,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import { DOMAIN_META, aggregate, groupEffective, isRule, itemId, scopeLabel, servicesInGroup } from './lib/model';
import type { Item, ItemType, Scope } from './lib/model';
import { RATE_LIMIT_GROUP, editorOf } from './lib/editors';
import type { Field, GroupEditor } from './lib/editors';
import { API_BASE, AUTH_MODE, DATA_MODE, isCallbackPath, OIDC, RUNTIME_MODE_LABEL, REQUIRE_AUTH } from './lib/config';
import { completeLogin, restoreSession, signOut, startLogin } from './lib/auth';
import type { Session } from './lib/auth';
import { UNAUTHORIZED_EVENT } from './lib/api';
import { EMPTY_META, errorStatus, errorText, store } from './lib/data';
import type { EffectiveRow, HistoryEntry, Meta } from './lib/data';
import './styles.css';

const { Text } = Typography;

type Route = { domain?: string; edit?: boolean; group?: string };
type ModalState = { mode: 'add' | 'edit'; item: Item; domain: string; group: string; scope: Scope; suggestedKey?: string };
type Status = 'loading' | 'ready' | 'error' | 'forbidden' | 'unauthorized';
type PendingWrite =
  | { kind: 'upsert'; item: Item }
  | { kind: 'delete'; item: Item }
  | { kind: 'rollback'; item: Item; revision: number };

const WRITE_TITLE: Record<PendingWrite['kind'], string> = {
  upsert: '保存配置项',
  delete: '删除配置项',
  rollback: '回滚配置项',
};

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const p = raw.split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] !== 'd' || !p[1]) return {};
  return { domain: p[1], edit: p[2] === 'edit', group: p[3] };
}

function href(route: Route) {
  if (!route.domain) return '#/';
  let s = `#/d/${encodeURIComponent(route.domain)}`;
  if (route.edit) s += '/edit';
  if (route.edit && route.group) s += `/${encodeURIComponent(route.group)}`;
  return s;
}

const TYPE_TAG: Record<ItemType, string> = { int: 'blue', bool: 'green', yaml: 'orange', scalar: 'default' };

function valueText(v: string) {
  return v === '••••••' ? '已脱敏' : v;
}

/** 登录态引导（进程内只跑一次）：StrictMode 二次挂载 / 热更新不会重复消费授权码。 */
type BootResult = { session: Session | null; error: string };
let authBoot: Promise<BootResult> | null = null;

function bootstrapAuth(): Promise<BootResult> {
  if (authBoot) return authBoot;
  authBoot = (async (): Promise<BootResult> => {
    try {
      // OIDC 回调页：用 code + PKCE 换票，然后清掉 URL 上的 code/state（避免刷新重放授权码）。
      if (AUTH_MODE === 'oidc' && isCallbackPath()) {
        const session = await completeLogin();
        window.history.replaceState(null, '', `/${window.location.hash || ''}`);
        return { session, error: '' };
      }
      return { session: await restoreSession(), error: '' };
    } catch (err) {
      return { session: null, error: errorText(err) };
    }
  })();
  return authBoot;
}

/** 顶层只负责挂 antd 的 App 上下文，业务状态在 Console（这样 Console 内可用 useApp 的 message）。 */
export default function Root() {
  return (
    <AntdApp>
      <Console />
    </AntdApp>
  );
}

function Console() {
  const { message } = AntdApp.useApp();
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [viewing, setViewing] = useState<{ domain: string; key: string } | null>(null);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [busy, setBusy] = useState(false);

  const needsLogin = !session && (REQUIRE_AUTH || DATA_MODE === 'api');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setStatus('loading');
      try {
        const snapshot = await store.load();
        setItems(snapshot.items);
        setMeta(snapshot.meta);
        setErrorMessage('');
        setStatus('ready');
      } catch (err) {
        const code = errorStatus(err);
        setErrorMessage(errorText(err));
        setStatus(code === 401 ? 'unauthorized' : code === 403 ? 'forbidden' : 'error');
        if (silent) message.error(errorText(err));
      }
    },
    [message],
  );

  /* 登录态：处理 OIDC 回调（换票）或恢复已有会话。 */
  useEffect(() => {
    let alive = true;
    void bootstrapAuth().then((result) => {
      if (!alive) return;
      setAuthError(result.error);
      setSession(result.session);
      setAuthReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 令牌失效（401）→ 清会话、回登录态。 */
  useEffect(() => {
    const onUnauthorized = () => {
      void signOut().then(() => setSession(null));
      setStatus('unauthorized');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  /* 数据加载：api 模式必须已登录（管理面需要 JWT）；mock 模式无条件加载，保证公开演示可用。 */
  useEffect(() => {
    if (!authReady) return;
    if (DATA_MODE === 'api' && !session) {
      setStatus('unauthorized');
      return;
    }
    void load();
  }, [authReady, session, load]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (r: Route) => {
    window.location.hash = href(r);
    setRoute(r);
    window.scrollTo({ top: 0 });
  };

  const login = async () => {
    setAuthError('');
    try {
      const next = await startLogin();
      if (next) {
        setSession(next);
        setStatus('loading');
      }
    } catch (err) {
      setAuthError(errorText(err));
    }
  };

  const logout = async () => {
    await signOut();
    setSession(null);
    setItems([]);
    setMeta(EMPTY_META);
    setStatus('unauthorized');
  };

  const performWrite = async (write: PendingWrite, reason: string) => {
    setBusy(true);
    try {
      if (write.kind === 'upsert') await store.upsert(write.item, reason);
      else if (write.kind === 'delete') await store.remove(write.item, reason);
      else await store.rollback(write.item, write.revision, reason);
      message.success(
        write.kind === 'delete' ? '已删除（软删，版本保留）' : write.kind === 'rollback' ? '已回滚（生成新 revision）' : '已保存',
      );
      setPending(null);
      await load(true);
    } catch (err) {
      message.error(errorText(err));
      if (!store.localWrites) setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const requestWrite = (write: PendingWrite) => {
    // 演示模式（mock）不调用后端、也不需要原因：保持原有「本地可编辑」体验。
    if (store.localWrites) {
      void performWrite(write, '');
      return;
    }
    setPending(write);
  };

  const resetDemo = async () => {
    store.reset();
    await load(true);
    message.success('已恢复演示数据');
  };

  const userMenuItems: MenuProps['items'] = session
    ? [
        {
          key: 'who',
          disabled: true,
          label: (
            <div className="user-who">
              <b>{session.user.name}</b>
              <div className="hint">{session.user.email || '—'}</div>
            </div>
          ),
        },
        {
          key: 'scope',
          disabled: true,
          label: (
            <div className="hint">
              租户 {session.user.tenantId || '（令牌未带）'} · 应用 {session.user.appId || '平台'}
            </div>
          ),
        },
        { type: 'divider' },
        { key: 'logout', label: '退出登录', danger: true },
      ]
    : [];

  if (!authReady) {
    return (
      <Layout className="app">
        <div className="boot">
          <Spin size="large" />
          <div className="hint">正在校验登录状态…</div>
        </div>
      </Layout>
    );
  }

  if (needsLogin) {
    return <LoginPage error={authError} onLogin={() => void login()} />;
  }

  return (
    <Layout className="app">
      <Layout.Header className="topbar">
        <div className="brand">
          <span className="mark">A</span>
          <span>配置中心</span>
          <Text type="secondary" className="sub">
            Config Console
          </Text>
        </div>
        <nav className="nav">
          <a className={!route.domain ? 'on' : ''} href="#/">
            概览
          </a>
          <a className={route.domain ? 'on' : ''} href={href({ domain: meta.domains[0]?.name })}>
            配置域
          </a>
          <span className="nav-disabled">密钥中心</span>
          <span className="nav-disabled">变更记录</span>
        </nav>
        <div className="grow" />
        <Space size={8}>
          <Tag color="green">实例 prod</Tag>
          {store.localWrites ? <Tag>演示 · 本地可编辑</Tag> : <Tag color="blue">{RUNTIME_MODE_LABEL}</Tag>}
          {store.canReset ? (
            <Popconfirm title="恢复演示数据？" description="会清空本机改动。" onConfirm={() => void resetDemo()}>
              <Button size="small">重置</Button>
            </Popconfirm>
          ) : null}
          {session ? (
            <Dropdown
              trigger={['click']}
              menu={{
                items: userMenuItems,
                onClick: ({ key }) => {
                  if (key === 'logout') void logout();
                },
              }}
            >
              <Button size="small">{session.user.name}</Button>
            </Dropdown>
          ) : (
            <Button size="small" type="primary" onClick={() => void login()}>
              登录
            </Button>
          )}
        </Space>
      </Layout.Header>
      <Layout.Content className="wrap">
        <Alert
          className="banner"
          type={store.localWrites ? 'warning' : 'info'}
          showIcon
          message={
            store.localWrites
              ? '演示数据：键名 / 层级 / 数量来自配置中心真实预检（2,020 个唯一键），值已脱敏。编辑保存在浏览器本地。'
              : `已接入配置中心真实接口（${API_BASE}）：读需 config:read，写需 config:write 并填写原因，回滚需 config:publish。`
          }
        />
        {status === 'loading' ? (
          <div className="page-state">
            <Spin size="large" />
            <div className="hint">正在加载配置…</div>
          </div>
        ) : status !== 'ready' ? (
          <Result
            status={status === 'error' ? 'error' : status === 'forbidden' ? '403' : 'warning'}
            title={
              status === 'forbidden' ? '无权限访问配置中心' : status === 'unauthorized' ? '需要登录（或会话已过期）' : '加载失败'
            }
            subTitle={errorMessage || (status === 'forbidden' ? '当前账号缺少 config:read 权限点。' : '')}
            extra={
              <Space>
                <Button type="primary" onClick={() => void load()}>
                  重试
                </Button>
                {status === 'unauthorized' ? <Button onClick={() => void login()}>重新登录</Button> : null}
              </Space>
            }
          />
        ) : items.length === 0 ? (
          <div className="page-state">
            <Empty description={store.localWrites ? '演示数据为空' : '该租户 / 应用下暂无配置项'} />
          </div>
        ) : !route.domain ? (
          <Overview meta={meta} go={go} />
        ) : route.edit ? (
          route.group ? (
            <GroupEditorPage
              domain={route.domain}
              group={route.group}
              items={items}
              meta={meta}
              go={go}
              onOpen={setModal}
              onDelete={(it) => requestWrite({ kind: 'delete', item: it })}
            />
          ) : (
            <GroupPicker domain={route.domain} items={items} meta={meta} go={go} />
          )
        ) : (
          <DomainPage
            domain={route.domain}
            items={items}
            meta={meta}
            go={go}
            onOpen={setModal}
            onDelete={(it) => requestWrite({ kind: 'delete', item: it })}
            onView={(key) => setViewing({ domain: route.domain!, key })}
          />
        )}
      </Layout.Content>
      {modal ? (
        <ItemModal
          state={modal}
          items={items}
          onCancel={() => setModal(null)}
          onSubmit={(it) => {
            setModal(null);
            requestWrite({ kind: 'upsert', item: it });
          }}
        />
      ) : null}
      <PlacementDrawer
        state={viewing}
        items={items}
        onClose={() => setViewing(null)}
        onEdit={(it) => setModal({ mode: 'edit', item: it, domain: it.d, group: it.g, scope: it.s })}
        onDelete={(it) => requestWrite({ kind: 'delete', item: it })}
        historyFor={store.remoteEffective ? (it) => store.history(it) : undefined}
        onRollback={(it, revision) => requestWrite({ kind: 'rollback', item: it, revision })}
      />
      {pending ? (
        <ReasonModal
          title={WRITE_TITLE[pending.kind]}
          description={<WriteDescription write={pending} />}
          confirmText={pending.kind === 'delete' ? '确认删除' : pending.kind === 'rollback' ? '确认回滚' : '保存'}
          danger={pending.kind === 'delete'}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(reason) => void performWrite(pending, reason)}
        />
      ) : null}
    </Layout>
  );
}

/* ------------------------------ 登录 / 状态 ------------------------------ */

function LoginPage({ error, onLogin }: { error: string; onLogin: () => void }) {
  const mock = DATA_MODE === 'mock';
  return (
    <Layout className="app">
      <div className="boot">
        <Card className="login-card">
          <div className="brand">
            <span className="mark">A</span>
            <span>配置中心</span>
          </div>
          <h1 className="page">登录后管理配置</h1>
          <p className="desc">管理面 API 需要 JWT：读取需 config:read，写入需 config:write，回滚需 config:publish。</p>
          {error ? <Alert className="banner" type="error" showIcon message={error} /> : null}
          <Space>
            <Button type="primary" onClick={onLogin}>
              {mock ? '使用演示账号进入' : '使用 Autional 账号登录'}
            </Button>
          </Space>
          <div className="hint" style={{ marginTop: 12 }}>
            {mock ? '当前为演示鉴权（VITE_AUTH_MODE=mock）。' : `OIDC 授权码 + PKCE · ${OIDC.authorizeUrl}`}
          </div>
        </Card>
      </div>
    </Layout>
  );
}

/** 写操作「原因」弹窗：后端要求 1–200 字并写审计。 */
function ReasonModal(props: {
  title: string;
  description: ReactNode;
  confirmText: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const invalid = trimmed.length === 0 || trimmed.length > 200;
  return (
    <Modal
      open
      title={`${props.title} · 变更原因`}
      okText={props.confirmText}
      cancelText="取消"
      okButtonProps={{ danger: props.danger, disabled: invalid, loading: props.busy }}
      onCancel={props.onCancel}
      onOk={() => {
        if (!invalid) props.onConfirm(trimmed);
      }}
      destroyOnHidden
    >
      {props.description}
      <Input.TextArea
        rows={3}
        maxLength={200}
        showCount
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例：排查网关日志 / 上线新连接池参数"
      />
    </Modal>
  );
}

function WriteDescription({ write }: { write: PendingWrite }) {
  const it = write.item;
  return (
    <div className="reason-desc">
      <div>
        <Text type="secondary">作用域</Text> {scopeLabel(it.s)}
      </div>
      <div>
        <Text type="secondary">键</Text> <code className="mono">{it.k || '（新增）'}</code>
      </div>
      {write.kind === 'upsert' ? (
        <div>
          <Text type="secondary">新值</Text> <span className="mono small">{valueText(it.v)}</span>
        </div>
      ) : null}
      {write.kind === 'rollback' ? (
        <div>
          <Text type="secondary">目标版本</Text> revision {write.revision}
        </div>
      ) : null}
      <div className="hint">原因必填（1–200 字），会写入审计。</div>
    </div>
  );
}

/* ------------------------------- 概览 ------------------------------- */

function Overview({ meta, go }: { meta: Meta; go: (r: Route) => void }) {
  return (
    <>
      <h1 className="page">配置中心概览</h1>
      <p className="desc">按「配置域 → 配置组 → 配置项」组织。域用于导航和统计，编辑在配置组。</p>
      <Row gutter={12} className="stats">
        <Col span={4}>
          <Card size="small">
            <Statistic title="配置项" value={meta.total} />
            <Text type="secondary" className="hint">
              唯一键
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="平台基座" value={meta.base} />
            <Text type="secondary" className="hint">
              所有服务共享
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="服务配置" value={meta.svc} />
            <Text type="secondary" className="hint">
              按服务隔离
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="服务" value={meta.services.length} />
            <Text type="secondary" className="hint">
              已接入中心
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="配置域" value={meta.domains.length} />
            <Text type="secondary" className="hint">
              一级分类
            </Text>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="配置组" value={meta.domains.reduce((n, d) => n + d.groups.length, 0)} />
            <Text type="secondary" className="hint">
              编辑单元
            </Text>
          </Card>
        </Col>
      </Row>

      <h2 className="section">配置域</h2>
      <Row gutter={[12, 12]}>
        {meta.domains.map((d) => {
          const pct = d.count ? Math.round((d.base / d.count) * 100) : 0;
          return (
            <Col span={6} key={d.name}>
              <Card hoverable className="domain-card" onClick={() => go({ domain: d.name })}>
                <div className="domain-top">
                  <span className="mono-badge" style={{ background: d.color }}>
                    {d.mono}
                  </span>
                  <div>
                    <div className="domain-name">{d.name}</div>
                    <div className="domain-desc">{d.desc}</div>
                  </div>
                </div>
                <div className="domain-num">
                  {d.count}
                  <small>项</small>
                </div>
                <div className="bar">
                  <span className="b" style={{ width: `${pct}%` }} />
                  <span className="s" style={{ width: `${100 - pct}%` }} />
                </div>
                <div className="domain-meta">
                  <span>基座 {d.base}</span>
                  <span>服务 {d.svc}</span>
                  <span>组 {d.groups.length}</span>
                </div>
                <Space size={4} wrap className="chips">
                  {d.groups.slice(0, 3).map((g) => (
                    <Tag key={g.name}>
                      {g.name} {g.count}
                    </Tag>
                  ))}
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <h2 className="section">结构说明</h2>
      <Row gutter={12}>
        <Col span={14}>
          <Card size="small">
            <ol className="struct">
              <li>
                <b>配置域</b>：一级分类，只用于导航和统计。
              </li>
              <li>
                <b>配置组</b>：编辑单元，一个组一张表单。
              </li>
              <li>
                <b>配置项</b>：写入单元，每个项独立 revision。
              </li>
              <li>
                <b>生效规则</b>：服务未定义 → 继承基座；服务定义 → 覆盖基座。
              </li>
            </ol>
          </Card>
        </Col>
        <Col span={10}>
          <Card size="small">
            <b>当前定制组</b>
            <div className="hint">已设计：邮件发送、短信与推送、PostgreSQL、连接池、接口限流。</div>
            <div className="hint">其余组走默认表单；组内未覆盖的项自动进入「其他项」。</div>
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* ------------------------------ 域列表 ------------------------------ */

function DomainPage(props: {
  domain: string;
  items: Item[];
  meta: Meta;
  go: (r: Route) => void;
  onOpen: (s: ModalState) => void;
  onDelete: (it: Item) => void;
  onView: (key: string) => void;
}) {
  const { message } = AntdApp.useApp();
  const { domain, items, meta, go, onOpen, onDelete, onView } = props;
  const d = meta.domains.find((x) => x.name === domain);
  const [group, setGroup] = useState<string>('');
  const [service, setService] = useState<string>('all');
  const [scope, setScope] = useState<'all' | 'base' | 'svc'>('all');
  const [q, setQ] = useState('');
  const [hideRules, setHideRules] = useState(true);

  const services = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.d === domain && it.s) s.add(it.s);
    return Array.from(s).sort();
  }, [items, domain]);

  const rows = useMemo(() => {
    return aggregate(items, domain, { group: group || undefined, service: service === 'all' ? undefined : service, scope, q, hideRules });
  }, [items, domain, group, service, scope, q, hideRules]);

  const single = service !== 'all';
  const list = useMemo(() => {
    if (!single) return rows;
    let a = items.filter((x) => x.d === domain && x.s === service);
    if (group) a = a.filter((x) => x.g === group);
    if (hideRules) a = a.filter((x) => !isRule(x));
    const s = q.trim().toLowerCase();
    if (s) a = a.filter((x) => x.k.toLowerCase().includes(s) || x.v.toLowerCase().includes(s));
    return a;
  }, [items, domain, service, group, hideRules, q, single, rows]);

  const columns: TableProps<any>['columns'] = single
    ? [
        { title: '键', dataIndex: 'k', width: '34%', render: (v: string) => <code className="mono key-cell">{v}</code> },
        { title: '配置组', dataIndex: 'g', width: 140 },
        { title: '值', dataIndex: 'v', ellipsis: true, render: (v: string) => <span className="mono small">{valueText(v)}</span> },
        { title: '类型', dataIndex: 't', width: 90, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
        {
          title: '作用域',
          width: 100,
          render: (_: unknown, r: Item) => (r.s ? <Tag color="blue">服务</Tag> : <Tag>基座</Tag>),
        },
        {
          title: '操作',
          width: 150,
          render: (_: unknown, r: Item) => (
            <Space size={4}>
              <Button size="small" type="link" onClick={() => onOpen({ mode: 'edit', item: r, domain, group: r.g, scope: r.s })}>
                编辑
              </Button>
              <Popconfirm title="删除该配置项？" onConfirm={() => onDelete(r)}>
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ),
        },
      ]
    : [
        {
          title: '键',
          dataIndex: 'k',
          width: '28%',
          render: (v: string) => (
            <a className="mono key-cell" onClick={() => onView(v)}>
              {v}
            </a>
          ),
        },
        { title: '配置组', dataIndex: 'g', width: 120 },
        {
          title: '值',
          dataIndex: 'v',
          width: '24%',
          ellipsis: true,
          render: (v: string, r: any) => (
            <Space size={6}>
              <span className="mono small">{valueText(v)}</span>
              {r.distinct > 1 ? <Tag color="blue">{r.distinct} 种取值</Tag> : null}
            </Space>
          ),
        },
        { title: '类型', dataIndex: 't', width: 80, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
        {
          title: '作用域',
          width: 90,
          render: (_: unknown, r: any) => (r.base && r.services ? <Tag color="purple">混合</Tag> : r.base ? <Tag>基座</Tag> : <Tag color="blue">服务</Tag>),
        },
        {
          title: '服务',
          width: 150,
          render: (_: unknown, r: any) => <Text type="secondary">{r.base && r.services ? `基座 + ${r.services} 服务` : r.base ? '仅基座' : `${r.services} 个服务`}</Text>,
        },
        {
          title: '操作',
          width: 90,
          render: (_: unknown, r: any) => (
            <Button size="small" type="link" onClick={() => onView(r.k)}>
              查看
            </Button>
          ),
        },
      ];

  return (
    <>
      <Breadcrumb
        items={[
          { title: <a onClick={() => go({})}>概览</a> },
          { title: domain },
        ]}
      />
      <div className="page-head">
        <div className="page-title">
          <span className="mono-badge lg" style={{ background: DOMAIN_META[domain]?.color }}>
            {DOMAIN_META[domain]?.mono}
          </span>
          <div>
            <h1>{domain}</h1>
            <div className="desc">{DOMAIN_META[domain]?.desc}</div>
          </div>
        </div>
        <Space size={8}>
          <Card size="small" className="kpi">
            <Statistic title="配置项" value={d?.count ?? 0} />
          </Card>
          <Card size="small" className="kpi">
            <Statistic title="基座" value={d?.base ?? 0} />
          </Card>
          <Card size="small" className="kpi">
            <Statistic title="服务" value={d?.svc ?? 0} />
          </Card>
          <Card size="small" className="kpi">
            <Statistic title="配置组" value={d?.groups.length ?? 0} />
          </Card>
          <Segmented
            options={[
              { label: '列表', value: 'list' },
              { label: '编辑', value: 'edit' },
            ]}
            value="list"
            onChange={(v) => v === 'edit' && go({ domain, edit: true, group: group || undefined })}
          />
        </Space>
      </div>

      <Alert
        className="banner"
        type="info"
        showIcon
        message="服务未定义该键时继承平台基座；服务定义则覆盖。同一键取值不同会标出「N 种取值」。"
      />

      <Row gutter={12}>
        <Col flex="220px">
          <Card size="small" className="side">
            <div className="side-title">配置组</div>
            <div className={`side-item ${!group ? 'on' : ''}`} onClick={() => setGroup('')}>
              <span>全部组</span>
              <span className="n">{d?.count ?? 0}</span>
            </div>
            {d?.groups.map((g) => (
              <div key={g.name} className={`side-item ${group === g.name ? 'on' : ''}`} onClick={() => setGroup(g.name)}>
                <span>{g.name}</span>
                <span className="n">{g.count}</span>
              </div>
            ))}
          </Card>
        </Col>
        <Col flex="auto">
          <Card size="small">
            <Space wrap className="filters">
              <Input.Search allowClear placeholder="搜索键名、值或服务…" style={{ width: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
              <Select
                style={{ width: 220 }}
                value={service}
                onChange={setService}
                options={[{ value: 'all', label: '全部服务（按键聚合）' }, { value: '', label: '仅平台基座' }, ...services.map((s) => ({ value: s, label: s }))]}
              />
              <Segmented
                value={scope}
                onChange={(v) => setScope(v as 'all' | 'base' | 'svc')}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'base', label: '基座' },
                  { value: 'svc', label: '服务' },
                ]}
              />
              <span className="check">
                <Switch size="small" checked={hideRules} onChange={setHideRules} /> 隐藏校验规则
              </span>
              <div className="grow" />
              <Button
                type="primary"
                onClick={() =>
                  onOpen({
                    mode: 'add',
                    item: { s: service === 'all' ? '' : service, k: '', t: 'scalar', v: '', d: domain, g: group || d?.groups[0]?.name || '' },
                    domain,
                    group: group || d?.groups[0]?.name || '',
                    scope: service === 'all' ? '' : service,
                  })
                }
              >
                新增配置项
              </Button>
            </Space>
            <Table
              size="small"
              rowKey={(r: any) => (single ? itemId(r.s, r.k) : r.k)}
              dataSource={list as any[]}
              columns={columns}
              pagination={{ pageSize: 50, showSizeChanger: false }}
              scroll={{ x: 1000 }}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* ----------------------------- 组选择页 ----------------------------- */

function GroupPicker(props: { domain: string; items: Item[]; meta: Meta; go: (r: Route) => void }) {
  const { domain, meta, go } = props;
  const d = meta.domains.find((x) => x.name === domain);
  return (
    <>
      <Breadcrumb items={[{ title: <a onClick={() => go({})}>概览</a> }, { title: domain }, { title: '编辑' }]} />
      <div className="page-head">
        <div className="page-title">
          <span className="mono-badge lg" style={{ background: DOMAIN_META[domain]?.color }}>
            {DOMAIN_META[domain]?.mono}
          </span>
          <div>
            <h1>{domain}</h1>
            <div className="desc">编辑单元 = 配置组</div>
          </div>
        </div>
        <Segmented
          options={[
            { label: '列表', value: 'list' },
            { label: '编辑', value: 'edit' },
          ]}
          value="edit"
          onChange={() => go({ domain })}
        />
      </div>
      <Alert
        className="banner"
        type="info"
        showIcon
        message="每个配置组一个编辑界面。设计过的组用定制表单；没有设计的组按配置项类型自动生成。"
      />
      <Row gutter={[12, 12]}>
        {d?.groups.map((g) => {
          const ed = editorOf(domain, g.name) || `${domain}|${g.name}` === RATE_LIMIT_GROUP;
          const sample = props.items.filter((x) => x.d === domain && x.g === g.name && !isRule(x) && x.s === '').slice(0, 2);
          const fallback = sample.length ? sample : props.items.filter((x) => x.d === domain && x.g === g.name && !isRule(x)).slice(0, 2);
          return (
            <Col span={6} key={g.name}>
              <Card hoverable className="domain-card" onClick={() => go({ domain, edit: true, group: g.name })}>
                <div className="domain-top">
                  <span className="mono-badge" style={{ background: ed ? '#2563eb' : '#94a3b8' }}>
                    {ed ? '定' : '默'}
                  </span>
                  <div>
                    <div className="domain-name">{g.name}</div>
                    <div className="domain-desc">{ed ? '定制编辑界面' : '默认表单（按类型生成）'}</div>
                  </div>
                </div>
                <div className="domain-num">
                  {g.count}
                  <small>项</small>
                </div>
                <div className="domain-meta">
                  <span>{g.base ? '基座' : '无基座'}</span>
                  <span>{g.services} 个服务</span>
                </div>
                <div className="samples">
                  {fallback.map((x) => (
                    <div key={x.k} className="mono small">
                      {x.k}
                    </div>
                  ))}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </>
  );
}

/* ----------------------------- 组编辑页 ----------------------------- */

function GroupEditorPage(props: {
  domain: string;
  group: string;
  items: Item[];
  meta: Meta;
  go: (r: Route) => void;
  onOpen: (s: ModalState) => void;
  onDelete: (it: Item) => void;
}) {
  const { domain, group, items, meta, go, onOpen, onDelete } = props;
  const services = useMemo(() => servicesInGroup(items, domain, group), [items, domain, group]);
  const hasBase = useMemo(() => items.some((x) => x.d === domain && x.g === group && x.s === ''), [items, domain, group]);
  const [scope, setScope] = useState<Scope>(hasBase ? '' : services[0] ?? '');
  // api 模式：编辑器 schema 以服务端 /editors 为准（404 回落本地注册表）；生效项用 /effective。
  const [remoteEditor, setRemoteEditor] = useState<GroupEditor | null>(null);
  const [remoteEff, setRemoteEff] = useState<EffectiveRow[] | null>(null);
  const [effLoading, setEffLoading] = useState(false);
  useEffect(() => {
    if (!store.remoteEditor || editorOf(domain, group)) {
      setRemoteEditor(null);
      return;
    }
    let alive = true;
    store
      .editor(domain, group)
      .then((next) => {
        if (alive) setRemoteEditor(next);
      })
      .catch(() => {
        if (alive) setRemoteEditor(null);
      });
    return () => {
      alive = false;
    };
  }, [domain, group]);
  useEffect(() => {
    if (!store.remoteEffective) {
      setRemoteEff(null);
      return;
    }
    let alive = true;
    setEffLoading(true);
    setRemoteEff(null);
    store
      .effective(scope, domain, group)
      .then((rows) => {
        if (alive) setRemoteEff(rows);
      })
      .catch(() => {
        if (alive) setRemoteEff(null);
      })
      .finally(() => {
        if (alive) setEffLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, domain, group]);
  const ed = editorOf(domain, group) ?? remoteEditor;
  const isRate = `${domain}|${group}` === RATE_LIMIT_GROUP;
  const custom = !!ed || isRate;
  const eff = useMemo<EffectiveRow[]>(() => remoteEff ?? groupEffective(items, domain, group, scope), [remoteEff, items, domain, group, scope]);
  const covered = useMemo(() => {
    const s = new Set<string>();
    ed?.fields.forEach((f) => f.keys.forEach((k) => s.add(k)));
    return s;
  }, [ed]);
  const rest = useMemo(() => eff.filter((x) => !covered.has(x.k) && !isRule(x) && !(isRate && x.k.startsWith('rate_limit.'))), [eff, covered, isRate]);
  const ovr = eff.filter((x) => x.src === 'override').length;
  const inh = eff.filter((x) => x.src === 'inherit' || x.src === 'base').length;

  const resolve = (keys: string[]) => {
    for (const k of keys) {
      const it = items.find((x) => x.k === k && x.s === scope);
      if (it) return { it, src: scope ? 'override' : 'base' } as const;
    }
    for (const k of keys) {
      const it = items.find((x) => x.k === k && x.s === '');
      if (it) return { it, src: 'inherit' } as const;
    }
    return null;
  };

  const fieldRows = (ed?.fields ?? []).map((f) => {
    const r = resolve(f.keys);
    return { f, r };
  });

  return (
    <>
      <Breadcrumb
        items={[
          { title: <a onClick={() => go({})}>概览</a> },
          { title: <a onClick={() => go({ domain })}>{domain}</a> },
          { title: <a onClick={() => go({ domain, edit: true })}>编辑</a> },
          { title: group },
        ]}
      />
      <div className="page-head">
        <div className="page-title">
          <span className="mono-badge lg" style={{ background: DOMAIN_META[domain]?.color }}>
            {DOMAIN_META[domain]?.mono}
          </span>
          <div>
            <h1>{group}</h1>
            <div className="desc">
              {domain} · {custom ? '定制编辑界面' : '默认表单'}
            </div>
          </div>
        </div>
        <Space size={8}>
          <Card size="small" className="kpi">
            <Statistic title="项" value={eff.length} />
          </Card>
          <Card size="small" className="kpi">
            <Statistic title="服务覆盖" value={ovr} />
          </Card>
          <Card size="small" className="kpi">
            <Statistic title="继承/默认" value={inh} />
          </Card>
          <Segmented
            options={[
              { label: '列表', value: 'list' },
              { label: '编辑', value: 'edit' },
            ]}
            value="edit"
            onChange={() => go({ domain })}
          />
        </Space>
      </div>

      <Alert
        className="banner"
        type={scope ? 'warning' : 'info'}
        showIcon
        message={
          scope
            ? `编辑作用域：服务 ${scope}。未定义的字段继承平台基座；修改会创建服务覆盖。`
            : '编辑作用域：平台基座。修改会影响所有未单独覆盖的服务。'
        }
      />

      <Card size="small" className="editor-card">
        <Space className="editor-bar">
          <span>作用域</span>
          <Select
            style={{ width: 260 }}
            value={scope}
            onChange={setScope}
            options={[{ value: '', label: '平台基座（默认）' }, ...services.map((s) => ({ value: s, label: s }))]}
          />
          <div className="grow" />
          {effLoading ? <Spin size="small" /> : null}
          <Tag color={custom ? 'blue' : 'default'}>{custom ? '定制界面' : '默认界面'}</Tag>
          <Button
            type="primary"
            onClick={() =>
              onOpen({
                mode: 'add',
                item: { s: scope, k: '', t: 'scalar', v: '', d: domain, g: group },
                domain,
                group,
                scope,
              })
            }
          >
            新增配置项
          </Button>
        </Space>

        {ed ? (
          <div className="fields">
            {fieldRows.map(({ f, r }) => (
              <FieldRow
                key={f.label}
                field={f}
                resolved={r}
                scope={scope}
                onEdit={() => {
                  if (r?.it) onOpen({ mode: 'edit', item: r.it, domain, group, scope });
                  else
                    onOpen({
                      mode: 'add',
                      item: { s: scope, k: f.keys[0], t: kindToType(f.kind), v: '', d: domain, g: group },
                      domain,
                      group,
                      scope,
                      suggestedKey: f.keys[0],
                    });
                }}
              />
            ))}
          </div>
        ) : null}

        {isRate ? (
          <RateEditor items={eff} onOpen={(it) => onOpen({ mode: 'edit', item: it, domain, group, scope })} onDelete={onDelete} />
        ) : null}

        {rest.length ? (
          <>
            <div className="sub-title">其他项（默认表单）</div>
            <Table
              size="small"
              rowKey={(r: any) => itemId(r.s, r.k)}
              dataSource={rest as any[]}
              pagination={false}
              columns={[
                { title: '键', dataIndex: 'k', render: (v: string) => <code className="mono">{v}</code> },
                { title: '值', dataIndex: 'v', ellipsis: true, render: (v: string) => <span className="mono small">{valueText(v)}</span> },
                { title: '类型', dataIndex: 't', width: 80, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
                {
                  title: '来源',
                  width: 110,
                  render: (_: unknown, r: any) => <Tag color={r.src === 'override' ? 'blue' : 'default'}>{r.src === 'override' ? '服务覆盖' : r.src === 'inherit' ? '继承基座' : '基座默认'}</Tag>,
                },
                {
                  title: '操作',
                  width: 140,
                  render: (_: unknown, r: Item) => (
                    <Space size={4}>
                      <Button size="small" type="link" onClick={() => onOpen({ mode: 'edit', item: r, domain, group, scope })}>
                        编辑
                      </Button>
                      <Popconfirm title="删除该配置项？" onConfirm={() => onDelete(r)}>
                        <Button size="small" type="link" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}

function kindToType(kind?: 'text' | 'int' | 'bool'): ItemType {
  return kind === 'int' ? 'int' : kind === 'bool' ? 'bool' : 'scalar';
}

function FieldRow(props: { field: Field; resolved: { it: Item; src: 'base' | 'override' | 'inherit' } | null; scope: Scope; onEdit: () => void }) {
  const { field, resolved, scope, onEdit } = props;
  if (field.secret || field.secretRef) {
    const k = (field.secret ?? field.keys)[0];
    return (
      <div className="field-row">
        <div className="field-label">
          {field.label}
          <Tag color="purple">密钥中心</Tag>
        </div>
        <div className="field-key mono">{k}</div>
        <div className="field-value mono">{k}</div>
        <div className="field-src" />
        <div className="field-op">
          <Tooltip title="密钥值在密码中心管理">
            <Button size="small" type="link" disabled>
              去密钥中心
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  }
  const src = resolved?.src;
  return (
    <div className="field-row">
      <div className="field-label">{field.label}</div>
      <div className="field-key mono">{resolved?.it.k ?? field.keys[0]}</div>
      <div className="field-value mono">{resolved ? valueText(resolved.it.v) : '未设置'}</div>
      <div className="field-src">
        {src === 'override' ? <Tag color="blue">服务覆盖</Tag> : src === 'inherit' ? <Tag>继承基座</Tag> : src === 'base' ? <Tag>基座默认</Tag> : <Tag color="orange">未设置</Tag>}
      </div>
      <div className="field-op">
        <Button size="small" type="link" onClick={onEdit}>
          {resolved ? '编辑' : '设置'}
        </Button>
      </div>
    </div>
  );
}

function RateEditor({ items, onOpen, onDelete }: { items: (Item & { src: string })[]; onOpen: (it: Item) => void; onDelete: (it: Item) => void }) {
  if (!items.length) return <Empty description="该作用域未定义限流" />;
  return (
    <Table
      size="small"
      rowKey={(r: any) => itemId(r.s, r.k)}
      dataSource={items as any[]}
      pagination={false}
      columns={[
        { title: '配置项', dataIndex: 'k', render: (v: string) => <code className="mono">{v}</code> },
        { title: '额度', dataIndex: 'v', width: 140, render: (v: string) => <span className="mono small">{valueText(v)}</span> },
        { title: '类型', dataIndex: 't', width: 80, render: (v: ItemType) => <Tag color={TYPE_TAG[v]}>{v}</Tag> },
        {
          title: '操作',
          width: 140,
          render: (_: unknown, r: Item) => (
            <Space size={4}>
              <Button size="small" type="link" onClick={() => onOpen(r)}>
                编辑
              </Button>
              <Popconfirm title="删除该配置项？" onConfirm={() => onDelete(r)}>
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  );
}

/* ----------------------------- 新增/编辑 ----------------------------- */

function ItemModal(props: {
  state: { mode: 'add' | 'edit'; item: Item; domain: string; group: string; scope: Scope; suggestedKey?: string };
  items: Item[];
  onCancel: () => void;
  onSubmit: (it: Item) => void;
}) {
  const { state, onCancel, onSubmit } = props;
  const [form] = Form.useForm<Item>();
  const type = Form.useWatch('t', form) ?? state.item.t;
  useEffect(() => {
    form.setFieldsValue({ ...state.item, k: state.item.k || state.suggestedKey || '' });
  }, [form, state]);

  return (
    <Modal
      open
      title={state.mode === 'add' ? '新增配置项' : '编辑配置项'}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const it: Item = {
            s: state.scope,
            k: String(v.k).trim(),
            t: v.t,
            v: String(v.v ?? ''),
            d: state.domain,
            g: state.group,
          };
          if (!it.k) return;
          onSubmit(it);
        }}
      >
        <Form.Item label="作用域">
          <Input value={scopeLabel(state.scope)} disabled />
        </Form.Item>
        <Form.Item name="k" label="键" rules={[{ required: true, message: '请输入键名' }]}>
          <Input className="mono" disabled={state.mode === 'edit'} placeholder="例：smtp.host" />
        </Form.Item>
        <Form.Item name="t" label="类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'scalar', label: 'scalar 文本' },
              { value: 'int', label: 'int 整数' },
              { value: 'bool', label: 'bool 布尔' },
              { value: 'yaml', label: 'yaml 结构化' },
            ]}
          />
        </Form.Item>
        <Form.Item name="v" label="值">
          {type === 'bool' ? <Switch /> : type === 'int' ? <InputNumber style={{ width: '100%' }} /> : <Input.TextArea rows={3} className="mono" />}
        </Form.Item>
        {state.mode === 'add' ? (
          <Alert type="info" showIcon message={`将写入：${scopeLabel(state.scope)} / ${state.group}`} />
        ) : null}
      </Form>
    </Modal>
  );
}

/* ------------------------------ 取值抽屉 ------------------------------ */

function PlacementDrawer(props: {
  state: { domain: string; key: string } | null;
  items: Item[];
  onClose: () => void;
  onEdit: (it: Item) => void;
  onDelete: (it: Item) => void;
  /** api 模式：读该位置的 append-only 版本历史（mock 模式为 undefined，不显示）。 */
  historyFor?: (it: Item) => Promise<HistoryEntry[]>;
  onRollback?: (it: Item, revision: number) => void;
}) {
  const { state, items, onClose, onEdit, onDelete, historyFor, onRollback } = props;
  const [histId, setHistId] = useState('');
  const [histRows, setHistRows] = useState<HistoryEntry[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');
  const [histItem, setHistItem] = useState<Item | null>(null);

  useEffect(() => {
    setHistId('');
    setHistRows(null);
    setHistError('');
    setHistItem(null);
  }, [state?.domain, state?.key]);

  const list = state ? items.filter((x) => x.d === state.domain && x.k === state.key).sort((a, b) => (a.s || '').localeCompare(b.s || '')) : [];
  const base = list.find((x) => x.s === '');

  const openHistory = async (it: Item) => {
    if (!historyFor) return;
    setHistId(itemId(it.s, it.k));
    setHistItem(it);
    setHistRows(null);
    setHistError('');
    setHistLoading(true);
    try {
      setHistRows(await historyFor(it));
    } catch (err) {
      setHistError(errorText(err));
    } finally {
      setHistLoading(false);
    }
  };

  return (
    <Drawer open={!!state} onClose={onClose} width={480} title={state?.key}>
      {state ? (
        <>
          <div className="drawer-meta">
            <div>
              <Text type="secondary">配置域</Text>
              <div>{state.domain}</div>
            </div>
            <div>
              <Text type="secondary">覆盖</Text>
              <div>
                {list.length} 处 · {new Set(list.map((x) => x.v)).size} 种取值
              </div>
            </div>
          </div>
          <div className="placement-list">
            {list.map((it) => {
              const same = base && it.s ? it.v === base.v : false;
              return (
                <div key={itemId(it.s, it.k)} className="placement">
                  <div className="placement-head">
                    <b>{scopeLabel(it.s)}</b>
                    <Tag color={it.s ? (same ? 'default' : 'blue') : 'default'}>{it.s ? (same ? '与基座相同' : '覆盖基座') : '默认值'}</Tag>
                    <div className="grow" />
                    <Space size={2}>
                      {historyFor ? (
                        <Button size="small" type="link" onClick={() => void openHistory(it)}>
                          历史
                        </Button>
                      ) : null}
                      <Button size="small" type="link" onClick={() => onEdit(it)}>
                        编辑
                      </Button>
                      <Popconfirm title="删除该位置的配置？" onConfirm={() => onDelete(it)}>
                        <Button size="small" type="link" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  <div className="mono small">{valueText(it.v)}</div>
                </div>
              );
            })}
          </div>

          {historyFor && histId ? (
            <>
              <div className="sub-title">变更历史 · {scopeLabel(histItem?.s ?? '')}</div>
              {histLoading ? (
                <div className="page-state">
                  <Spin size="small" />
                </div>
              ) : histError ? (
                <Alert type="error" showIcon message={histError} />
              ) : !histRows || histRows.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史版本" />
              ) : (
                <div className="placement-list">
                  {histRows.map((row, index) => (
                    <div key={`${row.id}-${row.revision}`} className="placement">
                      <div className="placement-head">
                        <b>revision {row.revision}</b>
                        <Tag>{row.created_by || '—'}</Tag>
                        <div className="grow" />
                        {onRollback && histItem && index > 0 ? (
                          <Button size="small" type="link" onClick={() => onRollback(histItem, row.revision)}>
                            回滚到此版本
                          </Button>
                        ) : (
                          <Text type="secondary" className="small">
                            {index === 0 ? '当前' : ''}
                          </Text>
                        )}
                      </div>
                      <div className="mono small">{valueText(row.value)}</div>
                      <div className="hint">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                        {row.reason ? ` · ${row.reason}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
