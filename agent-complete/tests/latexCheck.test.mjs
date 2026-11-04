import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkLatexSuggestion } = require('../out/latexCheck.js');

function assertOk(text, mode) {
  const result = checkLatexSuggestion(text, mode);
  assert.deepEqual(result.issues, [], `${mode} 应通过：${JSON.stringify(text)}`);
  assert.equal(result.ok, true);
}

function codesFor(text, mode) {
  return checkLatexSuggestion(text, mode).issues.map((issue) => issue.code);
}

test('latexCheck: 合法的行内公式', () => {
  assertOk('$x^2 + \\frac{1}{2}$', 'inline');
});

test('latexCheck: 合法的行间公式', () => {
  assertOk('$$\n\\frac{a}{b}\n$$', 'display');
});

test('latexCheck: 合法的环境块', () => {
  assertOk('\\begin{equation}\nE = mc^2\n\\end{equation}', 'display');
});

test('latexCheck: continue 模式只检查内容', () => {
  assertOk('\\operatorname{Var}(X) + \\frac{1}{2}', 'continue-display');
  assertOk('x^2 + 1', 'continue-inline');
});

test('latexCheck: 转义美元不会误报', () => {
  assertOk('$x = \\$5$', 'inline');
});

test('latexCheck: 转义大括号不会误报', () => {
  assertOk('$\\{x\\}$', 'inline');
});

test('latexCheck: \\left/\\right 配对正常', () => {
  assertOk('$\\left( x \\right)$', 'inline');
});

test('latexCheck: \\leftarrow 不算 \\left', () => {
  assertOk('$a \\leftarrow b$', 'inline');
});

test('latexCheck: 行内公式缺少闭合 $', () => {
  assert.ok(codesFor('$x', 'inline').includes('delimiter'));
});

test('latexCheck: inline 模式拿到 $$...$$', () => {
  assert.ok(codesFor('$$x$$', 'inline').includes('delimiter'));
});

test('latexCheck: 大括号不配对', () => {
  assert.ok(codesFor('$\\frac{a}{b$', 'inline').includes('brace'));
  assert.ok(codesFor('$x}$', 'inline').includes('brace'));
});

test('latexCheck: \\left/\\right 数量不等', () => {
  assert.ok(codesFor('$\\left( x$', 'inline').includes('left-right'));
});

test('latexCheck: 环境 begin/end 不匹配', () => {
  assert.ok(
    codesFor('\\begin{equation}x\\end{align}', 'display').includes('environment'),
  );
  assert.ok(
    codesFor('\\begin{equation}x', 'display').includes('environment'),
  );
});

test('latexCheck: 内容里出现未转义 $', () => {
  assert.ok(codesFor('x$y', 'continue-inline').includes('dollar'));
});

test('latexCheck: display 模式没有 $$ 定界符', () => {
  assert.ok(codesFor('x^2', 'display').includes('delimiter'));
});

test('latexCheck: auto 模式按输出定界符判断', () => {
  assertOk('$x$', 'auto');
  assertOk('$$\nx\n$$', 'auto');
  assertOk('\\begin{equation}x\\end{equation}', 'auto');
});

test('latexCheck: 嵌套环境正常', () => {
  assertOk(
    '\\begin{equation}\\begin{aligned}x\\end{aligned}\\end{equation}',
    'display',
  );
});

test('latexCheck: 空输出', () => {
  const result = checkLatexSuggestion('   ', 'inline');
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'delimiter'));
});
