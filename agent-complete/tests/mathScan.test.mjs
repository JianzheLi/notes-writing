/**
 * mathScan 单测：mathStateAt / maskNonMath / isMathEnvironment。
 *
 * 运行：`cd agent-complete && npm test`（= npm run compile && node --test tests/）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  maskNonMath,
  isMathEnvironment,
  checkState,
  checkMaskPreservesShape,
} from './_helpers.mjs';

/** needle 首次出现结束后的偏移（用来写清“命令之后”这类位置）。 */
const after = (text, needle) => text.indexOf(needle) + needle.length;

describe('mathStateAt: 行内 $...$', () => {
  it('完整 $x$ 的四个边界：左 $ 之前/之后、右 $ 之前/之后', () => {
    checkState('$x$', 0, {}, { note: '光标在左 $ 上（尚未进入公式）' });
    checkState('$x$', 1, { inSingleDollar: true }, { note: '光标紧跟左 $ 之后（已进入公式）' });
    checkState('$x$', 2, { inSingleDollar: true }, { note: '光标在右 $ 之前（仍在公式内）' });
    checkState('$x$', 3, {}, { note: '光标紧跟右 $ 之后（已离开公式）' });
  });

  it('嵌在普通文本中的公式：内部 inside，前后 outside', () => {
    const text = 'a $x$ b';
    const open = text.indexOf('$');
    const close = text.lastIndexOf('$');
    checkState(text, open, {}, { note: '左 $ 位置' });
    checkState(text, open + 1, { inSingleDollar: true }, { note: '左 $ 之后' });
    checkState(text, text.indexOf('x'), { inSingleDollar: true }, { note: '公式内容中' });
    checkState(text, close, { inSingleDollar: true }, { note: '右 $ 位置（闭包之前）' });
    checkState(text, close + 1, {}, { note: '右 $ 之后' });
  });

  it('$2x$：数字开头但有闭合，仍算行内公式', () => {
    const text = '$2x$';
    checkState(text, 1, { inSingleDollar: true }, { note: '左 $ 之后' });
    checkState(text, 3, { inSingleDollar: true }, { note: '右 $ 之前' });
    checkState(text, 4, {}, { note: '右 $ 之后' });
  });

  it('未闭合的 `设 $x + ` 视为正在写行内公式', () => {
    const text = '设 $x + ';
    const dollar = text.indexOf('$');
    checkState(text, dollar, {}, { note: '光标在左 $ 上' });
    checkState(text, dollar + 1, { inSingleDollar: true }, { note: '左 $ 之后' });
    checkState(text, text.length, { inSingleDollar: true }, { note: '行尾（尚未写右 $）' });
  });

  it('单个换行不结束行内公式，空行复位', () => {
    const singleNewline = '$x\n下一段';
    checkState(singleNewline, singleNewline.indexOf('下'), { inSingleDollar: true }, { note: '公式跨单个换行' });
    checkState(singleNewline, singleNewline.length, { inSingleDollar: true }, { note: '下一个段落开头仍在公式内' });

    const blankLine = '$x\n\n下一段';
    checkState(blankLine, blankLine.indexOf('下'), {}, { note: '空行之后公式已复位' });
    checkState(blankLine, blankLine.length, {}, { note: '复位后段落末尾不在公式内' });
  });

  it('$ 后紧跟空白 / 文本末尾的 $ 不算公式', () => {
    const spaced = '$ x$';
    checkState(spaced, 0, {}, { note: '$ 后是空白，不是合法公式开头' });
    checkState(spaced, spaced.length, {});

    checkState('$', 0, {}, { note: '文本只有一个 $' });
    checkState('$', 1, {});
  });

  it('金额中的 $ 不误判为公式', () => {
    const price = '价格 $100 元';
    for (const offset of [price.indexOf('$'), price.indexOf('$') + 2, price.length]) {
      checkState(price, offset, {}, { note: `金额场景（offset=${offset}）` });
    }

    const twoPrices = '$5 and $10';
    for (const offset of [0, 2, twoPrices.indexOf('$', 1), twoPrices.length]) {
      checkState(twoPrices, offset, {}, { note: `同行两个金额（offset=${offset}）` });
    }
  });
});

