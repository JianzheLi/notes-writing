import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMessages } = require('../out/prompt.js');

function position(content, needle) {
  const index = content.indexOf(needle);
  assert.notEqual(index, -1, `缺少片段：${needle}`);
  return index;
}

test('prompt: 宏定义在 prefix 之前，选区在 suffix 之后', () => {
  const messages = buildMessages({
    fileName: 'note.md',
    languageId: 'markdown',
    context: {
      prefix: 'PREFIX',
      suffix: 'SUFFIX',
      section: '3. 采样 > 3.2 得分匹配',
      macros: '\\newcommand{\\R}{\\mathbb{R}}',
      lineBefore: 'PREFIX',
      selection: 'DESC',
    },
    math: { mode: 'inline', insideMath: false, reason: 'test' },
  });
  const user = messages[1].content;

  const section = position(user, '当前小节：3. 采样 > 3.2 得分匹配');
  const macros = position(user, '【宏定义/符号】');
  const prefix = position(user, 'PREFIX');
  const cursor = position(user, '【光标位置】');
  const suffix = position(user, 'SUFFIX');
  const selection = position(user, '【选区描述（将用公式替换）】');
  const requirement = position(user, '要求：');

  assert.ok(section < macros);
  assert.ok(macros < prefix);
  assert.ok(prefix < cursor);
  assert.ok(cursor < suffix);
  assert.ok(suffix < selection);
  assert.ok(selection < requirement);
});

test('prompt: 没有宏/选区时不出现空块', () => {
  const messages = buildMessages({
    fileName: 'note.md',
    languageId: 'markdown',
    context: {
      prefix: 'PREFIX',
      suffix: 'SUFFIX',
      section: '',
      macros: '',
      lineBefore: 'PREFIX',
    },
    math: { mode: 'auto', insideMath: false, reason: 'test' },
  });
  const user = messages[1].content;
  assert.ok(!user.includes('【宏定义/符号】'));
  assert.ok(!user.includes('【选区描述'));
});
