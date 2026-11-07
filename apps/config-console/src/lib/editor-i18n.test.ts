import { describe, expect, it } from 'vitest';
import { EDITORS } from './editors';
import { EDITOR_EN, localizeEditorText } from './editor-i18n';

function collect(): string[] {
  const set = new Set<string>();
  for (const editor of Object.values(EDITORS)) {
    if (editor.note) set.add(editor.note);
    for (const field of editor.fields ?? []) {
      if (field.label) set.add(field.label);
      if (field.hint) set.add(field.hint);
    }
  }
  return [...set];
}

describe('editor-i18n', () => {
  it('covers every editor label / hint / note', () => {
    const missing = collect().filter((text) => !EDITOR_EN[text]);
    expect(missing).toEqual([]);
  });

  it('does not keep stale entries', () => {
    const known = new Set(collect());
    const stale = Object.keys(EDITOR_EN).filter((text) => !known.has(text));
    expect(stale).toEqual([]);
  });

  it('translates in en and keeps zh as-is', () => {
    expect(localizeEditorText('主机', 'en-US')).toBe('Host');
    expect(localizeEditorText('主机', 'zh-CN')).toBe('主机');
  });

  it('falls back to the source text for unknown strings', () => {
    expect(localizeEditorText('未来新增的文案', 'en-US')).toBe('未来新增的文案');
    expect(localizeEditorText('', 'en-US')).toBe('');
    expect(localizeEditorText(undefined, 'en-US')).toBe('');
  });
});
