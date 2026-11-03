/**
 * 数学环境扫描（纯函数，不依赖 vscode，方便单测）。
 *
 * 目标：判断光标位置是否已经在某个数学结构内部，从而决定「补全公式内容」
 * 还是「新写一个行内/行间公式」。
 *
 * 支持：
 * - `$...$`、`$$...$$`、`\[...\]`、`\(...\)`
 * - `equation` / `align` / `align*` 等数学环境（figure/table 等普通环境不算）
 * - LaTeX `%` 注释、`\verb`、verbatim 类环境
 * - Markdown 围栏代码块、行内代码、HTML 注释
 * - 转义 `\$`、`\{` 等
 *
 * 启发式：
 * - 未闭合的 `$x + ` 视为「正在写行内公式」（用户还没写右 `$`）
 * - `$100` 这类以数字开头且没有行内闭合的 `$` 视为金额，不进入公式模式
 * - 行内公式不跨空行；`$` 未闭合时遇到空行自动复位
 */

export interface MathScanState {
  inSingleDollar: boolean;
  inDoubleDollar: boolean;
  inBracketDisplay: boolean;
  inParenInline: boolean;
  envStack: string[];
}

/** 会被当作「数学环境」的 LaTeX 环境（不含 figure/table/document 等）。 */
const MATH_ENVIRONMENTS = new Set([
  'equation',
  'align',
  'alignat',
  'gather',
  'multline',
  'eqnarray',
  'flalign',
  'displaymath',
  'math',
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
]);

/** 行内 `$` 开区间最多向后找这么多个字符的闭合位置。 */
const INLINE_LOOKAHEAD = 4000;
/** 金额启发式：配对区间里出现中文/全角标点，基本可以认定不是公式。 */
const CJK_OR_FULLWIDTH = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

export function isMathEnvironment(name: string): boolean {
  return MATH_ENVIRONMENTS.has(name.trim().replace(/\*$/, ''));
}

function initialState(): MathScanState {
  return {
    inSingleDollar: false,
    inDoubleDollar: false,
    inBracketDisplay: false,
    inParenInline: false,
    envStack: [],
  };
}

function cloneState(state: MathScanState): MathScanState {
  return { ...state, envStack: [...state.envStack] };
}

/**
 * 返回 text 中 offset 位置（字符边界）的数学状态。
 * offset 之前的内容决定状态；向后看是为了判断 `$` 是否有闭合。
 */
export function mathStateAt(
  text: string,
  offset: number,
  languageId: string,
): MathScanState {
  const masked = maskNonMath(text, languageId);
  // LaTeX 里 $ x + y $ 是合法的（TeX 会忽略空格）；Markdown 里按常见写法收紧，
  // 避免把金额 $100 误判成公式。
  const relaxedDollar = languageId === 'latex' || languageId === 'tex';
  const state = initialState();
  let snapshot: MathScanState | undefined;

  const capture = (tokenEnd: number) => {
    if (!snapshot && offset < tokenEnd) snapshot = cloneState(state);
  };

  let i = 0;
  while (i < masked.length) {
    const char = masked[i];

    if (char === '\\') {
      const token = scanLatexCommand(masked, i);
      capture(i + token.length);
      applyLatexToken(state, token);
      i += token.length;
      continue;
    }

    if (char === '$') {
      const action = classifyDollar(masked, i, state, relaxedDollar);
      capture(i + action.length);
      applyDollar(state, action);
      i += action.length;
      continue;
    }

    if (char === '\n' && state.inSingleDollar) {
      capture(i + 1);
      if (startsNewParagraph(masked, i)) state.inSingleDollar = false;
      i += 1;
      continue;
    }

    i += 1;
  }

  return snapshot ?? cloneState(state);
}

type LatexToken =
  | { length: number; kind: 'begin'; name: string }
  | { length: number; kind: 'end'; name: string }
  | {
      length: number;
      kind:
        | 'bracket-open'
        | 'bracket-close'
        | 'paren-open'
        | 'paren-close'
        | 'skip';
    };

