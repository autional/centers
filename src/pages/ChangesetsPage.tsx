/**
 * 变更单页（列表 + 详情 + 发布/拒绝）：消费后端 `GET/POST /admin/config/changesets`（CC-04）。
 *
 * 契约与需求见 `lite/cfg-changeset-fe/requirements-dev.md` R2：
 *   - 列表：创建时间 | 标题 | 状态（Tag）| 条目数 | 创建人 | 发布时间；
 *     状态筛选 Segmented（全部 / 草稿 / 已发布 / 已拒绝），服务端分页（默认 20，可 20/50）；
 *   - 四态：loading / 空 / 错误 / 403（复用 ChangesPage 的 Result 风格）；
 *   - 详情：点行开 Drawer（头部信息 + 条目表格，值按后端遮罩**原样**展示）；
 *   - 发布 / 拒绝：仅 draft 显示按钮，弹窗必填原因（1–200），成功后关闭并刷新列表；
 *     403 明确提示所需权限点，失败保留弹窗内容（原因不回填丢失）。
 *   - **不做**编辑草稿 / 删除变更单（后端无对应接口，见 R6 非目标）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Result,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';

import { getChangeset, listChangesets, publishChangeset, rejectChangeset } from '../lib/api';
import type { Changeset, ChangesetDetail } from '../lib/api';
import {
  CHANGESETS_PAGE_SIZE,
  CHANGESETS_PAGE_SIZE_OPTIONS,
  STATUS_FILTER_OPTIONS,
  buildChangesetQuery,
  canPublish,
  canReject,
  formatChangesetTime,
  isValidText,
  statusColor,
  statusLabel,
} from '../lib/changesets';
import type { ChangesetStatus } from '../lib/api';
import { errorStatus, errorText, store } from '../lib/data';
import { scopeLabel } from '../lib/model';

const { Text } = Typography;

type FailureState = 'idle' | 'error' | 'forbidden' | 'unauthorized';

const EMPTY_TEXT = '暂无变更单。可在导入预览里选『存为变更单』。';

function dash(value?: string | null): string {
  const text = (value ?? '').trim();
  return text || '—';
}

export default function ChangesetsPage() {
  const mock = store.mode === 'mock';

  const [status, setStatus] = useState<'' | ChangesetStatus>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CHANGESETS_PAGE_SIZE);
  const [reload, setReload] = useState(0);

  const [rows, setRows] = useState<Changeset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FailureState>('idle');
  const [failureText, setFailureText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  /* 拉取：服务端筛选 + 服务端分页。过期请求用 alive 丢弃（快速切筛选时旧响应不覆盖新结果）。 */
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
        const query = buildChangesetQuery({ status, page, pageSize });
        const result = await listChangesets(query);
        if (!alive) return;
        const items = Array.isArray(result?.items) ? result.items : [];
        setRows(items);
        setTotal(typeof result?.total === 'number' && Number.isFinite(result.total) ? result.total : items.length);
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
  }, [status, page, pageSize, reload, mock]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const columns: TableProps<Changeset>['columns'] = [
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (_: unknown, row) => (
        <Tooltip title={dash(row.created_at)}>
          <span className="mono small">{formatChangesetTime(row.created_at)}</span>
        </Tooltip>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (_: unknown, row) => <span>{dash(row.title)}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_: unknown, row) => <Tag color={statusColor(row.status)}>{statusLabel(row.status)}</Tag>,
    },
    {
      title: '条目数',
      dataIndex: 'entry_count',
      width: 90,
      render: (value: number) => <span>{Number.isFinite(Number(value)) ? Number(value) : 0}</span>,
    },
    { title: '创建人', dataIndex: 'created_by', width: 150, ellipsis: true, render: (value: string) => dash(value) },
    {
      title: '发布时间',
      dataIndex: 'published_at',
      width: 170,
      render: (_: unknown, row) =>
        row.published_at ? (
          <Tooltip title={dash(row.published_by) === '—' ? '' : row.published_by}>
            <span className="mono small">{formatChangesetTime(row.published_at)}</span>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  const head = (
    <div className="page-head">
      <div>
        <h1 className="page">变更单</h1>
        <p className="desc">把一批配置改动存成草稿，确认后一次性发布（发布才生效，逐条留版本与审计）。</p>
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
          <Empty description="演示模式不提供变更单（切换 VITE_DATA_MODE=api 后可创建 / 发布）" />
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
          title="无权限查看变更单"
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
            <Button type="primary" onClick={refresh}>
              重试
            </Button>
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
          <Segmented
            value={status}
            options={STATUS_FILTER_OPTIONS}
            onChange={(value) => {
              setStatus(value as '' | ChangesetStatus);
              setPage(1);
            }}
          />
        </Space>

        {loading && rows.length === 0 ? (
          <div className="page-state">
            <Spin size="large" />
            <div className="hint">正在加载变更单…</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="page-state">
            <Empty description={EMPTY_TEXT} />
            {status ? (
              <Space size={8}>
                <Text type="secondary" className="hint">
                  当前筛选「{statusLabel(status)}」下没有变更单。
                </Text>
                <Button size="small" onClick={() => { setStatus(''); setPage(1); }}>
                  看全部
                </Button>
              </Space>
            ) : null}
          </div>
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            columns={columns}
            loading={loading}
            scroll={{ x: 1000 }}
            onRow={(row) => ({
              onClick: () => setOpenId(row.id),
              style: { cursor: 'pointer' },
            })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: CHANGESETS_PAGE_SIZE_OPTIONS.map(String),
              showTotal: (n) => `共 ${n} 条`,
              onChange: (nextPage, nextSize) => {
                setPage(nextSize === pageSize ? nextPage : 1);
                setPageSize(nextSize);
              },
            }}
          />
        )}
      </Card>

      {openId ? (
        <ChangesetDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}

/* ------------------------------- 详情抽屉 ------------------------------- */

type ActionKind = 'publish' | 'reject';

function ChangesetDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { message } = AntdApp.useApp();

  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FailureState>('idle');
  const [failureText, setFailureText] = useState('');
  const [reload, setReload] = useState(0);

  const [action, setAction] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const next = await getChangeset(id);
        if (!alive) return;
        setDetail(next);
        setFailure('idle');
        setFailureText('');
      } catch (err) {
        if (!alive) return;
        const code = errorStatus(err);
        setDetail(null);
        setFailure(code === 403 ? 'forbidden' : code === 401 ? 'unauthorized' : 'error');
        setFailureText(errorText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const changeset = detail?.changeset ?? null;
  const entries = detail?.entries ?? [];
  const editable = changeset ? canPublish(changeset.status) || canReject(changeset.status) : false;

  const openAction = (kind: ActionKind) => {
    setActionError('');
    setAction(kind);
  };

  /** 发布 / 拒绝：成功才关弹窗（失败保留已填原因 + 错误提示，用户可改后重试）。 */
  const run = async (reason: string) => {
    if (!changeset || !action) return;
    setBusy(true);
    setActionError('');
    try {
      if (action === 'publish') await publishChangeset(changeset.id, { reason });
      else await rejectChangeset(changeset.id, { reason });
      message.success(action === 'publish' ? '已发布：条目已逐条生效' : '已拒绝该变更单');
      setAction(null);
      setReload((n) => n + 1);
      onChanged();
    } catch (err) {
      const code = errorStatus(err);
      const hint =
        code === 403 ? (action === 'publish' ? '需要 config:publish 权限。' : '需要 config:write 权限。') : '';
      setActionError(`${hint}${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const entryColumns: TableProps<ChangesetDetail['entries'][number]>['columns'] = [
    {
      title: '服务',
      dataIndex: 'service_name',
      width: 180,
      ellipsis: true,
      render: (value: string) => (value ? <span>{scopeLabel(value)}</span> : <Tag>平台基座</Tag>),
    },
    { title: '键', dataIndex: 'key', render: (value: string) => <code className="mono">{value}</code> },
    {
      title: '值',
      dataIndex: 'value',
      ellipsis: true,
      // 后端已按读面规则遮罩（`••••••`），这里**原样展示**，不再二次转换。
      render: (value: string) => <span className="mono small">{value === '' ? '（空）' : value}</span>,
    },
    {
      title: '类型',
      dataIndex: 'value_type',
      width: 100,
      render: (value: string) => <Tag>{value || 'scalar'}</Tag>,
    },
  ];

  const body = (() => {
    if (loading && !detail) {
      return (
        <div className="page-state">
          <Spin size="large" />
          <div className="hint">正在加载变更单详情…</div>
        </div>
      );
    }
    if (failure === 'forbidden' || failure === 'unauthorized' || failure === 'error') {
      return (
        <Result
          status={failure === 'forbidden' ? '403' : failure === 'unauthorized' ? 'warning' : 'error'}
          title={
            failure === 'forbidden'
              ? '无权限查看该变更单'
              : failure === 'unauthorized'
                ? '需要登录（或会话已过期）'
                : '加载失败'
          }
          subTitle={failureText}
          extra={
            <Button type="primary" onClick={() => setReload((n) => n + 1)}>
              重试
            </Button>
          }
        />
      );
    }
    if (!changeset) {
      return (
        <div className="page-state">
          <Empty description="变更单不存在或已被清理" />
        </div>
      );
    }
    const rejected = changeset.status === 'rejected';
    return (
      <>
        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: 'status',
              label: '状态',
              children: <Tag color={statusColor(changeset.status)}>{statusLabel(changeset.status)}</Tag>,
            },
            { key: 'entries', label: '条目数', children: `${changeset.entry_count ?? entries.length}` },
            { key: 'reason', label: '原因', children: dash(changeset.reason) },
            {
              key: 'created',
              label: '创建',
              children: `${dash(changeset.created_by)} · ${formatChangesetTime(changeset.created_at)}`,
            },
            ...(changeset.published_at
              ? [
                  {
                    key: 'published',
                    label: '发布',
                    children: `${dash(changeset.published_by)} · ${formatChangesetTime(changeset.published_at)}`,
                  },
                ]
              : []),
            ...(rejected || changeset.rejected_at
              ? [
                  {
                    key: 'rejected',
                    label: '拒绝',
                    children: `${dash(changeset.rejected_by)} · ${formatChangesetTime(changeset.rejected_at)}`,
                  },
                  { key: 'reject_reason', label: '拒绝原因', children: dash(changeset.reject_reason) },
                ]
              : []),
          ]}
        />
        <h2 className="section">条目（{entries.length}）</h2>
        <Table
          size="small"
          rowKey={(row) => `${row.service_name}|${row.key}`}
          dataSource={entries}
          columns={entryColumns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 720, y: 320 }}
        />
      </>
    );
  })();

  return (
    <>
      <Drawer
        open
        width={820}
        onClose={onClose}
        destroyOnHidden
        title={
          <Space size={8} wrap>
            <span>变更单</span>
            {changeset ? <Tag color={statusColor(changeset.status)}>{statusLabel(changeset.status)}</Tag> : null}
            {changeset ? <Text type="secondary">{changeset.title || '（无标题）'}</Text> : null}
          </Space>
        }
        footer={
          changeset && editable ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {canReject(changeset.status) ? (
                <Button danger onClick={() => openAction('reject')}>
                  拒绝
                </Button>
              ) : null}
              {canPublish(changeset.status) ? (
                <Button type="primary" onClick={() => openAction('publish')}>
                  发布
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {body}
      </Drawer>

      {action ? (
        <ActionReasonModal
          title={action === 'publish' ? '发布变更单' : '拒绝变更单'}
          okText={action === 'publish' ? '确认发布' : '确认拒绝'}
          danger={action === 'reject'}
          busy={busy}
          error={actionError}
          hint={
            action === 'publish'
              ? '发布后逐条写入（每条生成新 revision），并把变更单标记为已发布。'
              : '拒绝后该变更单不再可用，条目不会生效。'
          }
          onCancel={() => setAction(null)}
          onConfirm={(reason) => void run(reason)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------ 原因弹窗 ------------------------------ */

function ActionReasonModal(props: {
  title: string;
  okText: string;
  danger?: boolean;
  busy: boolean;
  error: string;
  hint?: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const ok = isValidText(reason);
  return (
    <Modal
      open
      title={props.title}
      okText={props.okText}
      cancelText="取消"
      okButtonProps={{ disabled: !ok, loading: props.busy, danger: props.danger }}
      onCancel={props.onCancel}
      onOk={() => {
        if (ok) props.onConfirm(reason.trim());
      }}
      destroyOnHidden
    >
      {props.error ? <Alert className="banner" type="error" showIcon message={props.error} /> : null}
      {props.hint ? <p className="hint">{props.hint}</p> : null}
      <Input.TextArea
        rows={3}
        maxLength={200}
        showCount
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="原因必填（1–200 字，写入审计）"
      />
    </Modal>
  );
}
