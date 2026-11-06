import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  DOMAIN_META,
  aggregate,
  applyOverrides,
  buildMeta,
  clearOverrides,
  effective,
  groupEffective,
  isRule,
  itemId,
  loadOverrides,
  saveOverrides,
  scopeLabel,
  servicesInGroup,
} from './lib/model';
import type { Item, ItemType, Scope } from './lib/model';
import { RATE_LIMIT_GROUP, editorOf } from './lib/editors';
import type { Field } from './lib/editors';
import './styles.css';

const { Text } = Typography;

type Overrides = ReturnType<typeof loadOverrides>;
type Route = { domain?: string; edit?: boolean; group?: string };
type ModalState = { mode: 'add' | 'edit'; item: Item; domain: string; group: string; scope: Scope; suggestedKey?: string };

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

export default function Root() {
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const items = useMemo(() => applyOverrides(overrides), [overrides]);
  const meta = useMemo(() => buildMeta(items), [items]);
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; item: Item; domain: string; group: string; scope: Scope; suggestedKey?: string } | null>(null);
  const [viewing, setViewing] = useState<{ domain: string; key: string } | null>(null);

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

  const persist = (next: Overrides) => {
    saveOverrides(next);
    setOverrides(next);
  };

  const upsert = (it: Item) => {
    const next: Overrides = {
      upsert: { ...overrides.upsert, [itemId(it.s, it.k)]: it },
      deleted: overrides.deleted.filter((x) => x !== itemId(it.s, it.k)),
    };
    persist(next);
  };

  const remove = (it: Item) => {
    const id = itemId(it.s, it.k);
    const upsertNext = { ...overrides.upsert };
    delete upsertNext[id];
    const deleted = Array.from(new Set([...overrides.deleted, id]));
    persist({ upsert: upsertNext, deleted });
  };

  const reset = () => {
    clearOverrides();
    setOverrides({ upsert: {}, deleted: [] });
  };

  return (
    <AntdApp>
      <Layout className="app">
        <Layout.Header className="topbar">
          <div className="brand">
            <span className="mark">A</span>
            <span>配置中心</span>
            <Text type="secondary" className="sub">
              Centers Console
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
            <Tag>演示 · 本地可编辑</Tag>
            <Popconfirm title="恢复演示数据？" description="会清空本机改动。" onConfirm={reset}>
              <Button size="small">重置</Button>
            </Popconfirm>
          </Space>
        </Layout.Header>
        <Layout.Content className="wrap">
          <Alert
            className="banner"
            type="warning"
            showIcon
            message="演示数据：键名 / 层级 / 数量来自配置中心真实预检（2,020 个唯一键），值已脱敏。编辑保存在浏览器本地。"
          />
          {!route.domain ? (
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
                onDelete={remove}
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
              onDelete={remove}
              onView={(key) => setViewing({ domain: route.domain!, key })}
            />
          )}
        </Layout.Content>
      </Layout>
      {modal ? (
        <ItemModal
          state={modal}
          items={items}
          onCancel={() => setModal(null)}
          onSubmit={(it) => {
            upsert(it);
            setModal(null);
          }}
        />
      ) : null}
      <PlacementDrawer
        state={viewing}
        items={items}
        onClose={() => setViewing(null)}
        onEdit={(it) => setModal({ mode: 'edit', item: it, domain: it.d, group: it.g, scope: it.s })}
        onDelete={remove}
      />
    </AntdApp>
  );
}

/* ------------------------------- 概览 ------------------------------- */

function Overview({ meta, go }: { meta: ReturnType<typeof buildMeta>; go: (r: Route) => void }) {
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
  meta: ReturnType<typeof buildMeta>;
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

function GroupPicker(props: { domain: string; items: Item[]; meta: ReturnType<typeof buildMeta>; go: (r: Route) => void }) {
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
  meta: ReturnType<typeof buildMeta>;
  go: (r: Route) => void;
  onOpen: (s: ModalState) => void;
  onDelete: (it: Item) => void;
}) {
  const { domain, group, items, meta, go, onOpen, onDelete } = props;
  const { message } = AntdApp.useApp();
  const services = useMemo(() => servicesInGroup(items, domain, group), [items, domain, group]);
  const hasBase = useMemo(() => items.some((x) => x.d === domain && x.g === group && x.s === ''), [items, domain, group]);
  const [scope, setScope] = useState<Scope>(hasBase ? '' : services[0] ?? '');
  const ed = editorOf(domain, group);
  const isRate = `${domain}|${group}` === RATE_LIMIT_GROUP;
  const custom = !!ed || isRate;
  const eff = useMemo(() => groupEffective(items, domain, group, scope), [items, domain, group, scope]);
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
}) {
  const { state, items, onClose, onEdit, onDelete } = props;
  const list = state ? items.filter((x) => x.d === state.domain && x.k === state.key).sort((a, b) => (a.s || '').localeCompare(b.s || '')) : [];
  const base = list.find((x) => x.s === '');
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
        </>
      ) : null}
    </Drawer>
  );
}
