/**
 * 从 `src/lib/editors.ts`（单一真源）生成服务端 seed.json。
 *
 *   pnpm gen:editors [输出路径]
 *
 * 默认输出到工作区布局下的 service-config 仓：
 *   <workspace>/autional/shared/service-config/internal/editorsseed/seed.json
 *
 * 服务端 `Editor.Schema` 是 json.RawMessage（不透明 JSON），所以：
 *   · 加字段（如 en 文案）**不需要 DDL，也不需要改 Go 代码**；
 *   · 启动期 Seed 幂等写入，内容变化才递增 version。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EDITORS } from '../src/lib/editors.ts';

const out =
  process.argv[2] ??
  resolve(process.cwd(), '../../autional/shared/service-config/internal/editorsseed/seed.json');

writeFileSync(out, `${JSON.stringify(EDITORS, null, 2)}\n`, 'utf8');
console.log(`[gen:editors] ${Object.keys(EDITORS).length} groups → ${out}`);