function scanLatexCommand(masked: string, index: number): LatexToken {
  const next = masked[index + 1];
  if (next === '\\') return { length: 2, kind: 'skip' };
  if (next === '[') return { length: 2, kind: 'bracket-open' };
  if (next === ']') return { length: 2, kind: 'bracket-close' };
  if (next === '(') return { length: 2, kind: 'paren-open' };
  if (next === ')') return { length: 2, kind: 'paren-close' };

  const rest = masked.slice(index);
  const begin = /^\\begin\s*\{([^}]*)\}/.exec(rest);
  if (begin) {
    return { length: begin[0].length, kind: 'begin', name: begin[1].trim() };
  }
  const end = /^\\end\s*\{([^}]*)\}/.exec(rest);
  if (end) {
    return { length: end[0].length, kind: 'end', name: end[1].trim() };
  }
  if (next === undefined) return { length: 1, kind: 'skip' };
  // 其它转义（\$、\{、\\[0.5em] 等）：跳过两个字符即可。
  return { length: 2, kind: 'skip' };
}

function applyLatexToken(state: MathScanState, token: LatexToken): void {
  switch (token.kind) {
    case 'bracket-open':
      if (!state.inSingleDollar && !state.inDoubleDollar && !state.inParenInline) {
        state.inBracketDisplay = true;
      }
      break;
    case 'bracket-close':
      state.inBracketDisplay = false;
      break;
    case 'paren-open':
      if (!state.inSingleDollar && !state.inDoubleDollar && !state.inBracketDisplay) {
        state.inParenInline = true;
      }
      break;
    case 'paren-close':
      state.inParenInline = false;
      break;
    case 'begin':
      if (isMathEnvironment(token.name)) state.envStack.push(token.name);
      break;
    case 'end': {
      if (!isMathEnvironment(token.name)) break;
      let index = state.envStack.lastIndexOf(token.name);
      if (index < 0) {
        // \begin{align} ... \end{align*} 这类星号不匹配时，按去掉星号的名字兜底。
        const base = token.name.replace(/\*$/, '');
        for (let i = state.envStack.length - 1; i >= 0; i -= 1) {
          if (state.envStack[i].replace(/\*$/, '') === base) {
            index = i;
            break;
          }
        }
      }
      if (index >= 0) state.envStack.splice(index, 1);
      break;
    }
    default:
      break;
  }
}

type DollarAction =
  | { length: 1; kind: 'literal' }
  | { length: 1; kind: 'open-inline' }
  | { length: 1; kind: 'close-inline' }
  | { length: 2; kind: 'open-display' }
  | { length: 2; kind: 'close-display' };

/**
 * 判断一个 `$` 该怎么处理，以及要消费几个字符。
 * 只读取 state，不修改；这样才能在改状态之前按精确长度捕获 offset 快照。
 */
function classifyDollar(
  masked: string,
  index: number,
  state: MathScanState,
  relaxedDollar: boolean,
): DollarAction {
  const next = masked[index + 1];
  const prev = index > 0 ? masked[index - 1] : '';

  if (state.inDoubleDollar) {
    return next === '$'
      ? { length: 2, kind: 'close-display' }
      : { length: 1, kind: 'literal' };
  }

  if (state.inSingleDollar) {
    // 行内公式的右 `$` 前面不能是空白（`x$` 合法，`x $` 不闭合）；LaTeX 放宽。
    const closable =
      next !== '$' && (relaxedDollar || (prev !== '' && !/\s/.test(prev)));
    return closable
      ? { length: 1, kind: 'close-inline' }
      : { length: 1, kind: 'literal' };
  }

  // 已经在 \[...\]、\(...\) 或数学环境里：这里的 `$` 当普通字符。
  if (state.inBracketDisplay || state.inParenInline || state.envStack.length > 0) {
    return { length: 1, kind: 'literal' };
  }

  if (next === '$') {
    return { length: 2, kind: 'open-display' };
  }

  // 开头 `$` 后面紧跟空白不是合法公式（LaTeX 除外）；`$` 结尾同理。
  if (!relaxedDollar && (next === undefined || /\s/.test(next))) {
    return { length: 1, kind: 'literal' };
  }

  const closing = findInlineClosing(masked, index, relaxedDollar);
  if (closing < 0) {
    // 没找到闭合：`$x + ` 视为正在写公式；Markdown 里 `$100` 视为金额。
    if (!relaxedDollar && next !== undefined && /[0-9]/.test(next)) {
      return { length: 1, kind: 'literal' };
    }
    return { length: 1, kind: 'open-inline' };
  }

  // 数字开头：跨行或有中文/全角标点的配对，按金额处理。
  if (!relaxedDollar && next !== undefined && /[0-9]/.test(next)) {
    const segment = masked.slice(index, closing);
    if (segment.includes('\n') || CJK_OR_FULLWIDTH.test(segment)) {
      return { length: 1, kind: 'literal' };
    }
  }

  return { length: 1, kind: 'open-inline' };
}

