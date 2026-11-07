/**
 * 编辑器文案英译覆盖率检查。
 *
 *   pnpm check:editors-i18n
 *
 * 退出码 1 = 有未翻译的文案（打印清单）。当前**不**接入 CI（翻译进行中），
 * 翻完之后把这一步加进 ci.yml 即可变成硬门禁。
 */
import { EDITORS } from '../src/lib/editors.ts';
import { EDITOR_EN } from '../src/lib/editor-i18n.ts';

const strings = new Set<string>();
for (const editor of Object.values(EDITORS)) {
  if (editor.note) strings.add(editor.note);
  for (const field of editor.fields ?? []) {
    if (field.label) strings.add(field.label);
    if (field.hint) strings.add(field.hint);
  }
}

const missing = [...strings].filter((text) => !EDITOR_EN[text]);
const extra = Object.keys(EDITOR_EN).filter((text) => !strings.has(text));

console.log(`[editors-i18n] 词条 ${strings.size} · 已译 ${strings.size - missing.length} · 未译 ${missing.length}`);
if (extra.length) console.log(`[editors-i18n] 冗余条目 ${extra.length}（可删除）`);
if (missing.length) {
  console.log(missing.join('\n'));
  process.exit(1);
}
