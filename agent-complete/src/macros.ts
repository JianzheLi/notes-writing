import { maskNonMath } from './mathScan';

const MACRO_START =
  /^\s*\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|def|newenvironment)\b/;
const MAX_BLOCK_LINES = 20;

/**
 * 从全文里提取 LaTeX 宏定义，按出现顺序去重、按字符预算截断。
 * 只处理以命令开头的行（常见写法），支持跨行的大括号体。
 */
export function extractMacros(
  text: string,
  languageId: string,
  maxChars: number,
): string {
  if (maxChars <= 0) return '';

  const masked = maskNonMath(text, languageId);
  const lines = masked.split('\n');
  const blocks: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (!MACRO_START.test(lines[i])) continue;

    let block = lines[i];
    let depth = braceDelta(lines[i]);
    let last = i;
    while (
      depth > 0 &&
      last + 1 < lines.length &&
      last - i < MAX_BLOCK_LINES - 1
    ) {
      last += 1;
      block += `\n${lines[last]}`;
      depth += braceDelta(lines[last]);
    }
    i = last;

    const trimmed = block.trimEnd();
    if (!trimmed) continue;

    const key = macroKey(trimmed);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    if (used + trimmed.length + 1 > maxChars) break;
    blocks.push(trimmed);
    used += trimmed.length + 1;
  }

  return blocks.join('\n');
}

function braceDelta(line: string): number {
  let delta = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '{') delta += 1;
    else if (char === '}') delta -= 1;
  }
  return delta;
}

function macroKey(block: string): string {
  const match =
    /\\[A-Za-z]+\*?\s*\{?\\([A-Za-z@]+)|\\newenvironment\s*\{([^}]+)\}/.exec(
      block,
    );
  if (!match) return block.slice(0, 80);
  return (match[1] ?? match[2] ?? '').trim();
}
