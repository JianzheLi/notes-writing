import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractMacros } = require('../out/macros.js');

test('macros: 提取单行宏定义', () => {
  const text = String.raw`\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator{\Var}{Var}
正文`;
  const macros = extractMacros(text, 'latex', 1000);
  assert.match(macros, /\\newcommand\{\\R\}/);
  assert.match(macros, /\\DeclareMathOperator\{\\Var\}/);
});

test('macros: 跨行定义', () => {
  const text = String.raw`\newcommand{\norm}[1]{
  \left\lVert #1 \right\rVert
}
正文`;
  const macros = extractMacros(text, 'latex', 1000);
  assert.match(macros, /\\newcommand/);
  assert.match(macros, /right\\rVert/);
});

test('macros: 忽略注释里的定义', () => {
  const text = String.raw`% \newcommand{\Fake}{fake}
\newcommand{\Real}{real}`;
  const macros = extractMacros(text, 'latex', 1000);
  assert.ok(!macros.includes('Fake'));
  assert.ok(macros.includes('\\Real'));
});

test('macros: 忽略 Markdown 代码块里的定义', () => {
  const text = [
    '```latex',
    String.raw`\newcommand{\Fake}{fake}`,
    '```',
    String.raw`\newcommand{\Real}{real}`,
  ].join('\n');
  const macros = extractMacros(text, 'markdown', 1000);
  assert.ok(!macros.includes('Fake'));
  assert.ok(macros.includes('\\Real'));
});

test('macros: 同名定义去重', () => {
  const text = String.raw`\newcommand{\R}{1}
\newcommand{\R}{2}
\newcommand{\Q}{3}`;
  const macros = extractMacros(text, 'latex', 1000);
  assert.equal((macros.match(/newcommand\{\\R\}/g) ?? []).length, 1);
  assert.ok(macros.includes('\\Q'));
});

test('macros: 按预算截断', () => {
  const text = String.raw`\newcommand{\A}{aaaaaaaaaa}
\newcommand{\B}{bbbbbbbbbb}
\newcommand{\C}{cccccccccc}`;
  const macros = extractMacros(text, 'latex', 30);
  assert.ok(macros.includes('\\A'));
  assert.ok(!macros.includes('\\C'));
});
