/**
 * 变更记录页（只读）：消费后端 `GET /admin/config/changes`（跨服务、跨键的版本流水）。
 *
 * 契约与需求见 `lite/cfg-changes-fe/requirements-dev.md`：
 *   - 服务 / 域 / 操作人 / 时间（+ 键名前缀）筛选，服务端分页（默认 50）；
 *   - 表格列：时间（本地时区）| 操作人 | 服务 | 键（可点）| 版本 | 原因 | 变更单；
 *   - 点键 → 用已加载的 `items` 反查 `(domain, group)` 跳配置组；查不到只提示、不报错；
 *   - 四态：loading / 空 / 错误 / 403（复用现有 `Result` 风格）；
 *   - **不做回滚**：回滚入口在配置项抽屉，本页不放任何写操作，避免与发布流程冲突。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import type { Dayjs } from 'dayjs';

import { changes as fetchChanges } from '../lib/api';
import {
  CHANGES_PAGE_SIZE,
  CHANGES_PAGE_SIZE_OPTIONS,
  buildChangesQuery,
  hasActiveFilters,
  locateItem,
  normalizeChanges,
  toChangeRow,
} from '../lib/changes';
import type { ChangeRow, ChangesFilters } from '../lib/changes';
import { errorStatus, errorText, store } from '../lib/data';
import type { Meta } from '../lib/data';
import { scopeLabel } from '../lib/model';
import type { Item } from '../lib/model';

const { Text } = Typography;

/** 路由跳转（与 App.tsx 的 `Route` 结构兼容：多出的可选字段不影响赋值）。 */
export type ChangesNav = (route: { domain?: string; edit?: boolean; group?: string }) => void;

type Draft = {
  service_name: string;
  domain: string;
  created_by: string;
  key_prefix: string;
  from: Dayjs | null;
  to: Dayjs | null;
};

const EMPTY_DRAFT: Draft = { service_name: '', domain: '', created_by: '', key_prefix: '', from: null, to: null };

/** 草稿（Dayjs）→ 查询条件（Date）：DatePicker 只到「日」，由 lib/changes 对齐自然日边界。 */
function toFilters(draft: Draft): ChangesFilters {
  return {
    service_name: draft.service_name,
    domain: draft.domain,
    created_by: draft.created_by,
    key_prefix: draft.key_prefix,
    from: draft.from ? draft.from.toDate() : null,
    to: draft.to ? draft.to.toDate() : null,
  };
}

type FailureState = 'idle' | 'error' | 'forbidden' | 'unauthorized';

