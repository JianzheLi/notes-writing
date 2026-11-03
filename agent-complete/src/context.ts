import * as vscode from 'vscode';
import { CodeContext } from './types';

/** 代码/文本字符数 ÷ token 的粗略换算比例。 */
const CHARS_PER_TOKEN = 3.5;
/** 前缀占预算比例，剩下的留给光标后文。 */
const PREFIX_RATIO = 0.9;

/**
 * 采集光标前文、光标后文、当前小节，并按 token 预算裁剪。
 * 裁剪时尽量对齐到行边界，避免把半行代码/公式切给模型。
 *
 * 有选区时：选区文字单独作为「描述」返回，前文截到选区开头、后文从选区末尾开始，
 * 这样模型既能看到描述，也能看到描述前后的上下文，而且不会把选区重复两遍。
 */
export function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextTokens: number,
  selection?: vscode.Selection,
): CodeContext {
  const hasSelection = selection !== undefined && !selection.isEmpty;
  const charBudget = Math.max(1000, Math.round(contextTokens * CHARS_PER_TOKEN));

  let selectionText: string | undefined;
  let prefixBudget = Math.floor(charBudget * PREFIX_RATIO);
  let suffixBudget = charBudget - prefixBudget;

  if (hasSelection) {
    const rawSelection = document.getText(selection);
    const selectionBudget = Math.floor(charBudget * 0.5);
    selectionText = truncateEnd(rawSelection, selectionBudget);
    const remaining = Math.max(0, charBudget - selectionText.length);
    prefixBudget = Math.floor(remaining * PREFIX_RATIO);
    suffixBudget = remaining - prefixBudget;
  }

  const prefixEnd = hasSelection ? selection.start : position;
  const suffixStart = hasSelection ? selection.end : position;

  const documentStart = new vscode.Position(0, 0);
  const fullPrefix = document.getText(new vscode.Range(documentStart, prefixEnd));
  let prefix = fullPrefix;
  if (prefix.length > prefixBudget) {
    prefix = prefix.slice(prefix.length - prefixBudget);
    const firstNewline = prefix.indexOf('\n');
    if (firstNewline >= 0) prefix = prefix.slice(firstNewline + 1);
    prefix = dropLeadingLowSurrogate(prefix);
  }

  const documentEnd = document.lineAt(document.lineCount - 1).range.end;
  const fullSuffix = document.getText(new vscode.Range(suffixStart, documentEnd));
  let suffix = fullSuffix;
  if (suffix.length > suffixBudget) {
    suffix = truncateEnd(suffix, suffixBudget);
    const lastNewline = suffix.lastIndexOf('\n');
    if (lastNewline >= 0) suffix = suffix.slice(0, lastNewline);
    suffix = dropTrailingHighSurrogate(suffix);
  }

  const lineBefore = document
    .lineAt(prefixEnd.line)
    .text.slice(0, prefixEnd.character);

  return {
    prefix,
    suffix,
    section: findSection(prefix, document.languageId),
    lineBefore,
    selection: selectionText,
  };
}

/** 按字符预算截断，避免从 UTF-16 代理对（emoji 等）中间切开。 */
function truncateEnd(text: string, budget: number): string {
  if (text.length <= budget) return text;
  let end = Math.max(0, budget);
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

function dropLeadingLowSurrogate(text: string): string {
  return text.length > 0 && isLowSurrogate(text.charCodeAt(0)) ? text.slice(1) : text;
}

function dropTrailingHighSurrogate(text: string): string {
  return text.length > 0 && isHighSurrogate(text.charCodeAt(text.length - 1))
    ? text.slice(0, -1)
    : text;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
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
