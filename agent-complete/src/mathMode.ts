import * as vscode from 'vscode';
import { mathStateAt } from './mathScan';
import { FormulaStyle, MathContext } from './types';

/** 扫描窗口：光标前最多回看这么多行，用来判断是否在数学环境里。 */
const LOOKBACK_LINES = 400;
/** 光标后最多看这么多行，用来找行内公式的闭合 `$`。 */
const LOOKAHEAD_LINES = 200;

/**
 * 判断光标处的公式场景：
 * - 在数学环境 / `$$` / `\[` 内 → 继续补全（行间）
 * - 在 `$...$` / `\(...\)` 内 → 继续补全（行内）
 * - 否则按设置或行内/行间启发式决定生成样式
 */
export function detectMathContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  style: FormulaStyle,
): MathContext {
  const startLine = Math.max(0, position.line - LOOKBACK_LINES);
  const endLine = Math.min(document.lineCount - 1, position.line + LOOKAHEAD_LINES);
  const start = new vscode.Position(startLine, 0);
  const end = document.lineAt(endLine).range.end;
  const text = document.getText(new vscode.Range(start, end));
  const offset = document.offsetAt(position) - document.offsetAt(start);
  const state = mathStateAt(text, offset, document.languageId);

  if (state.envStack.length > 0) {
    const environment = state.envStack[state.envStack.length - 1];
    return {
      mode: 'continue-display',
      insideMath: true,
      reason: `inside environment ${environment}`,
      environment,
    };
  }

  if (state.inDoubleDollar || state.inBracketDisplay) {
    return {
      mode: 'continue-display',
      insideMath: true,
      reason: state.inDoubleDollar ? 'inside $$...$$' : 'inside \\[...\\]',
    };
  }

  if (state.inSingleDollar || state.inParenInline) {
    return {
      mode: 'continue-inline',
      insideMath: true,
      reason: state.inSingleDollar ? 'inside $...$' : 'inside \\(...\\)',
    };
  }

  if (style === 'inline') {
    return { mode: 'inline', insideMath: false, reason: 'forced inline' };
  }
  if (style === 'display') {
    return { mode: 'display', insideMath: false, reason: 'forced display' };
  }

  const line = document.lineAt(position.line).text;
  const restOfLine = line.slice(position.character);
  const atLineEnd = restOfLine.trim().length === 0;
  return atLineEnd
    ? { mode: 'display', insideMath: false, reason: 'line end -> display' }
    : { mode: 'inline', insideMath: false, reason: 'mid line -> inline' };
}

/**
 * 选区的公式样式：
 * - 设置里强制 inline/display 时直接沿用
 * - auto：整行选区（前后只有空白）→ 行间；否则（句中短语）→ 行内
 * - 多行选区 → 行间
 */
export function selectionStyle(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  style: FormulaStyle,
): 'inline' | 'display' {
  if (style === 'inline' || style === 'display') return style;
  if (selection.start.line !== selection.end.line) return 'display';

  const line = document.lineAt(selection.start.line).text;
  const before = line.slice(0, selection.start.character).trim();
  const after = line.slice(selection.end.character).trim();
  return before.length === 0 && after.length === 0 ? 'display' : 'inline';
}