export default function ChangesPage({ items, meta, go }: { items: Item[]; meta: Meta; go: ChangesNav }) {
  const { message } = AntdApp.useApp();
  const mock = store.mode === 'mock';

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<ChangesFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CHANGES_PAGE_SIZE);
  const [reload, setReload] = useState(0);

  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FailureState>('idle');
  const [failureText, setFailureText] = useState('');

  /* 拉取：服务端分页 + 服务端筛选。过期请求用 alive 丢弃（避免快速翻页时旧响应覆盖新结果）。 */
  useEffect(() => {
    if (mock) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      setFailure('idle');
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const query = buildChangesQuery(applied, page, pageSize);
        const result = normalizeChanges(await fetchChanges(query), page, pageSize);
        if (!alive) return;
        setRows(result.items.map((row, index) => toChangeRow(row, index)));
        setTotal(result.total);
        setFailure('idle');
        setFailureText('');
      } catch (err) {
        if (!alive) return;
        const code = errorStatus(err);
        setRows([]);
        setTotal(0);
        setFailure(code === 403 ? 'forbidden' : code === 401 ? 'unauthorized' : 'error');
        setFailureText(errorText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [applied, page, pageSize, reload, mock]);

  const activeFilters = useMemo(() => hasActiveFilters(applied), [applied]);

  const search = () => {
    if (draft.from && draft.to && draft.from.isAfter(draft.to, 'day')) {
      message.warning('开始日期不能晚于结束日期');
      return;
    }
    setApplied(toFilters(draft));
    setPage(1);
  };

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setApplied({});
    setPage(1);
  };

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  /** 点键 → 反查配置组并跳转；查不到只提示（留在列表，不报错）。 */
  const openKey = (row: ChangeRow) => {
    const target = locateItem(items, row.serviceName, row.key);
    if (!target) {
      message.warning(`未找到「${row.key}」所属配置组（可能已删除或在别的作用域）`);
      return;
    }
    go({ domain: target.domain, edit: true, group: target.group });
  };

  const columns: TableProps<ChangeRow>['columns'] = [
    {
      title: '时间',
      dataIndex: 'time',
      width: 170,
      render: (_: unknown, row) => (
        <Tooltip title={row.timeRaw}>
          <span className="mono small">{row.time}</span>
        </Tooltip>
      ),
    },
    { title: '操作人', dataIndex: 'createdBy', width: 140, ellipsis: true },
    {
      title: '服务',
      dataIndex: 'serviceName',
      width: 170,
      ellipsis: true,
      render: (_: unknown, row) =>
        row.serviceName ? <span>{scopeLabel(row.serviceName)}</span> : <Tag>平台基座</Tag>,
    },
    {
      title: '键',
      dataIndex: 'key',
      render: (_: unknown, row) => (
        <a className="mono key-cell" onClick={() => openKey(row)}>
          {row.key || '—'}
        </a>
      ),
    },
    {
      title: '版本',
      dataIndex: 'revision',
      width: 90,
      render: (value: number) => <Tag color="blue">r{value}</Tag>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      render: (value: string) =>
        value === '—' ? <Text type="secondary">—</Text> : <Tooltip title={value}>{value}</Tooltip>,
    },
    {
      title: '变更单',
      dataIndex: 'changeset',
      width: 190,
      ellipsis: true,
      render: (value: string) =>
        value === '—' ? (
          <Text type="secondary">—</Text>
        ) : (
          <Tooltip title={value}>
            <span className="mono small">{value}</span>
          </Tooltip>
        ),
    },
  ];

  const head = (
    <div className="page-head">
      <div>
        <h1 className="page">变更记录</h1>
        <p className="desc">跨服务、跨键的配置变更流水（时间倒序）。只读页：回滚请到配置项的「历史」抽屉。</p>
      </div>
      <Space size={8}>
        <Button onClick={refresh} loading={loading}>
          刷新
        </Button>
      </Space>
    </div>
  );

  if (mock) {
    return (
      <>
        {head}
        <div className="page-state">
          <Empty description="演示模式不提供变更记录（切换 VITE_DATA_MODE=api 后可查看真实审计流水）" />
        </div>
      </>
    );
  }

  if (failure === 'forbidden') {
    return (
      <>
        {head}
        <Result
          status="403"
          title="无权限查看变更记录"
          subTitle={failureText || '当前账号缺少 config:read 权限点。'}
          extra={
            <Button type="primary" onClick={refresh}>
              重试
            </Button>
          }
        />
      </>
    );
  }

  if (failure === 'unauthorized') {
    return (
      <>
        {head}
        <Result
          status="warning"
          title="需要登录（或会话已过期）"
          subTitle={failureText}
          extra={
            <Button type="primary" onClick={refresh}>
              重试
            </Button>
          }
        />
      </>
    );
  }

  if (failure === 'error') {
    return (
      <>
        {head}
        <Result
          status="error"
          title="加载失败"
          subTitle={failureText}
          extra={
            <Space>
              <Button type="primary" onClick={refresh}>
                重试
              </Button>
              {/* 错误可能由筛选条件引起（如后端拒绝非法时间）：给一条回到默认条件的退路 */}
              <Button onClick={reset}>重置筛选</Button>
            </Space>
          }
        />
      </>
    );
  }

  return (
    <>
      {head}
      <Card size="small">
        <Space wrap className="filters">
          <Select
            style={{ width: 200 }}
            showSearch
            optionFilterProp="label"
            value={draft.service_name}
            onChange={(value: string) => setDraft((d) => ({ ...d, service_name: value ?? '' }))}
            options={[{ value: '', label: '全部服务' }, ...meta.services.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            style={{ width: 180 }}
            showSearch
            optionFilterProp="label"
            value={draft.domain}
            onChange={(value: string) => setDraft((d) => ({ ...d, domain: value ?? '' }))}
            options={[{ value: '', label: '全部配置域' }, ...meta.domains.map((d) => ({ value: d.name, label: d.name }))]}
          />
          <Input
            style={{ width: 170 }}
            allowClear
            placeholder="操作人（created_by）"
            value={draft.created_by}
            onChange={(e) => setDraft((d) => ({ ...d, created_by: e.target.value }))}
            onPressEnter={search}
          />
          <Input
            style={{ width: 190 }}
            allowClear
            placeholder="键名前缀（可选）"
            value={draft.key_prefix}
            onChange={(e) => setDraft((d) => ({ ...d, key_prefix: e.target.value }))}
            onPressEnter={search}
          />
          <DatePicker
            style={{ width: 150 }}
            placeholder="开始日期"
            allowClear
            value={draft.from}
            onChange={(value) => setDraft((d) => ({ ...d, from: value ?? null }))}
          />
          <DatePicker
            style={{ width: 150 }}
            placeholder="结束日期"
            allowClear
            value={draft.to}
            onChange={(value) => setDraft((d) => ({ ...d, to: value ?? null }))}
          />
          <Button type="primary" onClick={search}>
            查询
          </Button>
          <Button onClick={reset} disabled={!activeFilters && !hasActiveFilters(toFilters(draft))}>
            重置
          </Button>
        </Space>

        {loading && rows.length === 0 ? (
          <div className="page-state">
            <Spin size="large" />
            <div className="hint">正在加载变更记录…</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="page-state">
            <Empty description={activeFilters ? '没有符合筛选条件的变更记录' : '暂无变更记录'} />
            {activeFilters ? (
              <Button size="small" onClick={reset}>
                重置筛选
              </Button>
            ) : null}
          </div>
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            columns={columns}
            loading={loading}
            scroll={{ x: 1080 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: CHANGES_PAGE_SIZE_OPTIONS.map(String),
              showTotal: (n) => `共 ${n} 条`,
              onChange: (nextPage, nextSize) => {
                setPage(nextSize === pageSize ? nextPage : 1);
                setPageSize(nextSize);
              },
            }}
          />
        )}
      </Card>
    </>
  );
}
