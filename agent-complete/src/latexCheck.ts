import { FormulaMode } from './types';

export type LatexIssueCode =
  | 'delimiter'
  | 'dollar'
  | 'brace'
  | 'left-right'
  | 'environment'
  | 'truncated';

export interface LatexIssue {
  code: LatexIssueCode;
  message: string;
}

export interface LatexCheckResult {
  ok: boolean;
  issues: LatexIssue[];
}

/**
 * 对最终要插入的文本做「简单语法检查」。
 * 只拦明显坏掉的公式，不做完整 LaTeX 校验（完整校验交给 LaTeX Workshop）。
 *
 * - inline：必须是一对 $...$，内容里不能有未转义的 $
 * - display：一对 $$...$$ 或一个 \begin{...}...\end{...} 环境块
 * - continue-*：只有内容，不能出现未转义的 $
 * - auto：按最终文本的定界符判断
 * 另外检查 {} 平衡、\left/\right 数量、\begin/\end 配对。
 */
export function checkLatexSuggestion(
  text: string,
  mode: FormulaMode,
): LatexCheckResult {
  const issues: LatexIssue[] = [];
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { ok: false, issues: [{ code: 'delimiter', message: '输出为空' }] };
  }

  const extracted = extractContent(normalized, mode, issues);
  if (!extracted) return { ok: false, issues };

  checkUnescapedDollar(extracted.content, issues);
  checkBraces(extracted.content, issues);
  checkLeftRight(extracted.content, issues);
  checkEnvironments(extracted.content, issues);

  return { ok: issues.length === 0, issues };
}

interface Extracted {
  content: string;
  kind: 'inline' | 'display' | 'environment' | 'content';
}

function extractContent(
  text: string,
  mode: FormulaMode,
  issues: LatexIssue[],
): Extracted | undefined {
  if (mode === 'continue-inline' || mode === 'continue-display') {
    return { content: text, kind: 'content' };
  }

  let effective = mode;
  if (effective === 'auto') {
    if (text.startsWith('$$')) effective = 'display';
    else if (text.startsWith('\\begin{')) effective = 'display';
    else if (text.startsWith('$')) effective = 'inline';
    else return { content: text, kind: 'content' };
  }

  if (effective === 'display') {
    if (isEnvironmentBlock(text)) {
      return { content: text, kind: 'environment' };
    }
    if (text.startsWith('$$') && text.endsWith('$$') && text.length >= 4) {
      return { content: text.slice(2, -2), kind: 'display' };
    }
    issues.push({
      code: 'delimiter',
      message: '行间公式没有被一对 `$$...$$` 包裹',
    });
    return { content: stripDollarRuns(text), kind: 'display' };
  }

  if (
    text.startsWith('$') &&
    text.endsWith('$') &&
    text.length >= 2 &&
    !text.startsWith('$$') &&
    !text.endsWith('$$')
  ) {
    return { content: text.slice(1, -1), kind: 'inline' };
  }
  issues.push({
    code: 'delimiter',
    message: '行内公式没有被一对 `$...$` 包裹',
  });
  return { content: stripDollarRuns(text), kind: 'inline' };
}

function stripDollarRuns(text: string): string {
  return text.replace(/^\$+/, '').replace(/\$+$/, '').trim();
}

function isEnvironmentBlock(text: string): boolean {
  return /^\\begin\{[^}]+\}[\s\S]*\\end\{[^}]+\}$/.test(text);
}

function checkUnescapedDollar(content: string, issues: LatexIssue[]): void {
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '$') {
      issues.push({
        code: 'dollar',
        message: '公式内容里出现了未转义的 `$`（定界符可能重复或没配对）',
      });
      return;
    }
  }
}

function checkBraces(content: string, issues: LatexIssue[]): void {
  let depth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) {
        issues.push({
          code: 'brace',
          message: '大括号不平衡：`}` 比 `{` 多',
        });
        return;
      }
    }
  }
  if (depth > 0) {
    issues.push({
      code: 'brace',
      message: `大括号不平衡：还差 ${depth} 个 \`}\``,
    });
  }
}

function checkLeftRight(content: string, issues: LatexIssue[]): void {
  let left = 0;
  let right = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== '\\' || isEscaped(content, i)) continue;
    if (
      content.startsWith('left', i + 1) &&
      !isAsciiLetter(content[i + 5])
    ) {
      left += 1;
      i += 4;
      continue;
    }
    if (
      content.startsWith('right', i + 1) &&
      !isAsciiLetter(content[i + 6])
    ) {
      right += 1;
      i += 5;
    }
  }
  if (left !== right) {
    issues.push({
      code: 'left-right',
      message: `\`\\left\` 与 \`\\right\` 数量不等（left ${left} / right ${right}）`,
    });
  }
}

function checkEnvironments(content: string, issues: LatexIssue[]): void {
  const stack: string[] = [];

  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== '\\' || isEscaped(content, i)) continue;

    const begin = /^begin\s*\{([^}]*)\}/.exec(content.slice(i + 1));
    if (begin) {
      stack.push(begin[1].trim());
      i += begin[0].length;
      continue;
    }

    const end = /^end\s*\{([^}]*)\}/.exec(content.slice(i + 1));
    if (end) {
      const name = end[1].trim();
      const index = stack.lastIndexOf(name);
      if (index < 0) {
        issues.push({
          code: 'environment',
          message: `\`\\end{${name}}\` 没有对应的 \`\\begin\``,
        });
      } else {
        stack.splice(index, 1);
      }
      i += end[0].length;
    }
  }

  for (const name of stack) {
    issues.push({
      code: 'environment',
      message: `环境 \`${name}\` 没有对应的 \`\\end{${name}}\``,
    });
  }
}

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z]/.test(char);
}
