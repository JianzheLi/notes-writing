import { ChatMessage, CodeContext, MathContext } from './types';

const SYSTEM_PROMPT = `你是数学公式写作助手。根据用户给出的文档上下文和文字描述，写出应插入光标处的 LaTeX 公式。

规则：
1. 只输出公式本身：不要解释、不要 markdown 代码块、不要多余句子。
2. 行内公式用 $...$；行间公式用 $$...$$（或沿用上下文中已有的公式环境，如 equation/align）。
3. 沿用上下文中的符号、记号习惯和宏定义（\\newcommand）。
4. 如果光标处已有公式片段，只补全剩余部分，不要重复已有内容。
5. 只输出一个最合理的公式，不要给多个选项。
6. 如果是替换用户选中的文字：选中的文字只是"描述"，不是最终内容；直接给出用来替换它的完整公式，不要复述描述。`;

function styleHint(math: MathContext, replacesSelection: boolean): string {
  if (replacesSelection) {
    if (math.mode === 'display') {
      return '根据选中的描述写一个行间公式（用 $$...$$ 包裹），用来替换选中的文字。';
    }
    return '根据选中的描述写一个行内公式（用 $...$ 包裹），用来替换选中的文字。';
  }

  switch (math.mode) {
    case 'auto':
      return '根据描述在上下文中的位置自动决定：公式是句子的一部分（前后还有文字）→ 行内公式 $...$；描述已经独立成句/单独成段 → 行间公式 $$...$$。只输出要插入的完整片段（含定界符），不要解释。';
    case 'inline':
      return '写一个行内公式，用 $...$ 包裹，插入在光标处。';
    case 'display':
      return '写一个行间公式，用 $$...$$ 包裹，插入在光标处。';
    case 'continue-inline':
      return '光标位于行内公式内部：只输出公式剩余部分，不要重复已有内容，不要输出 $。';
    case 'continue-display':
      return '光标位于行间公式或数学环境内部：只输出环境内剩余内容，不要重复已有内容，不要输出 $$ 或 \\begin/\\end 标记。';
    default:
      return '写一个公式。';
  }
}

export function buildMessages(params: {
  fileName: string;
  languageId: string;
  context: CodeContext;
  math: MathContext;
}): ChatMessage[] {
  const { context, math } = params;
  const replacesSelection = context.selection !== undefined;

  const selectionBlock = replacesSelection
    ? `用户选中的文字（这是描述，生成后会用公式替换它）：
${context.selection}

`
    : '';

  const user = `文件：${params.fileName}（${params.languageId}）
当前小节：${context.section || '（未识别）'}

${selectionBlock}光标前文：
${context.prefix}

【光标位置】

光标后文：
${context.suffix}

要求：${styleHint(math, replacesSelection)}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}
