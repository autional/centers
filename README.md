# 配置中心控制台（Config Console）

**仓库**：<https://github.com/autional/config>
**域名**：[config.autional.com](https://config.autional.com) · [config.autional.cn](https://config.autional.cn)
**Vercel 双项目**：`config`（com，`API_ORIGIN=https://api.autional.com`）· `cn-config`（cn，`API_ORIGIN=https://api.autional.cn`），配置见 `vercel.ts`。


配置中心的**可编辑后台**原型。技术栈：Vite + React 19 + Ant Design 6 + TypeScript。

## 结构

```
配置域（导航 / 统计）
 └ 配置组（编辑单元，一个组一张表单）
    └ 配置项（写入单元，独立 revision）
```

- 域只用于导航；编辑入口在**组**。
- 组有定制界面（`src/lib/editors.ts` 注册）时用定制表单；否则用默认表单。
- 组内未被定制表单覆盖的项，自动落入「其他项（默认表单）」，不丢项。
- 作用域：平台基座 / 某个服务。服务未定义 → 继承基座；定义 → 覆盖。

## 部署

`main` 推送 → Vercel 自动部署（项目 `config`）。
生产地址：<https://config.autional.com> · <https://config.autional.cn>

## 运行

```bash
npm install
npm run dev       # http://localhost:13120
npm run build     # 产物 dist/
npm run preview
```

## 测试

```bash
npm test          # vitest run（纯逻辑单测，node 环境，无需 jsdom）
npm run test:watch
```

覆盖 `src/lib/` 的纯逻辑层（不触 DOM / 网络）：

- `transfer.ts`：导出结构与排序、JSON/YAML 往返、遮罩项 skipped、`toImportEntries` 过滤、
  非法条目（键/类型/值）判 invalid、`diffEntries` 计数（create/update/unchanged/invalid/skipped）。
- `model.ts`：域/组统计与未知域回退（`DOMAIN_META` 缺省）、`effective` 生效语义（base/override，
  inherit 由 API 侧映射）、`aggregate` 按 key 去重与 N 种取值（distinct，遮罩值不计入）+ 过滤/排序。

配置在 `vitest.config.ts`（`environment: 'node'`，`include: ['src/**/*.test.ts']`）。


## 演示数据（默认）

`src/data/inventory.json`：来自配置中心真实预检（2,020 个唯一键、69 个配置组、27 个服务），
**值已脱敏**（敏感/主机/库名等替换为 `••••••`）。编辑只写入浏览器 localStorage，可「重置」恢复。

默认构建（不设任何 `VITE_*`）就是这一形态：**公开演示，无需后端、无需登录**。

## 环境变量

两个正交开关：数据从哪来（`VITE_DATA_MODE`）、会话从哪来（`VITE_AUTH_MODE`）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_DATA_MODE` | `mock` | `mock` = 本地演示数据 + localStorage；`api` = 调配置中心管理面（需后端 + JWT） |
| `VITE_AUTH_MODE` | `mock` | `mock` = 演示会话（平台管理员）；`oidc` = 授权码 + PKCE 登录 |
| `VITE_API_BASE` | `/bff/config/api/v1/admin/config` | 管理面基址。默认走同源 `/bff/...`，由 `vercel.json` 的 rewrites 代理到 `api.autional.com`（服务端代理，无 CORS） |
| `VITE_TENANT_ID` | 空 | 租户兜底（JWT 已带 `tenant_id` 时以令牌为准） |
| `VITE_APP_ID` | 空 | 应用兜底（空 = 平台应用） |
| `VITE_REQUIRE_AUTH` | 空 | `1` = 未登录先进登录页；默认放开（mock 演示可直接看） |
| `VITE_OIDC_AUTHORIZE` | `https://auth.autional.com/oauth/api/v1/oauth/authorize` | 授权端点（浏览器跳转） |
| `VITE_OIDC_TOKEN` | `https://api.autional.com/bff/oauth/api/v1/oauth/token` | 令牌端点（换票/刷新） |
| `VITE_OIDC_CLIENT_ID` | 空 | OAuth 客户端 ID（公开客户端，`is_confidential=false`） |
| `VITE_OIDC_REDIRECT_URI` | `${origin}/oauth/callback` | 回调地址；**必须与客户端登记的 `redirect_uris` 逐字一致**（无尾斜杠） |
| `VITE_OIDC_SCOPE` | `openid profile email` | 授权范围 |

### mock 模式（现状，默认）

```bash
npm run dev                 # 无需后端
VITE_DATA_MODE=mock npm run build
```

- 编辑落在浏览器 localStorage，「重置」恢复演示数据；
- 不需要登录，公开演示地址继续可用。

### api 模式（接真实配置中心）

前置条件：

1. 后端已部署 `config-service` 管理面（`shared/service-config`），网关已配 `/bff/config/api/v1/admin/config`；
2. 有一个 **应用专属** OAuth 客户端（公开客户端 + PKCE），回调地址登记为本站 `/oauth/callback`；
3. 账号在 rbac 侧被授予权限点 `config:read`（读）/ `config:write`（写）/ `config:publish`（回滚）。

```bash
# .env.local（不要提交）
VITE_DATA_MODE=api
VITE_AUTH_MODE=oidc
VITE_REQUIRE_AUTH=1
VITE_OIDC_CLIENT_ID=client-xxxxxxxx
VITE_OIDC_REDIRECT_URI=https://config.autional.com/oauth/callback
# VITE_API_BASE 默认即可（同源 /bff，由 vercel.json 代理）
```

行为差异：

- 域 / 组统计走 `GET /groups`，组编辑页的「继承 / 覆盖 / 基座」走 `GET /effective`；
- 所有写操作（新增/修改/删除/回滚）都弹「变更原因」（1–200 字），随请求写审计；
- 抽屉里可查看某键的 append-only 版本历史并回滚（回滚需 `config:publish`）；
- 组编辑器优先读 `GET /editors`（无 schema 的组回落本地注册表 `src/lib/editors.ts`）；
- 禁用本地持久化与「重置」；加载 / 空 / 错误 / 403 / 401 均有独立状态页。

令牌存放与安全：`sessionStorage`（关标签即失效），PKCE `S256` + `state` + `nonce` 校验，
不使用 `client_secret`，不把令牌写入 localStorage。

## 导入 / 导出 / 影响面（CC-12）

- **导出**：概览页与域列表页的「导出」下拉 → JSON / YAML。api 模式走 `GET /export`（服务端生成文件，
  敏感项由服务端替换为遮罩占位 `••••••`，不含任何密钥值）；mock 模式在浏览器本地生成**同结构**文件
  （`{version, exported_at, tenant_id, app_id, items[], masked_count}`）。
- **导入**：「导入」→ 选择 JSON / YAML 文件 → 服务端（mock 为本地）预检并给出差异预览
  （新增 / 修改 / 不变 / 跳过 / 无效）→ 填写原因 → 整批原子提交 `POST /import`。
  - api 模式预检走 `POST /import/preview`（只读，不写库）；存在「无效」项时整批不可提交。
  - 导出里的遮罩占位项一律「跳过」：绝不把占位值回灌成真实配置。
  - mock 模式只做解析与预览，**不提交**任何写入。
- **影响面**：配置项抽屉（点击键名打开）的「消费方」区块 → `GET /consumers?key=`，数据源 =
  `shared/infra-ops/docker/allowlist-seed.json`（服务 → 可读密钥键）。数据源不可达时显示
  `source=unavailable`（不伪造消费方）；mock 模式显示按本机条目的演示占位。

## 接口契约与任务

- 管理面 API 契约：`D:/ws/autional/butler/plan/config-console/API.md`
- 前端数据层：`src/lib/{config,auth,api,data,transfer}.ts`（`transfer.ts` = 导入/导出的纯逻辑层）

## 已定制的组

| 域 | 组 |
|---|---|
| 数据库 | PostgreSQL |
| 数据库 | 连接池 |
| 邮件与短信 | 邮件发送 |
| 邮件与短信 | 短信与推送 |
| 限流与配额 | 接口限流 |

其余组走默认表单。

## 后续

- CC-07/CC-08 已完成：数据层抽象（mock / api）+ OIDC 登录；CC-12 已完成：导出 / 导入向导 / 影响面。
  后续是变更单（草稿 / 发布 / 审批）。
- 接口契约与任务拆分见 `D:/ws/autional/butler/plan/config-console/`。

## 约定

- 组编辑器的注册键 = `域|组`（组名当前跨域唯一）。
- 字段的 `keys` 是候选键：先取当前作用域，再取基座。
- 新增/删除：列表页与组编辑页都支持；mock 模式写入浏览器本地标记（可「重置」恢复），api 模式调用后端软删（版本保留）。
