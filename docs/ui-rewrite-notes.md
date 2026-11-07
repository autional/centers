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

### 1. 编辑器 schema 的全量英译（T-EDITORS）—— ✅ 已完成

- 做法：不改 `editors.ts` 结构，新增 `src/lib/editor-i18n.ts`（688 条 `中文原文 → English`）。
  渲染层用 `localizeEditorText(text, i18n.language)`；**api 模式**下服务端 `GET /editors`
  返回的中文 label/hint 也会命中同一张表，不需要改 Go。
- 覆盖率：**688 / 688**，`pnpm check:editors-i18n` 可随时复核；
  `src/lib/editor-i18n.test.ts` 作为硬门禁（缺一条就红、多一条也红）。
- seed 重生成：`pnpm gen:editors [路径]`（已实测与现有 seed 逐字一致）。
- 说明：如果以后要「服务端直接下发英文」，把同一张表落到 seed 的 `label_en` 即可，前端已能按语言取。

### 2. 导入向导（ImportWizard）—— ✅ 已完成

- 概览页「导入配置」：粘贴 JSON/YAML 或选文件 → 解析 → **预检（只读）** → 应用 / 存为变更单。
- 预检表：动作（新增/更新/不变/非法/跳过）、作用域、键、值、说明；可勾选覆盖已存在键。
- 演示模式：预检可看，写入按钮禁用并给出说明（与后端 fail-closed 一致）。
- 「存为变更单」复用 `createChangeset` 与 `toChangesetEntries`，一次生成草稿。

### 3. 变更单创建 —— ✅ 已完成

- 通过导入向导的「存为变更单」创建草稿；列表/详情/发布/拒绝在同一页完成。

### 4. 密钥中心（secret）复制重建 —— ✅ 已完成

- `D:\ws\deploy-sync\secret`（分支 `feat/ui-rewrite`）已按同一结构重建：
  pnpm workspace + `apps/secret-console` + AppShell + 令牌/主题 + i18n（125 条双语）。
- 页面：概览（统计 / 按租户策略 / 运行状态）、密钥（筛选 / 分页 / 详情抽屉 / 版本历史 /
  创建 / 轮换 / 改描述 / 吊销 / 删除 / 批量 / 查看明文）、审计（筛选 + 分页）。
- 保留原有 CSP 与安全响应头；`vercel.ts` 改为 pnpm + `apps/secret-console/dist`。
- 旧 hash 深链（`#/secrets?key=`、`#/audit`）已重定向到 history 路由。
- 实测：3 个路由 + 深链抽屉，0 控制台错误；22 个单测、typecheck、build 全绿。
- 注：config 里的 `secretCenterUrl()` 仍输出 `#/secrets?key=`；secret 已能兼容该形式，
  但建议下一轮改成 `/secrets?key=` 并去掉重定向。

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

---

## 继续做 secret 的最短路径

`D:\ws\deploy-sync\secret` 已就绪（`apps/` 结构可照抄 config）：

1. 复制骨架：`pnpm-workspace.yaml`、根 `package.json`、`vercel.ts`（改站点名与 output 目录）、
   `apps/config-console/{package.json,index.html,postcss.config.mjs,tailwind.config.ts,tsconfig.json,tsconfig.node.json,vite.config.ts,vitest.config.ts}`。
2. 复制 `src/main.tsx`、`src/App.tsx`、`src/app/layout.tsx`、`src/app/config-data.tsx`、
   `src/hooks/*`、`src/components/{reason-modal,portal-menu}.tsx`、`src/i18n/*`、`src/styles/globals.css`。
3. `src/lib/**` 用 secret 自己的（api/auth/portal/scope/config 已存在，**不要覆盖**）；
   `src/lib/links.ts` 改成本站不需要（secret 就是密钥中心）。
4. 页面按 secret 的 3 页重写：概览（统计 + 策略表单 + 加密密钥版本）、密钥（筛选/分页/详情抽屉/
   创建/改描述/轮换/吊销/删除/批量）、审计（动作与租户筛选 + 分页）。
5. 保留 `vercel.ts` 的 **CSP 全套响应头**（config 没有，secret 有，别丢）。
6. 深链：config 的 `secretCenterUrl()` 现在指向 `#/secrets?key=`；secret 改为 history 路由后，
   把这里同步改成 `/secrets?key=`。

---

## M4 门禁登记 —— ✅ 已完成（2026-11-07）

