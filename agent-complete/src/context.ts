import * as vscode from 'vscode';

export interface CodeContext {
  prefix: string;
  suffix: string;
}

/** 代码字符数 ÷ token 的粗略换算比例（用于把 contextTokens 预算换成字符预算）。 */
const CHARS_PER_TOKEN = 3.5;

/**
 * 采集"光标前 + 光标后"的代码上下文，按 token 预算裁剪。
 * 前 85% 给前缀，后 15% 给后缀；裁剪时尽量对齐到行边界。
 */
export function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  contextTokens: number,
): CodeContext {
  const charBudget = Math.max(1000, Math.round(contextTokens * CHARS_PER_TOKEN));
  const prefixBudget = Math.floor(charBudget * 0.85);
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

  return { prefix, suffix };
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
