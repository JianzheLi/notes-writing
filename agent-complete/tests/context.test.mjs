import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Position,
      Range,
      workspace: {
        asRelativePath: (uri) => String(uri),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { buildContext, matchesExcludePath } = require('../out/context.js');

function makeDocument(text, languageId = 'markdown') {
  const lines = text.split('\n');
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const offsetAt = (pos) => starts[pos.line] + Math.min(pos.character, lines[pos.line].length);
  const lineStart = (line) => starts[line];
  const positionAt = (target) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= target) line += 1;
    return new Position(line, target - starts[line]);
  };

  return {
    languageId,
    lineCount: lines.length,
    getText(range) {
      if (!range) return text;
      return text.slice(offsetAt(range.start), offsetAt(range.end));
    },
    lineAt(line) {
      return {
        text: lines[line] ?? '',
        range: { end: new Position(line, (lines[line] ?? '').length) },
      };
    },
    offsetAt,
    lineStart,
    positionAt,
  };
}

test('context: 短文档保留完整前缀/后缀', () => {
  const text = '# 小节\n\n\\newcommand{\\R}{\\mathbb{R}}\n\n正文';
  const doc = makeDocument(text);
  const pos = doc.positionAt(text.length);
  const ctx = buildContext(doc, pos, 32000);
  assert.equal(ctx.section, '小节');
  assert.equal(ctx.macros, '');
  assert.equal(ctx.prefix, text);
  assert.equal(ctx.suffix, '');
});

test('context: 长文档抽宏定义和小节，prefix 加省略标记', () => {
  const lines = ['# 长文档', ''];
  lines.push('\\newcommand{\\R}{\\mathbb{R}}');
  for (let i = 0; i < 400; i += 1) lines.push(`第 ${i} 行正文，用于把文档撑长。`);
  lines.push('', '## 当前小节', '', '光标前面的最后一段。', '');
  const text = lines.join('\n');
  const doc = makeDocument(text);
  const pos = doc.positionAt(text.indexOf('光标前面的最后一段。'));
  const ctx = buildContext(doc, pos, 1000);

  assert.match(ctx.macros, /\\newcommand/);
  assert.match(ctx.prefix, /前面内容已省略/);
  assert.equal(ctx.section, '长文档 > 当前小节');
  assert.ok(ctx.prefix.length < text.length);
});

test('context: 有选区时 prefix/suffix 不包含选区', () => {
  const text = '# 小节\n\n其中 aaaa 是样本方差。\n\n后面还有内容。';
  const doc = makeDocument(text);
  const start = doc.positionAt(text.indexOf('aaaa'));
  const end = doc.positionAt(text.indexOf('aaaa') + 4);
  const selection = { start, end, isEmpty: false };
  const ctx = buildContext(doc, end, 32000, selection);
  assert.equal(ctx.selection, 'aaaa');
  assert.ok(!ctx.prefix.includes('aaaa'));
  assert.ok(!ctx.suffix.includes('aaaa'));
  assert.match(ctx.prefix, /其中 $/);
  assert.match(ctx.suffix, /^ 是样本方差/);
});

test('exclude: 常见 glob 匹配', () => {
  assert.equal(matchesExcludePath('.env', ['**/.env']), true);
  assert.equal(matchesExcludePath('a/.env.local', ['**/.env.*']), true);
  assert.equal(matchesExcludePath('notes/secret.md', ['**/*secret*']), true);
  assert.equal(matchesExcludePath('notes/paper.tex', ['**/*.key', '**/.env']), false);
  assert.equal(matchesExcludePath('notes/paper.tex', []), false);
});