function applyDollar(state: MathScanState, action: DollarAction): void {
  switch (action.kind) {
    case 'open-display':
      state.inDoubleDollar = true;
      break;
    case 'close-display':
      state.inDoubleDollar = false;
      break;
    case 'open-inline':
      state.inSingleDollar = true;
      break;
    case 'close-inline':
      state.inSingleDollar = false;
      break;
    default:
      break;
  }
}

/** 向后找行内公式的闭合 `$`；遇到空行、`$$` 或超过窗口则放弃。 */
function findInlineClosing(
  masked: string,
  start: number,
  relaxedDollar: boolean,
): number {
  const limit = Math.min(masked.length, start + INLINE_LOOKAHEAD);
  for (let i = start + 1; i < limit; i += 1) {
    const char = masked[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      if (startsNewParagraph(masked, i)) return -1;
      continue;
    }
    if (char !== '$') continue;
    if (masked[i + 1] === '$') return -1;
    const prev = masked[i - 1];
    if (prev !== undefined && (relaxedDollar || !/\s/.test(prev))) return i;
  }
  return -1;
}

function startsNewParagraph(text: string, newlineIndex: number): boolean {
  let end = newlineIndex + 1;
  while (end < text.length && text[end] !== '\n') end += 1;
  return text.slice(newlineIndex + 1, end).trim() === '';
}

/**
 * 把「不可能有数学」的区域（注释、代码块等）替换成空格，保留换行和字符偏移。
 */
export function maskNonMath(text: string, languageId: string): string {
  if (languageId === 'markdown' || languageId === 'md') {
    return maskMarkdown(text);
  }
  if (languageId === 'latex' || languageId === 'tex') {
    return maskLatex(text);
  }
  return text;
}

function maskMarkdown(text: string): string {
  // 先处理围栏代码块：围栏里未闭合的 <!-- 不应把后面的正文整个吞掉。
  let result = maskFencedCode(text);
  result = maskInlineCode(result);
  return maskHtmlComments(result);
}

function maskHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, blankOut);
}

function maskFencedCode(text: string): string {
  const lines = text.split('\n');
  let fence: { char: string; length: number } | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        fence = undefined;
      }
      lines[i] = blankOut(line);
      continue;
    }

    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      lines[i] = blankOut(line);
    }
  }

  return lines.join('\n');
}

function maskInlineCode(text: string): string {
  const chars = text.split('');
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }

    let run = 1;
    while (text[i + run] === '`') run += 1;

    let j = i + run;
    let close = -1;
    while (j < text.length) {
      if (text[j] === '`') {
        let length = 1;
        while (text[j + length] === '`') length += 1;
        if (length === run) {
          close = j;
          break;
        }
        j += length;
        continue;
      }
      j += 1;
    }

    if (close < 0) {
      i += run;
      continue;
    }

    for (let k = i; k < close + run; k += 1) {
      if (chars[k] !== '\n') chars[k] = ' ';
    }
    i = close + run;
  }

  return chars.join('');
}

function maskLatex(text: string): string {
  let result = text;

  for (const name of ['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment']) {
    const pattern = new RegExp(
      `\\\\begin\\s*\\{${escapeRegExp(name)}\\}[\\s\\S]*?\\\\end\\s*\\{${escapeRegExp(name)}\\}`,
      'g',
    );
    result = result.replace(pattern, blankOut);
  }

  // 先掩 \verb|...|：里面的 % 不是注释，不能让它把同行后面的公式吞掉。
  result = result.replace(/\\verb\*?([^a-zA-Z0-9\s])[^\n]*?\1/g, blankOut);

  const chars = result.split('');
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== '%' || isEscaped(chars, i)) continue;
    let j = i;
    while (j < chars.length && chars[j] !== '\n') {
      chars[j] = ' ';
      j += 1;
    }
    i = j;
  }
  return chars.join('');
}

function blankOut(value: string): string {
  return value.replace(/[^\n]/g, ' ');
}

function isEscaped(chars: string[], index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && chars[i] === '\\'; i -= 1) count += 1;
  return count % 2 === 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