describe('mathStateAt: $$...$$ 行间公式', () => {
  it('完整 $$x$$ 的边界与内部', () => {
    const text = '$$x$$';
    checkState(text, 0, {}, { note: '第一个左 $ 之前' });
    checkState(text, 1, {}, { note: '两个左 $ 之间（$$ 尚未完成）' });
    checkState(text, 2, { inDoubleDollar: true }, { note: '左 $$ 之后' });
    checkState(text, 3, { inDoubleDollar: true }, { note: '公式内容中' });
    checkState(text, 4, { inDoubleDollar: true }, { note: '右 $$ 之前' });
    checkState(text, 5, {}, { note: '右 $$ 之后' });
  });

  it('嵌在文本中的 $$...$$', () => {
    const text = 'a $$x$$ b';
    const open = text.indexOf('$$');
    checkState(text, open, {}, { note: '左 $$ 之前' });
    checkState(text, open + 2, { inDoubleDollar: true }, { note: '左 $$ 之后' });
    checkState(text, text.lastIndexOf('$$') + 2, {}, { note: '右 $$ 之后' });
  });

  it('未闭合的 $$x 视为行间公式内', () => {
    checkState('$$x', 2, { inDoubleDollar: true }, { note: '左 $$ 之后' });
    checkState('$$x', 3, { inDoubleDollar: true }, { note: '行尾' });
  });
});

describe('mathStateAt: \\[...\\] 与 \\(...\\)', () => {
  it('\\[x\\] 内部算行间公式，闭合后复位', () => {
    const text = 'a \\[x\\] b';
    const open = text.indexOf('\\[');
    const close = text.indexOf('\\]');
    checkState(text, open, {}, { note: '\\[ 之前' });
    checkState(text, open + 1, {}, { note: '\\[ 两个字符之间（命令尚未完成）' });
    checkState(text, open + 2, { inBracketDisplay: true }, { note: '\\[ 之后' });
    checkState(text, text.indexOf('x'), { inBracketDisplay: true }, { note: '公式内容中' });
    checkState(text, close + 2, {}, { note: '\\] 之后' });
  });

  it('\\(x\\) 内部算行内公式，闭合后复位', () => {
    const text = 'a \\(x\\) b';
    const open = text.indexOf('\\(');
    const close = text.indexOf('\\)');
    checkState(text, open, {}, { note: '\\(' + ' 之前' });
    checkState(text, open + 1, {}, { note: '\\( 两个字符之间（命令尚未完成）' });
    checkState(text, open + 2, { inParenInline: true }, { note: '\\( 之后' });
    checkState(text, text.indexOf('x'), { inParenInline: true }, { note: '公式内容中' });
    checkState(text, close + 2, {}, { note: '\\) 之后' });
  });

  it('未闭合的 \\[ 与 \\( 视为公式内', () => {
    checkState('\\[x', 2, { inBracketDisplay: true }, { note: '未闭合 \\[' });
    checkState('\\[x', 3, { inBracketDisplay: true }, { note: '未闭合 \\[ 的行尾' });
    checkState('a \\(x', 4, { inParenInline: true }, { note: '未闭合 \\(' });
    checkState('a \\(x', 5, { inParenInline: true }, { note: '未闭合 \\( 的行尾' });
  });
});

