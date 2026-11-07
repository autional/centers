# 配置中心 UI 重建 · 进度与待办

> 分支 `feat/ui-rewrite`。M0（骨架）、M1（登录 / 外壳）、M2（页面）已完成并通过
> typecheck / 122 个单测 / 生产构建；M3 的 hash 深链兼容已完成。以下记录**未做**的部分与原因。

## 已完成

- 结构：pnpm workspace + `apps/config-console`（与 admin/platform 同构）。
- 外壳：`@autional/ui` 的 `AppShell`（侧栏 + 64px sticky 顶栏 + 面包屑位）。
- 令牌：`@autional/tokens` 打包进 bundle（不走 CDN，规避 CSP），`tailwind-preset` 接入。
- 主题：`ThemeProvider` + `AntdThemeProvider`，暗色/亮色实测通过。
- i18n：`i18next` + 扁平点号 key；`.com` 默认 en、其余默认 zh；`<html lang>` 与 `document.title` 同步。
- 路由：`BrowserRouter`；旧 hash 深链一次性重定向（`#/d/<域>/edit/<组>` → `/domains/<域>/<组>`）。
- 页面：概览、配置域索引、域详情（聚合/按服务、筛选、搜索）、组编辑（定制表单 + 其他项）、
  变更记录、变更单（列表 + 详情 + 发布/拒绝）。
- 组件：`ItemModal`、`PlacementDrawer`（取值/影响面/历史/回滚）、`ReasonModal`、`PortalMenu`。
- 逻辑层 `src/lib/**` 与演示数据原样迁移，未改一行业务逻辑。

## 明确未做（按优先级）

### 1. 编辑器 schema 的全量英译（T-EDITORS）

- 现状：`src/lib/editors.ts` 的 584 label / 234 hint / 51 note 仍是中文；UI 外壳已双语。
- 影响：`.com`（英文）下进入配置组，字段名仍是中文。
- 方案（已论证，不需要改 Go）：
  1. `editors.ts` 的 `label/hint/note` 改为 `{ zh, en }`（或并列 `labelEn`）；
  2. **已落地**：`pnpm gen:editors [输出路径]`（`scripts/gen-editors-seed.ts`）从 `editors.ts`
     生成 `shared/service-config/internal/editorsseed/seed.json`。已实测：生成结果与现有 seed.json
     **逐字一致**（51 组）。服务端 `Schema` 是 `json.RawMessage`，不需要 DDL / Go 代码改动；
  3. 渲染层按当前语言取值；`store.editor()` 返回的服务端 schema 同样按语言读取。
- 关键词条 688 条（去重后），建议先做术语表（对齐 admin 的 `zh-CN.json` / `en-US.json`）。

### 2. 导入向导（ImportWizard）

- 现状：只保留**导出**（JSON/YAML）。导入的预检/差异/变更单保存未迁。
- 依赖：`store.previewImport` 与 `transfer.ts` 都还在，接一个 `Upload` + 预览表即可。
- 决定：与「变更单创建」一起做（两者共用预览结果）。

### 3. 变更单创建 / 从导入保存草稿

- 现状：变更单页支持列表、详情、发布、拒绝；不支持新建。
- 原因：新建需要导入预览结果，和上一条绑定。

### 4. 密钥中心（secret）复制重建

- 现状：`D:\ws\deploy-sync\secret` 已建（唯一可写副本 + `.refs/site-secret` + `autional-cn/sites/secret` 入口）。
- 未做：按本次结构复制。建议等 config 在 Preview/生产验证一版后再动。
- 备注：你提到「以后考虑直接在 admin 上实现」——admin 已有 `app/secrets/page.tsx` 落点，
  动工前先定终态（独立站 / admin 内嵌 / 两者共存）。

### 5. 设计系统门禁登记（M4）

- 未做：`ui` 仓的 `verification/consumer-targets.json#publicDirs` 与 `PORTALS` 仍未包含 config/secret。
- 原因：`ui` 仓有一份未提交改动（`contracts/errors.semantics*`），跨仓同批改动风险高。
- 建议：单独一批做，步骤：
  1. `ui/verification/consumer-targets.json` → `publicDirs` 增加
     `"config": "apps/config-console/public"`、`"secret": ""`（视 secret 最终结构）；
  2. `ui/scripts/lib/portals.mjs` → `PORTALS` 增加 config（与 secret，视终态）；
  3. `node scripts/check-headers.mjs` / `check-consistency.mjs --write-registry` 生成基线；
  4. 逐条修红（预计：C5 antd 入口登记、C6 分块策略、C10 页头）。

## 已知差异 / 取舍

- **内容面板双层**：`AppShell` 自带白色圆角面板，页面里又用 `SectionCard` 包了一层。
  视觉上多一圈边距；后续可把 SectionCard 换成无边框分组，或把 `padding="none"` 当默认。
- **body 画布背景**：浏览器工具里读到 body 背景仍是浅色，而同一 var 在同页子元素上解析为深色；
  判断是测量环境（样式表重启用 + 过渡）所致。**需在 Preview 部署用真实浏览器复核一次**。
- **密钥中心深链**：`secretCenterUrl()` 仍输出 `#/secrets?key=`（secret 尚未重写为 history 路由）。
  secret 重写时同步改成 `/secrets?key=`。
- **门户切换**：沿用 `lib/portal.ts`（不引 `@autional/shared` 的 auth store），行为与原实现一致。
- **admin 入口**：本轮不加（按决定延后）。
