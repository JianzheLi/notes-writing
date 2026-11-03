/**
 * 测试公共工具。
 *
 * 单测直接加载 TypeScript 编译产物 `out/*.js`（CommonJS），
 * 因此运行测试前必须先 `npm run compile`（`npm test` 已经串好）。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const { mathStateAt, maskNonMath, isMathEnvironment } = require('../out/mathScan.js');
export const { buildSuggestion } = require('../out/postprocess.js');

/** 不在任何数学结构中的状态。 */
export const OUTSIDE = Object.freeze({
  inSingleDollar: false,
  inDoubleDollar: false,
  inBracketDisplay: false,
  inParenInline: false,
  envStack: [],
});

/**
 * 断言 text 在 offset 处的数学状态。
 *
 * @param {string} text 待扫描文本
 * @param {number} offset 光标偏移（字符位置）
 * @param {object} expectedFlags 期望的字段；未列出的字段默认 false，envStack 默认 []
 * @param {{ languageId?: string, note?: string }} [meta]
 */
export function checkState(text, offset, expectedFlags, meta = {}) {
  const { languageId = 'markdown', note = '' } = meta;
  const expected = { ...OUTSIDE, ...expectedFlags };
  expected.envStack = expectedFlags.envStack ?? [];

  const actual = mathStateAt(text, offset, languageId);
  const label =
    `mathStateAt(${JSON.stringify(text)}, offset=${offset}, languageId=${JSON.stringify(languageId)})` +
    (note ? ` — ${note}` : '');

  assert.deepStrictEqual(
    actual,
    expected,
    `${label}\n  期望状态: ${JSON.stringify(expected)}\n  实际状态: ${JSON.stringify(actual)}`,
  );
  return actual;
}

/**
 * 断言 buildSuggestion 的完整输出。
 *
 * @param {string} raw 模型原始输出
 * @param {string} mode FormulaMode
 * @param {string} lineBefore 插入点之前的行内文本
 * @param {object|undefined} options SuggestionOptions
 * @param {string} expected 期望输出
 * @param {string} [note]
 */
export function checkSuggestion(raw, mode, lineBefore, options, expected, note = '') {
  const actual = buildSuggestion(raw, mode, lineBefore, options);
  const label =
    `buildSuggestion(${JSON.stringify(raw)}, mode=${JSON.stringify(mode)}, ` +
    `lineBefore=${JSON.stringify(lineBefore)}, options=${JSON.stringify(options ?? null)})` +
    (note ? ` — ${note}` : '');

  assert.strictEqual(
    actual,
    expected,
    `${label}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`,
  );
  return actual;
}

/** 断言 maskNonMath 只做等长替换、且不改变换行位置（保证后续 offset 不漂移）。 */
export function checkMaskPreservesShape(original, masked, label) {
  assert.strictEqual(
    masked.length,
    original.length,
    `${label}: mask 后长度必须不变\n  原文长度: ${original.length}\n  掩码长度: ${masked.length}\n  原文: ${JSON.stringify(original)}\n  掩码: ${JSON.stringify(masked)}`,
  );
  for (let i = 0; i < original.length; i += 1) {
    if (original[i] === '\n') {
      assert.strictEqual(
        masked[i],
        '\n',
        `${label}: 换行位置必须保留（第 ${i} 个字符）\n  原文: ${JSON.stringify(original)}\n  掩码: ${JSON.stringify(masked)}`,
      );
    }
  }
}
