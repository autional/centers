# 配置中心控制台（Config Console）

**仓库**：<https://github.com/autional/config>
**预览**：<https://config.autional.com>


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
生产地址：<https://config.autional.com>

## 运行

```bash
npm install
npm run dev       # http://localhost:13120
npm run build     # 产物 dist/
npm run preview
```

## 演示数据

`src/data/inventory.json`：来自配置中心真实预检（2,020 个唯一键、69 个配置组、27 个服务），
**值已脱敏**（敏感/主机/库名等替换为 `••••••`）。编辑只写入浏览器 localStorage，可「重置」恢复。

## 已定制的组

| 域 | 组 |
|---|---|
| 数据库 | PostgreSQL |
| 数据库 | 连接池 |
| 邮件与短信 | 邮件发送 |
| 邮件与短信 | 短信与推送 |
| 限流与配额 | 接口限流 |

其余组走默认表单。

## 后续接入真实 API

当前是前端原型，数据层是本地 mock。正式版需要：

1. `config-service` 管理面 API（JWT + RBAC + tenant/app/service 作用域）。
2. 网关路由（当前 config-service 未暴露）。
3. 组编辑器 schema 持久化（按组存，随配置走）。
4. 草稿 / 发布 / 回滚 / 审计原因。

接口契约与任务拆分见 `D:/ws/autional/butler/plan/config-console/`。

## 约定

- 组编辑器的注册键 = `域|组`（组名当前跨域唯一）。
- 字段的 `keys` 是候选键：先取当前作用域，再取基座。
- 新增/删除：列表页与组编辑页都支持；删除写入删除标记，可在「重置」恢复。
