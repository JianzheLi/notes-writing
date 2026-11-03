import * as vscode from 'vscode';
import { CodeContext } from './types';

/** 代码/文本字符数 ÷ token 的粗略换算比例。 */
const CHARS_PER_TOKEN = 3.5;
/** 前缀占预算比例，剩下的留给光标后文。 */
const PREFIX_RATIO = 0.9;

/**
 * 采集光标前文、光标后文、当前小节，并按 token 预算裁剪。
 * 裁剪时尽量对齐到行边界，避免把半行代码/公式切给模型。
 */
export function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextTokens: number,
): CodeContext {
  const charBudget = Math.max(1000, Math.round(contextTokens * CHARS_PER_TOKEN));
  const prefixBudget = Math.floor(charBudget * PREFIX_RATIO);
  const suffixBudget = charBudget - prefixBudget;

  const documentStart = new vscode.Position(0, 0);
  const fullPrefix = document.getText(new vscode.Range(documentStart, position));
  let prefix = fullPrefix;
  if (prefix.length > prefixBudget) {
    prefix = prefix.slice(prefix.length - prefixBudget);
    const firstNewline = prefix.indexOf('\n');
    if (firstNewline >= 0) prefix = prefix.slice(firstNewline + 1);
  }

  const documentEnd = document.lineAt(document.lineCount - 1).range.end;
  const fullSuffix = document.getText(new vscode.Range(position, documentEnd));
  let suffix = fullSuffix;
  if (suffix.length > suffixBudget) {
    suffix = suffix.slice(0, suffixBudget);
    const lastNewline = suffix.lastIndexOf('\n');
    if (lastNewline >= 0) suffix = suffix.slice(0, lastNewline);
  }

  const lineBefore = document
    .lineAt(position.line)
    .text.slice(0, position.character);

  return {
    prefix,
    suffix,
    section: findSection(prefix, document.languageId),
    lineBefore,
  };
}

function findSection(prefix: string, languageId: string): string {
  const lines = prefix.split('\n').reverse();
  const markdown = languageId === 'markdown' || languageId === 'md';
  const latex = languageId === 'latex' || languageId === 'tex';

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    if (markdown && /^#{1,6}\s+\S/.test(text)) return text;
    if (latex && /^\\(section|subsection|subsubsection|chapter|paragraph)\*?\{/.test(text)) {
      return text;
    }
  }
  return '';
}

/**
 * 判断文件是否命中排除 glob。
 * 只实现 `/` 分隔的相对路径匹配：`**` → 任意层、`*` → 不含 `/` 的任意串、`?` → 单字符。
 */
export function isExcluded(uri: vscode.Uri, globs: string[]): boolean {
  if (globs.length === 0) return false;
  const relativePath = vscode.workspace
    .asRelativePath(uri, false)
    .replace(/\\/g, '/');
  return globs.some((glob) => globToRegExp(glob).test(relativePath));
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}