describe('mathStateAt: LaTeX 数学环境', () => {
  it('equation：命令中间不算，命令之后 envStack 有值，\\end 之后清空', () => {
    const text = '\\begin{equation}\nx=1\n\\end{equation}';
    for (const offset of [0, 5, 10, 15]) {
      checkState(text, offset, {}, { note: `光标在 \\begin{equation} 命令中间（offset=${offset}）` });
    }
    checkState(text, after(text, '\\begin{equation}'), { envStack: ['equation'] }, { note: '\\begin{equation} 之后' });
    checkState(text, text.indexOf('x=1'), { envStack: ['equation'] }, { note: '环境内容中' });
    checkState(text, text.indexOf('\\end'), { envStack: ['equation'] }, { note: '光标在 \\end 命令中间，环境尚未结束' });
    checkState(text, text.length, {}, { note: '\\end{equation} 之后（环境已结束）' });
  });

  it('align* 环境名带星号也原样入栈', () => {
    const text = '\\begin{align*}\nx\n\\end{align*}';
    checkState(text, after(text, '\\begin{align*}'), { envStack: ['align*'] }, { note: '\\begin{align*} 之后' });
    checkState(text, text.indexOf('x'), { envStack: ['align*'] }, { note: '环境内容中' });
    checkState(text, after(text, '\\end{align*}'), {}, { note: '\\end{align*} 之后' });
  });

  it('figure 内的 equation：figure 不算数学环境，equation 算', () => {
    const text = '\\begin{figure}\n\\begin{equation}\nx=1\n\\end{equation}\n\\end{figure}';
    checkState(text, after(text, '\\begin{figure}'), {}, { note: '进入 figure（非数学环境）' });
    checkState(text, after(text, '\\begin{equation}'), { envStack: ['equation'] }, { note: '进入 figure 内的 equation' });
    checkState(text, text.indexOf('x=1'), { envStack: ['equation'] }, { note: 'equation 内容中' });
    checkState(text, after(text, '\\end{equation}'), {}, { note: 'equation 结束、仍在 figure 内' });
    checkState(text, text.length, {}, { note: 'figure 结束' });
  });

  it('figure / table / document 不算数学环境', () => {
    for (const name of ['figure', 'table', 'document']) {
      const text = `\\begin{${name}}x\\end{${name}}`;
      checkState(text, after(text, `\\begin{${name}}`), {}, { note: `${name} 环境内部` });
      checkState(text, text.length - 1, {}, { note: `${name} 环境结尾` });
    }
  });

  it('嵌套数学环境按顺序入栈/出栈（equation + aligned）', () => {
    const text = '\\begin{equation}\\begin{aligned}x\\end{aligned}\\end{equation}';
    checkState(text, after(text, '\\begin{equation}'), { envStack: ['equation'] }, { note: '进入 equation' });
    checkState(text, after(text, '\\begin{aligned}'), { envStack: ['equation', 'aligned'] }, { note: '再进入 aligned' });
    checkState(text, after(text, '\\end{aligned}'), { envStack: ['equation'] }, { note: '退出 aligned，仍在 equation' });
    checkState(text, text.length, {}, { note: '退出 equation' });
  });

  it('孤立的 \\end 不会让 envStack 变负或抛错', () => {
    const text = '\\end{equation} x';
    checkState(text, 0, {}, { note: '文本开头就是 \\end' });
    checkState(text, text.length, {}, { note: '扫描结束' });
  });

  it('\\begin 与 { 之间有空格也能识别', () => {
    const text = '\\begin {equation}x';
    checkState(text, text.indexOf('}'), {}, { note: '光标仍在命令中间' });
    checkState(text, after(text, '\\begin {equation}'), { envStack: ['equation'] }, { note: '命令之后' });
  });
});

