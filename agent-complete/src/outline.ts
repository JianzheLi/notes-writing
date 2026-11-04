import { maskNonMath } from './mathScan';

export interface SectionInfo {
  /** 当前小节路径，例如 `3. 采样 > 3.2 得分匹配`。 */
  path: string;
  /** 当前小节标题。 */
  heading: string;
  /** 标题所在行（0-based）。 */
  line: number;
}

interface OutlineEntry {
  level: number;
  title: string;
  line: number;
}

const LATEX_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/**
 * 返回光标所在的小节路径。
 * Markdown 用 ATX 标题层级；LaTeX 用 \part/\chapter/\section/...
 * 会先屏蔽代码块、注释、行内代码，避免把里面的“标题”算进去。
 */
export function findSection(
  text: string,
  offset: number,
  languageId: string,
): SectionInfo {
  const masked = maskNonMath(text, languageId);
  const lines = masked.split('\n');
  const clamped = Math.max(0, Math.min(offset, text.length));
  const lineIndex = Math.min(
    lines.length - 1,
    text.slice(0, clamped).split('\n').length - 1,
  );

  const markdown = languageId === 'markdown' || languageId === 'md';
  const latex = languageId === 'latex' || languageId === 'tex';
  if (!markdown && !latex) {
    return { path: '', heading: '', line: 0 };
  }

  const entries: OutlineEntry[] = [];
  for (let i = 0; i <= lineIndex; i += 1) {
    const line = lines[i];
    if (markdown) {
      const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) {
        entries.push({
          level: match[1].length,
          title: match[2].trim(),
          line: i,
        });
      }
    } else {
      const match =
        /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{([^}]*)\}/.exec(
          line,
        );
      if (match) {
        entries.push({
          level: LATEX_LEVELS[match[1]] ?? 2,
          title: match[2].trim(),
          line: i,
        });
      }
    }
  }

  if (entries.length === 0) {
    return { path: '', heading: '', line: 0 };
  }

  const stack: OutlineEntry[] = [];
  for (const entry of entries) {
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    stack.push(entry);
  }

  return {
    path: stack.map((entry) => entry.title).join(' > '),
    heading: entries[entries.length - 1].title,
    line: entries[entries.length - 1].line,
  };
}
