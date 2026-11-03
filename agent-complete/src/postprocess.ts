import { FormulaMode } from './types';

export interface SuggestionOptions {
  /** 结果用于替换选区：不加前导空行，尾随换行按选区原有的换行数补齐。 */
  replace?: boolean;
  /** replace 模式下，选区末尾原本有几个换行（0/1/2…），用于保持段落间距。 */
  trailingNewlines?: number;
}

/** 去掉模型偶尔输出的 markdown 围栏。 */
function stripFences(text: string): string {
  const multiline =
    /^\s*```[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```\s*$/.exec(text);
  if (multiline) return multiline[1];

  const inline = /^\s*```[a-zA-Z0-9_+-]*[ \t]+([\s\S]*?)[ \t]*```\s*$/.exec(text);
  if (inline) return inline[1];

  // 模型输出被截断时可能只有开围栏（或只有闭围栏），单独剥掉。
  let value = text;
  const opening = /^\s*```[a-zA-Z0-9_+-]*[ \t]*\r?\n/.exec(value);
  if (opening) value = value.slice(opening[0].length);
  value = value.replace(/\r?\n?[ \t]*```\s*$/, '');
  return value;
}

/**
 * 去掉公式两端已有的定界符（行内/行间都兼容常见写法）。
 * 用 (?<!\\) 避免把 \$ 这类转义误当成定界符。
 */
function stripDelimiters(text: string, _display: boolean): string {
  const value = text
    .trim()
    .replace(/^(?:\$\$|(?<!\\)\$|\\\[|\\\()[ \t]*/, '');
  return stripTrailingDelimiters(value).trim();
}

/**
 * 处理结尾定界符。特别处理「内容本身以 \$ 结尾」的情况：
 * 例如 `$x = \$$` 只应剥掉最后的闭合 `$`，不能把 `\$` 的 `$` 一起剥掉。
 */
function stripTrailingDelimiters(value: string): string {
  const text = value.replace(/[ \t]+$/, '');
  if (text.endsWith('\\]') || text.endsWith('\\)')) {
    return text.slice(0, -2);
  }
  if (!text.endsWith('$')) return text;

  let dollars = 0;
  while (dollars < text.length && text[text.length - 1 - dollars] === '$') {
    dollars += 1;
  }
  const before = text.slice(0, text.length - dollars);
  const escaped = hasOddTrailingBackslashes(before);

  // 第一个尾随 $ 前面是奇数个反斜杠：它是内容里的 \$，只剥最后 1 个。
  if (escaped) return text.slice(0, -1).trimEnd();
  return text.slice(0, -(Math.min(dollars, 2))).trimEnd();
}

function hasOddTrailingBackslashes(text: string): boolean {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function isEnvironmentBlock(text: string): boolean {
  return /^\\begin\{[^}]+\}/.test(text) && /\\end\{[^}]+\}\s*$/.test(text);
}

/**
 * 把模型返回的文本整理成要插入/替换的文本。
 * - inline：$...$
 * - display：独占一段的 $$...$$
 * - continue-*：光标已在公式/环境内，只返回内容本身
 * - replace：替换选区，不额外加前导空行
 */
export function buildSuggestion(
  raw: string,
  mode: FormulaMode,
  lineBefore: string,
  options: SuggestionOptions = {},
): string {
  let text = raw.replace(/\r\n/g, '\n');
  text = stripFences(text).trim();
  if (!text) return '';

  const display = mode === 'display' || mode === 'continue-display';
  const replace = options.replace === true;
  const trailingNewlines = Math.max(0, Math.floor(options.trailingNewlines ?? 0));

  if (mode === 'inline' || mode === 'display') {
    text = stripDelimiters(text, display);
    if (!text) return '';

    if (display) {
      if (replace) {
        const block = isEnvironmentBlock(text) ? text : `$$\n${text}\n$$`;
        return `${block}${'\n'.repeat(trailingNewlines)}`;
      }
      const lead = lineBefore.trim().length > 0 ? '\n\n' : '';
      if (isEnvironmentBlock(text)) {
        return `${lead}${text}\n`;
      }
      return `${lead}$$\n${text}\n$$\n`;
    }

    return `$${text}$`;
  }

  // continue-inline / continue-display：不要重复定界符
  return stripDelimiters(text, display);
}
