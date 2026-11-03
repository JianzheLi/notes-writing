#!/usr/bin/env node
/**
 * 冒烟测试：用真实 DeepSeek Chat Completions 验证「文字描述 → LaTeX 公式」链路。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/smoke.mjs            # 默认 max 思考
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/smoke.mjs none       # 非思考（快）
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/smoke.mjs max deepseek-v4-pro
 *
 * 不读取任何本地密钥文件，只从环境变量取 key；不会把 key 打印出来。
 */

const effort = process.argv[2] ?? 'max';
const model = process.argv[3] ?? 'deepseek-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');

if (!API_KEY) {
  console.error('缺少 DEEPSEEK_API_KEY 环境变量');
  process.exit(1);
}

const SYSTEM_PROMPT = `你是数学公式写作助手。根据用户给出的文档上下文和文字描述，写出应插入光标处的 LaTeX 公式。

规则：
1. 只输出公式本身：不要解释、不要 markdown 代码块、不要多余句子。
2. 行内公式用 $...$；行间公式用 $$...$$（或沿用上下文中已有的公式环境，如 equation/align）。
3. 沿用上下文中的符号、记号习惯和宏定义（\\newcommand）。
4. 如果光标处已有公式片段，只补全剩余部分，不要重复已有内容。
5. 只输出一个最合理的公式，不要给多个选项。`;

const documentPrefix = `# 连续扩散语言模型阅读笔记

## 3. 采样与得分匹配

设前向过程为
$$
q(x_t \\mid x_0) = \\mathcal{N}(x_t; \\sqrt{\\bar{\\alpha}_t} x_0, (1 - \\bar{\\alpha}_t) I),
$$
其中 $\\bar{\\alpha}_t = \\prod_{s=1}^t \\alpha_s$，$\\alpha_s = 1 - \\beta_s$。

在连续时间极限下，样本方差的非偏估计为
`;

const cursorSuffix = `

其中 $n$ 是样本数，$X_i$ 是第 $i$ 个样本。
`;

const user = `文件：连续dllm/notes.md（markdown）
当前小节：## 3. 采样与得分匹配

光标前文：
${documentPrefix}

【光标位置】

光标后文：
${cursorSuffix}

要求：写一个行间公式，用 $$...$$ 包裹，插入在光标处。`;

const body = {
  model,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ],
  max_tokens: Number(process.env.SMOKE_MAX_TOKENS ?? 8192),
  stream: false,
  ...(effort === 'none'
    ? { thinking: { type: 'disabled' }, temperature: 0.2 }
    : { thinking: { type: 'enabled' }, reasoning_effort: effort }),
};

const startedAt = Date.now();
const response = await fetch(`${BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify(body),
});

const elapsed = Date.now() - startedAt;
const text = await response.text();

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}

const data = JSON.parse(text);
const choice = data.choices?.[0];
const content = choice?.message?.content ?? '';
const usage = data.usage ?? {};

console.log(`model=${model} effort=${effort} elapsed=${elapsed}ms finish=${choice?.finish_reason}`);
console.log(`usage=${JSON.stringify(usage)}`);
console.log('--- content ---');
console.log(content);

function countUnescaped(text, symbol) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === symbol) count += 1;
  }
  return count;
}

const dollars = countUnescaped(content, '$');
const openBraces = (content.match(/(?<!\\)\{/g) ?? []).length;
const closeBraces = (content.match(/(?<!\\)\}/g) ?? []).length;
console.log(
  `--- check --- $=${dollars}(even=${dollars % 2 === 0}) braces=${openBraces}/${closeBraces}(balanced=${openBraces === closeBraces})`,
);