describe('mathStateAt: 注释、转义与代码区域', () => {
  it('LaTeX % 注释里的 $ 不算公式，注释之后的 $ 算', () => {
    const text = '% $x$\n$y$';
    checkState(text, 2, {}, { languageId: 'latex', note: '注释内的左 $' });
    checkState(text, 4, {}, { languageId: 'latex', note: '注释内的右 $' });
    checkState(text, text.indexOf('y'), { inSingleDollar: true }, { languageId: 'latex', note: '注释后的真实公式内' });
    checkState(text, text.length, {}, { languageId: 'latex', note: '真实公式闭合后' });
  });

  it('转义的 \\% 不会开启注释，后面的 $ 仍算公式', () => {
    const text = '100\\% $x$';
    checkState(text, text.indexOf('x'), { inSingleDollar: true }, { languageId: 'latex' });
    checkState(text, text.length, {}, { languageId: 'latex' });
  });

  it('markdown 里 % 不是注释', () => {
    const text = '% $x$';
    checkState(text, text.indexOf('x'), { inSingleDollar: true }, { note: 'markdown 的 % 是普通字符' });
  });

  it('转义的 \\$ 不算行内定界符', () => {
    for (const languageId of ['markdown', 'latex']) {
      const text = '价格 \\$100 元';
      checkState(text, text.indexOf('$'), {}, { languageId, note: '$ 被转义' });
      checkState(text, text.indexOf('$') + 1, {}, { languageId, note: '转义 $ 之后' });
      checkState(text, text.length, {}, { languageId });
    }

    // 文本内容为 \\$x$：两个反斜杠表示转义后的反斜杠，其后的 $ 才是定界符。
    const doubleBackslash = '\\\\$x$';
    checkState(doubleBackslash, 3, { inSingleDollar: true }, { note: '\\\\ 之后的 $ 仍是定界符' });
    checkState(doubleBackslash, doubleBackslash.length, {});
  });

  it('markdown 围栏代码块里的 $ 不算公式', () => {
    for (const text of ['```\n$x$\n```', '```latex\n$x$\n```', '~~~\n$x$\n~~~']) {
      checkState(text, text.indexOf('$') + 1, {}, { note: `围栏代码内：${JSON.stringify(text)}` });
      checkState(text, text.length, {}, { note: `围栏代码块结束后：${JSON.stringify(text)}` });
    }
  });

  it('markdown 行内代码里的 $ 不算公式', () => {
    const text = 'a `$x$` b';
    checkState(text, text.indexOf('$') + 1, {}, { note: '行内代码内' });
    checkState(text, text.length, {});
  });

  it('markdown HTML 注释里的 $ 不算公式', () => {
    const text = '<!-- $x$ -->';
    checkState(text, text.indexOf('$') + 1, {}, { note: 'HTML 注释内' });
    checkState(text, text.length, {});
  });

  it('LaTeX verbatim 环境里的 $ 不算，环境之后的 $ 算', () => {
    const text = '\\begin{verbatim}\n$x$\n\\end{verbatim}\n$y$';
    checkState(text, text.indexOf('$') + 1, {}, { languageId: 'latex', note: 'verbatim 内的 $' });
    checkState(text, text.lastIndexOf('y'), { inSingleDollar: true }, { languageId: 'latex', note: 'verbatim 之后的真实公式内' });
  });
});

