#!/usr/bin/env node
/**
 * 延迟基准：用真实 DeepSeek FIM 接口测不同上下文大小的 TTFT 和总耗时。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/bench.mjs
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/bench.mjs 4000 8000 16000
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/bench.mjs 8000 --runs 5
 *
 * 可选环境变量：DEEPSEEK_BASE_URL、DEEPSEEK_MODEL
 */

const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/beta').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY;

if (!API_KEY) {
  console.error('缺少 DEEPSEEK_API_KEY。示例：DEEPSEEK_API_KEY=sk-xxx node scripts/bench.mjs');
  process.exit(1);
}

const args = process.argv.slice(2);
const runsIndex = args.indexOf('--runs');
const runs = runsIndex >= 0 ? Number(args[runsIndex + 1]) || 3 : 3;
const sizes = args
  .filter((arg, index) => !arg.startsWith('--') && index !== runsIndex + 1)
  .map(Number)
  .filter((value) => Number.isFinite(value) && value > 0);

const contextSizes = sizes.length > 0 ? sizes : [4000, 8000, 16000];

const SAMPLE = `import { useState } from 'react';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);

  function add(title: string) {
    setTodos((prev) => [...prev, { id: Date.now(), title, done: false }]);
  }

  function toggle(id: number) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function remove(id: number) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  return { todos, add, toggle, remove };
}
`;

function makePrompt(tokens) {
  const chars = Math.round(tokens * 3.5);
  let text = SAMPLE;
  while (text.length < chars) text = `${SAMPLE}\n${text}`;
  return text.slice(text.length - chars);
}

async function runOnce(contextTokens) {
  const prompt = makePrompt(contextTokens);
  const startedAt = performance.now();
  let firstTokenAt = null;
  let text = '';
  let usage = null;

  const response = await fetch(`${BASE_URL}/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      suffix: '',
      max_tokens: 128,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.usage) usage = chunk.usage;

      const delta = chunk.choices?.[0]?.text ?? chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        if (firstTokenAt === null) firstTokenAt = performance.now();
        text += delta;
      }
    }
  }

  const finishedAt = performance.now();
  return {
    ttft: firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt),
    total: Math.round(finishedAt - startedAt),
    outChars: text.length,
    usage,
  };
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

console.log(`模型=${MODEL}  接口=${BASE_URL}/completions  runs=${runs}`);
console.log('context_tokens  run  ttft_ms  total_ms  out_chars  cached_tokens');
console.log('-'.repeat(78));

await runOnce(1000).catch(() => {}); // 预热

const summary = [];
for (const contextTokens of contextSizes) {
  const ttfts = [];
  const totals = [];
  for (let run = 1; run <= runs; run += 1) {
    try {
      const result = await runOnce(contextTokens);
      if (result.ttft !== null) ttfts.push(result.ttft);
      totals.push(result.total);
      const cached = result.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      console.log(
        `${String(contextTokens).padEnd(14)} ${String(run).padEnd(4)} ` +
          `${String(result.ttft ?? '-').padEnd(8)} ${String(result.total).padEnd(9)} ` +
          `${String(result.outChars).padEnd(10)} ${cached}`,
      );
    } catch (error) {
      console.log(`${String(contextTokens).padEnd(14)} ${String(run).padEnd(4)} ERROR: ${error.message}`);
    }
  }
  summary.push({
    contextTokens,
    ttftP50: percentile(ttfts, 0.5),
    ttftP95: percentile(ttfts, 0.95),
    totalP50: percentile(totals, 0.5),
    totalP95: percentile(totals, 0.95),
  });
}

console.log('\n汇总：');
for (const item of summary) {
  console.log(
    `  ${String(item.contextTokens).padStart(6)} tokens: ttft p50=${item.ttftP50}ms p95=${item.ttftP95}ms | total p50=${item.totalP50}ms p95=${item.totalP95}ms`,
  );
}
