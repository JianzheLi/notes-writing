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

// auto 模式：行内/行间由模型输出决定，模型没带定界符时按位置兜底。

test('postprocess auto: 模型输出 $$...$$ 时按行间处理', () => {
  assert.equal(buildSuggestion('$$x^2$$', 'auto', ''), '$$\nx^2\n$$\n');
});

test('postprocess auto: 模型输出 $...$ 时按行内处理（即使在行尾）', () => {
  assert.equal(buildSuggestion('$x^2$', 'auto', '其中方差为 '), '$x^2$');
});

test('postprocess auto: 模型输出 \\(...\\) 时按行内处理', () => {
  assert.equal(buildSuggestion(String.raw`\(x\)`, 'auto', ''), '$x$');
});

test('postprocess auto: 模型没带定界符时按位置兜底（行首→行间，句中→行内）', () => {
  assert.equal(buildSuggestion('x^2', 'auto', ''), '$$\nx^2\n$$\n');
  assert.equal(buildSuggestion('x^2', 'auto', '其中 '), '$x^2$');
});

test('postprocess auto: 环境块原样插入', () => {
  assert.equal(
    buildSuggestion(String.raw`\begin{equation}x\end{equation}`, 'auto', ''),
    '\\begin{equation}x\\end{equation}\n',
  );
});

test('postprocess auto: replace 模式下行间公式不加前导空行', () => {
  assert.equal(
    buildSuggestion('$$x$$', 'auto', 'some text', {
      replace: true,
      trailingNewlines: 2,
    }),
    '$$\nx\n$$\n\n',
  );
});

test('postprocess display: 光标在行尾时不再补尾随换行（避免多一个空行）', () => {
  assert.equal(
    buildSuggestion('x^2', 'display', '描述文字', { lineEnd: true }),
    '\n\n$$\nx^2\n$$',
  );
  assert.equal(
    buildSuggestion('x^2', 'display', '', { lineEnd: true }),
    '$$\nx^2\n$$',
  );
  assert.equal(
    buildSuggestion(String.raw`\begin{equation}x\end{equation}`, 'display', '', {
      lineEnd: true,
    }),
    String.raw`\begin{equation}x\end{equation}`,
  );
});

test('postprocess auto: 行尾的行间公式同样不补尾随换行', () => {
  assert.equal(
    buildSuggestion('$$x$$', 'auto', '描述文字', { lineEnd: true }),
    '\n\n$$\nx\n$$',
  );
});
