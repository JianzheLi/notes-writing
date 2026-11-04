import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cachePercent } = require('../out/lastRequest.js');

test('lastRequest: cache 百分比', () => {
  assert.equal(
    cachePercent({
      elapsedMs: 1,
      attempts: 1,
      mode: 'auto',
      style: 'inline',
      promptTokens: 5000,
      cacheHitTokens: 4100,
    }),
    82,
  );
});

test('lastRequest: 无 promptTokens 时返回 undefined', () => {
  assert.equal(
    cachePercent({
      elapsedMs: 1,
      attempts: 1,
      mode: 'auto',
      style: 'inline',
    }),
    undefined,
  );
});

test('lastRequest: 命中数不会超过 prompt', () => {
  assert.equal(
    cachePercent({
      elapsedMs: 1,
      attempts: 1,
      mode: 'auto',
      style: 'inline',
      promptTokens: 100,
      cacheHitTokens: 200,
    }),
    100,
  );
});
