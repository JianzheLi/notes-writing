import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mathStateAt } = require('../out/mathScan.js');
const { buildSuggestion } = require('../out/postprocess.js');

// 这些用例对应 reviewer 在 M2 审查里给的 P2 回归项。

test('postprocess: 行内公式以 \\$ 结尾时不能吃掉转义美元', () => {
  const raw = String.raw`$x = \$$`;
  assert.equal(buildSuggestion(raw, 'inline', ''), String.raw`$x = \$$`);
});

test('postprocess: 只有开围栏（输出被截断）时也剥掉', () => {
  const raw = '```latex\nx^2';
  assert.equal(buildSuggestion(raw, 'inline', ''), '$x^2$');
});

test('postprocess: display 任务返回 \\(...\\) 时归一成行间公式', () => {
  assert.equal(buildSuggestion(String.raw`\(x\)`, 'display', ''), '$$\nx\n$$\n');
});

test('mathScan: 围栏代码块里的未闭合 <!-- 不影响后面的真公式', () => {
  const text = '```\n<!--\n```\n$x + 1$';
  const offset = text.indexOf('x + 1') + 1;
  assert.equal(mathStateAt(text, offset, 'markdown').inSingleDollar, true);
});

test('mathScan: \\verb|50%| 后面的同行公式不被 % 注释吞掉', () => {
  const text = String.raw`\verb|50%| 公式 $x$`;
  const offset = text.indexOf('$x$') + 2;
  assert.equal(mathStateAt(text, offset, 'latex').inSingleDollar, true);
});

test('mathScan: 金额 + 同行真公式：金额段内不算公式', () => {
  const text = '价格 $100，所以 $x$ 是公式';
  const offset = text.indexOf('所以') + 1;
  assert.equal(mathStateAt(text, offset, 'markdown').inSingleDollar, false);
  const insideFormula = text.indexOf('$x$') + 2;
  assert.equal(mathStateAt(text, insideFormula, 'markdown').inSingleDollar, true);
});

test('mathScan: LaTeX 允许 $ x + y $ 这种带空格的写法', () => {
  const text = '$ x + y $';
  assert.equal(mathStateAt(text, 4, 'latex').inSingleDollar, true);
  assert.equal(mathStateAt(text, text.length, 'latex').inSingleDollar, false);
});

test('mathScan: \\begin{align} 与 \\end{align*} 按去星号名字兜底配对', () => {
  const text = String.raw`\begin{align}x\end{align*}`;
  const inside = mathStateAt(text, text.indexOf('x') + 1, 'latex');
  assert.deepEqual(inside.envStack, ['align']);
  const after = mathStateAt(text, text.length, 'latex');
  assert.deepEqual(after.envStack, []);
});
