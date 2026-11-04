import * as vscode from 'vscode';
import { extractMacros } from './macros';
import { findSection } from './outline';
import { CodeContext } from './types';

/** 代码/文本字符数 ÷ token 的粗略换算比例。 */
const CHARS_PER_TOKEN = 3.5;
/** 前文占剩余预算的比例（后文少一些，写作通常是顺序进行的）。 */
const PREFIX_RATIO = 0.9;
/** 宏定义/符号最多占预算的比例。 */
const MACRO_RATIO = 0.15;
/** 选区描述最多占预算的比例。 */
const SELECTION_RATIO = 0.5;

/**
 * 采集光标前文、光标后文、当前小节、宏定义，并按预算裁剪。
 *
 * - 短文档：整个文件都能放下时，直接发完整 prefix/suffix（保持旧行为）。
 * - 长文档：只发“宏定义 + 当前小节 + 靠近光标的 prefix + suffix”，
 *   中间省略的部分用标记代替；这样不会因为从左边硬截断而丢掉宏定义/小节。
 * - 有选区时：选区文字单独作为“描述”，prefix 截到选区开头、suffix 从选区末尾开始。
 */
export function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextTokens: number,
  selection?: vscode.Selection,
): CodeContext {
  const hasSelection = selection !== undefined && !selection.isEmpty;
  const charBudget = Math.max(1000, Math.round(contextTokens * CHARS_PER_TOKEN));

  const prefixEnd = hasSelection ? selection.start : position;
  const suffixStart = hasSelection ? selection.end : position;
  const documentStart = new vscode.Position(0, 0);
  const documentEnd = document.lineAt(document.lineCount - 1).range.end;
  const fullPrefix = document.getText(new vscode.Range(documentStart, prefixEnd));
  const fullSuffix = document.getText(new vscode.Range(suffixStart, documentEnd));
  const fullText = document.getText();

  let selectionText: string | undefined;
  let remaining = charBudget;
  if (hasSelection) {
    const rawSelection = document.getText(selection);
    selectionText = truncateEnd(
      rawSelection,
      Math.floor(charBudget * SELECTION_RATIO),
    );
    remaining = Math.max(0, remaining - selectionText.length);
  }

  const macroBudget = Math.max(
    0,
    Math.min(Math.floor(charBudget * MACRO_RATIO), remaining),
  );
  let macros = extractMacros(fullText, document.languageId, macroBudget);
  remaining = Math.max(0, remaining - macros.length);

  let prefix = fullPrefix;
  let suffix = fullSuffix;
  let omittedPrefix = false;
  let omittedSuffix = false;

  const fullContextLength =
    fullPrefix.length + fullSuffix.length + (selectionText?.length ?? 0);
  if (fullContextLength > charBudget) {
    const prefixBudget = Math.floor(remaining * PREFIX_RATIO);
    const suffixBudget = Math.max(0, remaining - prefixBudget);

    if (prefix.length > prefixBudget) {
      prefix = prefix.slice(prefix.length - prefixBudget);
      const firstNewline = prefix.indexOf('\n');
      if (firstNewline >= 0) prefix = prefix.slice(firstNewline + 1);
      prefix = dropLeadingLowSurrogate(prefix);
      omittedPrefix = true;
    }

    if (suffix.length > suffixBudget) {
      suffix = truncateEnd(suffix, suffixBudget);
      const lastNewline = suffix.lastIndexOf('\n');
      if (lastNewline >= 0) suffix = suffix.slice(0, lastNewline);
      suffix = dropTrailingHighSurrogate(suffix);
      omittedSuffix = true;
    }

    if (omittedPrefix) prefix = `……（前面内容已省略）……\n${prefix}`;
    if (omittedSuffix) suffix = `${suffix}\n……（后面内容已省略）……`;
  } else {
    // 全文都放得下，prefix 里已经包含宏定义，不重复发。
    macros = '';
  }

  const lineBefore = document
    .lineAt(prefixEnd.line)
    .text.slice(0, prefixEnd.character);
  const section = findSection(
    fullText,
    document.offsetAt(prefixEnd),
    document.languageId,
  ).path;

  return {
    prefix,
    suffix,
    section,
    macros,
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

/**
 * 判断文件是否命中排除 glob。
 * 只实现 `/` 分隔的相对路径匹配：`**` → 任意层、`*` → 不含 `/` 的任意串、`?` → 单字符。
 */
export function isExcluded(uri: vscode.Uri, globs: string[]): boolean {
  return matchesExcludePath(
    vscode.workspace.asRelativePath(uri, false),
    globs,
  );
}

/** 纯函数版本，方便单测。 */
export function matchesExcludePath(
  relativePath: string,
  globs: string[],
): boolean {
  if (globs.length === 0) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  return globs.some((glob) => globToRegExp(glob).test(normalized));
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
