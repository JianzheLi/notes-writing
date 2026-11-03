import * as vscode from 'vscode';
import { FormulaStyle, MathContext } from './types';

/** 扫描窗口：光标前最多回看这么多行，用来判断是否在数学环境里。 */
const LOOKBACK_LINES = 400;

interface ScanState {
  inSingleDollar: boolean;
  inDoubleDollar: boolean;
  inBracketDisplay: boolean;
  envStack: string[];
}

/** 扫描文本里的数学定界符状态（忽略转义字符）。 */
function scanMathState(text: string): ScanState {
  const state: ScanState = {
    inSingleDollar: false,
    inDoubleDollar: false,
    inBracketDisplay: false,
    envStack: [],
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '\\') {
      const next = text[i + 1];
      if (next === '[') {
        state.inBracketDisplay = true;
        i += 1;
        continue;
      }
      if (next === ']') {
        state.inBracketDisplay = false;
        i += 1;
        continue;
      }
      const rest = text.slice(i);
      const begin = /^\\begin\{([^}]*)\}/.exec(rest);
      if (begin) {
        state.envStack.push(begin[1]);
        i += begin[0].length - 1;
        continue;
      }
      const end = /^\\end\{([^}]*)\}/.exec(rest);
      if (end) {
        const index = state.envStack.lastIndexOf(end[1]);
        if (index >= 0) state.envStack.splice(index, 1);
        i += end[0].length - 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (char === '$') {
      if (text[i + 1] === '$') {
        state.inDoubleDollar = !state.inDoubleDollar;
        i += 1;
        continue;
      }
      if (!state.inDoubleDollar) {
        state.inSingleDollar = !state.inSingleDollar;
      }
    }
  }

  return state;
}

/**
 * 判断光标处的公式场景：
 * - 在数学环境/$$/\[ 内 → 继续补全（行间）
 * - 在 $...$ 内 → 继续补全（行内）
 * - 否则按设置或行内/行间启发式决定生成样式
 */
export function detectMathContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  style: FormulaStyle,
): MathContext {
  const startLine = Math.max(0, position.line - LOOKBACK_LINES);
  const textBefore = document.getText(
    new vscode.Range(new vscode.Position(startLine, 0), position),
  );
  const state = scanMathState(textBefore);

  if (state.envStack.length > 0) {
    return {
      mode: 'continue-display',
      insideMath: true,
      reason: `inside environment ${state.envStack[state.envStack.length - 1]}`,
    };
  }

  if (state.inDoubleDollar || state.inBracketDisplay) {
    return {
      mode: 'continue-display',
      insideMath: true,
      reason: 'inside $$ or \\[...\\]',
    };
  }

  if (state.inSingleDollar) {
    return {
      mode: 'continue-inline',
      insideMath: true,
      reason: 'inside $...$',
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