describe('maskNonMath: 等长屏蔽非数学区域', () => {
  it('markdown 围栏代码块整段屏蔽，长度、换行与非代码文本保留', () => {
    const text = '前\n```\n$x$ 内容\n```\n后';
    const masked = maskNonMath(text, 'markdown');
    checkMaskPreservesShape(text, masked, 'markdown 围栏代码块');
    assert.ok(
      !masked.includes('$'),
      `围栏代码块里的 $ 应被屏蔽\n  原文: ${JSON.stringify(text)}\n  掩码: ${JSON.stringify(masked)}`,
    );
    assert.strictEqual(masked[0], '前', `围栏前的普通文本应保留\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(masked[masked.length - 1], '后', `围栏后的普通文本应保留\n  掩码: ${JSON.stringify(masked)}`);
  });

  it('markdown 围栏语言标记与 ~~~ 围栏也屏蔽', () => {
    const text = '```latex\n$x$\n```\n~~~\n$y$\n~~~';
    const masked = maskNonMath(text, 'markdown');
    checkMaskPreservesShape(text, masked, 'markdown 围栏（语言标记 + ~~~）');
    assert.ok(!masked.includes('$'), `围栏内的 $ 应被屏蔽\n  原文: ${JSON.stringify(text)}\n  掩码: ${JSON.stringify(masked)}`);
  });

  it('markdown 行内代码屏蔽但等长保留其他文本', () => {
    const text = 'a `$x$` b';
    const masked = maskNonMath(text, 'markdown');
    checkMaskPreservesShape(text, masked, 'markdown 行内代码');
    assert.ok(!masked.includes('$'), `行内代码里的 $ 应被屏蔽\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(masked.slice(0, 2), 'a ', `行内代码之前的文本应保留\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(masked.slice(-2), ' b', `行内代码之后的文本应保留\n  掩码: ${JSON.stringify(masked)}`);
  });

  it('markdown HTML 注释屏蔽', () => {
    const text = '前 <!-- $x$ --> 后';
    const masked = maskNonMath(text, 'markdown');
    checkMaskPreservesShape(text, masked, 'markdown HTML 注释');
    assert.ok(!masked.includes('$'), `HTML 注释里的 $ 应被屏蔽\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(masked[0], '前', `HTML 注释之前的文本应保留\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(masked[masked.length - 1], '后', `HTML 注释之后的文本应保留\n  掩码: ${JSON.stringify(masked)}`);
  });

  it('latex % 注释屏蔽到行尾、换行保留', () => {
    const text = 'a % $x$\nb';
    const masked = maskNonMath(text, 'latex');
    checkMaskPreservesShape(text, masked, 'latex % 注释');
    assert.ok(!masked.includes('$'), `注释里的 $ 应被屏蔽\n  掩码: ${JSON.stringify(masked)}`);
    assert.strictEqual(
      masked,
      `a${' '.repeat(6)}\nb`,
      `行内 % 之后到行尾都应变成空格，换行保留\n  原文: ${JSON.stringify(text)}\n  掩码: ${JSON.stringify(masked)}`,
    );
  });

  it('latex 转义的 \\% 不会被当成注释，文本原样保留', () => {
    const text = '100\\% $x$';
    const masked = maskNonMath(text, 'latex');
    checkMaskPreservesShape(text, masked, 'latex 转义 \\%');
    assert.strictEqual(
      masked,
      text,
      `\\% 是转义百分号，不应触发注释屏蔽\n  期望: ${JSON.stringify(text)}\n  实际: ${JSON.stringify(masked)}`,
    );
  });

  it('latex verbatim 环境屏蔽，环境之后的内容原样保留', () => {
    const text = '\\begin{verbatim}\n$x$\n\\end{verbatim}\n$y$';
    const masked = maskNonMath(text, 'latex');
    checkMaskPreservesShape(text, masked, 'latex verbatim');
    const verbatimEnd = after(text, '\\end{verbatim}');
    assert.ok(
      !masked.slice(0, verbatimEnd).includes('$'),
      `verbatim 环境内的 $ 应被屏蔽\n  掩码: ${JSON.stringify(masked)}`,
    );
    assert.strictEqual(
      masked.slice(verbatimEnd),
      text.slice(verbatimEnd),
      `verbatim 环境之后的内容不应被屏蔽\n  期望: ${JSON.stringify(text.slice(verbatimEnd))}\n  实际: ${JSON.stringify(masked.slice(verbatimEnd))}`,
    );
  });

  it('非 markdown/latex 语言原样返回', () => {
    const text = 'a $x$ % b';
    assert.strictEqual(maskNonMath(text, 'python'), text, 'python 语言不应做任何屏蔽');
    assert.strictEqual(maskNonMath(text, ''), text, '空 languageId 不应做任何屏蔽');
  });
});

describe('isMathEnvironment', () => {
  it('数学环境返回 true（含带星号与首尾空白）', () => {
    const mathEnvironments = [
      'equation',
      'equation*',
      'align',
      'align*',
      'alignat',
      'gather',
      'multline',
      'eqnarray',
      'flalign',
      'displaymath',
      'split',
      'aligned',
      'alignedat',
      'gathered',
      'cases',
      'array',
      'matrix',
      'pmatrix',
      'bmatrix',
      'Bmatrix',
      'vmatrix',
      'Vmatrix',
      'smallmatrix',
    ];
    for (const name of mathEnvironments) {
      assert.strictEqual(
        isMathEnvironment(name),
        true,
        `期望 ${JSON.stringify(name)} 是数学环境\n  期望: true\n  实际: false`,
      );
    }
    assert.strictEqual(isMathEnvironment('  align*  '), true, '首尾空白应被忽略');
  });

  it('figure/table/document 等普通环境返回 false', () => {
    const plainEnvironments = [
      'figure',
      'figure*',
      'table',
      'table*',
      'document',
      'tabular',
      'itemize',
      'enumerate',
      'verbatim',
      'lstlisting',
      'notmath',
      '',
    ];
    for (const name of plainEnvironments) {
      assert.strictEqual(
        isMathEnvironment(name),
        false,
        `期望 ${JSON.stringify(name)} 不是数学环境\n  期望: false\n  实际: true`,
      );
    }
  });
});
