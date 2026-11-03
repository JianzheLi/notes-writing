/**
 * postprocess 单测：buildSuggestion 的定界符处理、围栏剥离与 replace 选项。
 *
 * 运行：`cd agent-complete && npm test`（= npm run compile && node --test tests/）
 */
import { describe, it } from 'node:test';

import { checkSuggestion } from './_helpers.mjs';

const inline = (raw, expected, note) => checkSuggestion(raw, 'inline', '', undefined, expected, note);
const display = (raw, lineBefore, expected, note) =>
  checkSuggestion(raw, 'display', lineBefore, undefined, expected, note);

describe('buildSuggestion: inline 模式', () => {
  it('普通内容包成 $...$', () => {
    inline('x^2', '$x^2$');
    inline('E = mc^2', '$E = mc^2$');
  });

  it('lineBefore 对 inline 模式无影响', () => {
    checkSuggestion('x^2', 'inline', '前面的文字', undefined, '$x^2$');
    checkSuggestion('x^2', 'inline', '   ', undefined, '$x^2$');
  });

  it('已带定界符时不重复包裹', () => {
    inline('$x$', '$x$', '已带 $...$');
    inline('$$x$$', '$x$', '$$...$$ 收敛成 $...$');
    inline('$$x^2$$', '$x^2$', '$$...$$ 收敛成 $...$');
    inline('\\(x\\)', '$x$', '\\(...\\) 换成 $...$');
    inline('$$ x $$', '$x$', '定界符内空白被 trim');
  });

  it('```latex 围栏被剥掉', () => {
    inline('```latex\nx^2\n```', '$x^2$');
    inline('```\n\\frac{1}{2}\n```', '$\\frac{1}{2}$');
  });

  it('首尾空白被 trim', () => {
    inline('  x^2  ', '$x^2$');
    inline('\n\nx^2\n\n', '$x^2$');
  });

  it('空输入/纯空白返回空字符串', () => {
    inline('', '', '空字符串');
    inline('   ', '', '纯空格');
    inline('\n\n\t', '', '纯空白字符');
  });

  it('replace 选项对 inline 输出无影响', () => {
    checkSuggestion('x', 'inline', '前文', { replace: true, trailingNewlines: 2 }, '$x$');
  });
});

describe('buildSuggestion: display 模式', () => {
  it('lineBefore 为空时独占一段：$$\\n内容\\n$$\\n', () => {
    display('x^2', '', '$$\nx^2\n$$\n');
    display('x^2', '   ', '$$\nx^2\n$$\n', 'lineBefore 只有空白，视为空行');
  });

  it('lineBefore 非空时前置一个空行', () => {
    display('x^2', '前面的文字', '\n\n$$\nx^2\n$$\n');
  });

  it('已带 $$...$$ 或 \\[...\\] 时去重后重新包裹', () => {
    display('$$x^2$$', '', '$$\nx^2\n$$\n');
    display('\\[x^2\\]', '', '$$\nx^2\n$$\n');
    display('$$ x^2 $$', '', '$$\nx^2\n$$\n');
  });

  it('```latex 围栏被剥掉，CRLF 归一化成 LF', () => {
    display('```latex\nx^2\n```', '', '$$\nx^2\n$$\n');
    display('```latex\r\nx^2\r\n```', '', '$$\nx^2\n$$\n');
  });

  it('LaTeX 环境块原样保留、不额外套 $$', () => {
    const equation = '\\begin{equation}\nx=1\n\\end{equation}';
    display(equation, '', `${equation}\n`);
    display(equation, '前面的文字', `\n\n${equation}\n`);

    const align = '\\begin{align*}\nx\n\\end{align*}';
    display(align, '', `${align}\n`);
  });

  it('空输入返回空字符串', () => {
    display('', '', '');
    display('  \n\t ', '', '');
    display('```latex\n```', '', '', '空围栏');
  });
});

describe('buildSuggestion: display + replace（替换选区）', () => {
  it('replace 模式不加前导空行（即使 lineBefore 非空）', () => {
    checkSuggestion('x^2', 'display', '前面的文字', { replace: true }, '$$\nx^2\n$$');
  });

  it('trailingNewlines 控制结尾换行数', () => {
    checkSuggestion('x^2', 'display', '', { replace: true }, '$$\nx^2\n$$');
    checkSuggestion('x^2', 'display', '', { replace: true, trailingNewlines: 0 }, '$$\nx^2\n$$');
    checkSuggestion('x^2', 'display', '', { replace: true, trailingNewlines: 1 }, '$$\nx^2\n$$\n');
    checkSuggestion('x^2', 'display', '', { replace: true, trailingNewlines: 2 }, '$$\nx^2\n$$\n\n');
  });

  it('trailingNewlines 负数取 0、小数向下取整', () => {
    checkSuggestion('x^2', 'display', '', { replace: true, trailingNewlines: -3 }, '$$\nx^2\n$$');
    checkSuggestion('x^2', 'display', '', { replace: true, trailingNewlines: 1.9 }, '$$\nx^2\n$$\n');
  });

  it('环境块 replace 时不套 $$，只按 trailingNewlines 补换行', () => {
    const align = '\\begin{align*}\nx\n\\end{align*}';
    checkSuggestion(align, 'display', '', { replace: true, trailingNewlines: 1 }, `${align}\n`);
    checkSuggestion(align, 'display', '', { replace: true, trailingNewlines: 2 }, `${align}\n\n`);
  });
});

describe('buildSuggestion: continue-* 模式（只返回公式内容）', () => {
  it('continue-inline 去掉行内定界符', () => {
    checkSuggestion('$y$', 'continue-inline', '', undefined, 'y');
    checkSuggestion('y', 'continue-inline', '', undefined, 'y', '没有定界符时原样返回');
    checkSuggestion('\\(y\\)', 'continue-inline', '', undefined, 'y');
    checkSuggestion('```latex\n$y$\n```', 'continue-inline', '', undefined, 'y', '围栏也会被剥掉');
  });

  it('continue-display 去掉行间定界符', () => {
    checkSuggestion('$$z$$', 'continue-display', '', undefined, 'z');
    checkSuggestion('z', 'continue-display', '', undefined, 'z', '没有定界符时原样返回');
    checkSuggestion('\\[z\\]', 'continue-display', '', undefined, 'z');
    checkSuggestion('```latex\nz\n```', 'continue-display', '', undefined, 'z', '围栏也会被剥掉');
  });

  it('continue-display 不破坏 LaTeX 环境块', () => {
    const equation = '\\begin{equation}\nx=1\n\\end{equation}';
    checkSuggestion(equation, 'continue-display', '', undefined, equation);
  });

  it('空输入返回空字符串', () => {
    checkSuggestion('', 'continue-inline', '', undefined, '');
    checkSuggestion('', 'continue-display', '', undefined, '');
    checkSuggestion('   ', 'continue-inline', '', undefined, '');
  });
});