| 闸门 | 结果（canonical 脚本 + 两站已登记） |
|---|---|
| `check-headers` | **16 站一致**（config / secret 顶栏由 DS AppShell 提供：64px 令牌 + sticky） |
| `check-icons` | **16 站一致（self 16 / cdn 0）**——两站按自包含形态交付：本地图标 + 本地 manifest + 令牌走 npm |
| `check-consistency` | config / secret **零新增错误**；剩余 4 条是 admin / security / trust / authenticator 的既有问题 |

登记内容（提交在 canonical `D:\ws\deploy-sync\ui`）：

- `verification/antd-entries.json`：config（other 66 / files 12 / bridge 1）、secret（other 34 / files 7 / bridge 1），
  两站 closed kinds（Table / Drawer / RangePicker）均为 0。
- `verification/consumer-targets.json`：两站 `publicDirs` + `iconDelivery: self` + `themeColors: #003153`。

站点侧对应改动（config `23f79b7` / secret `71c7ea3`）：

- 8 个图标（含 `favicon-48x48.png`）从 `ui/assets` 复制，逐字节一致（I12–I14）。
- `public/site.webmanifest`：本地图标路径 + `theme_color` 与页面 meta 同源；`index.html` 用
  `<!-- icons:start/end -->` 标记块（6 条 link，含 manifest），与 `sync-consumers` 的生成格式一致。
- 令牌走 `@import '@autional/tokens/tokens.css'`（构建期），满足 self 形态的 I23。

### ⚠️ 跑闸门的正确姿势（两个 ui 克隆）

`D:\ws\deploy-sync\ui` 是 canonical（含 self 形态支持）；`D:\ws\autional-cn\ui` 是旧克隆，
其 `check-icons.mjs` 还不认识 `iconDelivery`。在旧克隆里直接跑会误报 I20/I23/I18。
请用 canonical 脚本 + 显式站点目录：

```powershell
$env:AUTIONAL_SITES_DIR = "D:\ws\autional-cn\sites"
node D:\ws\deploy-sync\ui\scripts\check-icons.mjs
node D:\ws\deploy-sync\ui\scripts\check-headers.mjs
node D:\ws\deploy-sync\ui\scripts\check-consistency.mjs
```

（旧克隆里的 `consumer-targets.json` / `antd-entries.json` 已同步为同一份内容，未提交，
以免与用户原有的 3 个未提交文件混在一起。）


---

## 附：暗色画布实测（2026-11-07，headless Chrome）

| 站点 | html/body 背景 | 顶栏/侧栏 | 正文色 |
|---|---|---|---|
| config | `#041d31` | `#0a2940` | `#f8fbfe` |
| secret | `#041d31` | `#0a2940` | `#f8fbfe` |

结论：令牌在 `<html>` / `<body>` / AppShell 三层都正确生效，此前「body 仍为浅色」是桌面浏览器工具
在切换过程中的读数，不是样式缺陷。顺带修掉 secret 的 `ThemeProvider storageKey` 仍沿用
`config-console-theme` 的问题（改为 `secret-console-theme`）。

---

## 最终状态（2026-11-07）

### 测试与构建

| | config | secret |
|---|---|---|
| typecheck | ✅ | ✅ |
| 单测 | **134**（11 文件） | **30**（5 文件） |
| build | ✅ | ✅ |
| CI | ✅ 含 `check:editors-i18n` | ✅ 新增（pnpm + test + typecheck/build） |

新增测试：`i18n/locales.test.ts`（key 一致 / 无空值 / 英文无中文 / 占位符一致）、
`lib/legacy-hash.test.ts`（旧 hash → path，未知不猜）。

### 冒烟（headless Chrome，9 条路由）

```
config / domains/数据库 / domains/数据库/PostgreSQL / changes / changesets
secret / secrets / audit / secrets?key=…（深链直接开抽屉）
```

全部有页头、行数正确、**0 控制台错误 / 0 pageerror**。

### 设计系统闸门（canonical 脚本）

| 闸门 | 结果 |
|---|---|
| check-headers | ✅ 16 站一致 |
| check-icons | ✅ 16 站一致（self 16 / cdn 0） |
| check-consistency | 4 条错误，**全部为其它站既有问题**（admin / security / trust / authenticator），config / secret 零新增 |

### 健壮性

- 两站都用 `<ErrorBoundary>` 包住路由：渲染异常不再白屏（DS 组件，文案随 `<html lang>`）。
- secret 的 `ThemeProvider storageKey` 已从 `config-console-theme` 改为 `secret-console-theme`。
