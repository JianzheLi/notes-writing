import { FormulaMode } from './types';

/** 去掉模型偶尔输出的 markdown 围栏。 */
function stripFences(text: string): string {
  const fence = /^\s*```[a-zA-Z0-9_+-]*\s*\n([\s\S]*?)\n```\s*$/;
  const match = fence.exec(text);
  if (match) return match[1];
  return text;
}

function stripDelimiters(text: string, display: boolean): string {
  if (display) {
    return text
      .replace(/^\s*\$\$\s*/, '')
      .replace(/\s*\$\$\s*$/, '')
      .trim();
  }
  return text
    .replace(/^\s*\$\s*/, '')
    .replace(/\s*\$\s*$/, '')
    .trim();
}

function isEnvironmentBlock(text: string): boolean {
  return /^\\begin\{[^}]+\}/.test(text) && /\\end\{[^}]+\}\s*$/.test(text);
}

/**
 * 把模型返回的文本整理成「插入到光标处」的 ghost text。
 * - inline：$...$
 * - display：独占一段的 $$...$$
 * - continue-*：光标已在公式/环境内，只返回内容本身
 */
export function buildSuggestion(
  raw: string,
  mode: FormulaMode,
  lineBefore: string,
): string {
  let text = raw.replace(/\r\n/g, '\n');
  text = stripFences(text).trim();
  if (!text) return '';

  const display = mode === 'display' || mode === 'continue-display';

  if (mode === 'inline' || mode === 'display') {
    text = stripDelimiters(text, display);
    if (!text) return '';

    if (display) {
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
