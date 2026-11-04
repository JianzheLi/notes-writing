import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findSection } = require('../out/outline.js');

test('outline: Markdown 标题层级', () => {
  const text = '# 1. 引言\n\n## 1.1 背景\n\n正文\n';
  const info = findSection(text, text.indexOf('正文'), 'markdown');
  assert.equal(info.path, '1. 引言 > 1.1 背景');
  assert.equal(info.heading, '1.1 背景');
});

test('outline: Markdown 忽略代码块里的假标题', () => {
  const text = '# 真标题\n\n```md\n# 假标题\n```\n\n## 子节\n\n正文\n';
  const info = findSection(text, text.indexOf('正文'), 'markdown');
  assert.equal(info.path, '真标题 > 子节');
});

test('outline: 光标之后的标题不算', () => {
  const text = '# A\n\n正文\n\n## 后面才出现的标题\n';
  const info = findSection(text, text.indexOf('正文'), 'markdown');
  assert.equal(info.path, 'A');
});

test('outline: LaTeX 层级与注释', () => {
  const text = [
    '% \\section{注释里的假标题}',
    '\\section{引言}',
    '\\subsection{定义}',
    '正文',
  ].join('\n');
  const info = findSection(text, text.indexOf('正文'), 'latex');
  assert.equal(info.path, '引言 > 定义');
});

test('outline: 没有标题时返回空', () => {
  const text = '只有正文\n';
  const info = findSection(text, 0, 'markdown');
  assert.equal(info.path, '');
});
