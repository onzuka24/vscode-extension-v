import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { RemapConfiguration, RemapRule, RemapTable } from '../src/core/remap';
import { run } from './harness';

/**
 * The template in `examples/` is the one artefact a user copies verbatim, so a
 * stale key name there is as bad as a bug. Loading it through the real validator
 * on every CI run keeps it honest.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const source = readFileSync(path.join(ROOT, 'examples', 'settings.jsonc'), 'utf8');

interface Settings {
  'vimLike.leader': string;
  'vimLike.normalModeKeyBindings': RemapRule[];
  'vimLike.visualModeKeyBindings': RemapRule[];
}

const settings = JSON.parse(extractObject(stripComments(source))) as Settings;

const configuration: RemapConfiguration = {
  leader: settings['vimLike.leader'],
  normal: settings['vimLike.normalModeKeyBindings'],
  visual: settings['vimLike.visualModeKeyBindings']
};

test('テンプレートは設定として読み込める', () => {
  const { problems } = RemapTable.from(configuration);
  assert.deepEqual(problems, []);
});

test('テンプレートの規則はすべて after か commands を持つ', () => {
  const rules = [...configuration.normal!, ...configuration.visual!];
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    const kinds = [rule.after, rule.commands].filter(value => value !== undefined && value.length > 0);
    assert.equal(kinds.length, 1, `${rule.before.join('')} の指定が片方だけになっていません`);
  }
});

test('テンプレートの移動キーが init.vim どおりに動く', () => {
  const remaps = { ...configuration };
  const twentyLines = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');

  assert.equal(run('    indented', 'H', { cursor: pos0(9), remaps }).at, '0:4');
  assert.equal(run('hello', 'L', { remaps }).at, '0:4');
  assert.equal(run(twentyLines, 'J', { remaps }).at, '10:0');
  assert.equal(run(twentyLines, 'K', { cursor: { line: 15, character: 0 }, remaps }).at, '5:0');
});

test('テンプレートの leader マッピングが発火する', () => {
  const remaps = { ...configuration };
  assert.deepEqual(run('abc', ' s', { remaps }).commands, ['workbench.action.files.save']);
  assert.deepEqual(run('abc', ' wh', { remaps }).commands, ['workbench.action.decreaseViewWidth']);
  assert.deepEqual(run('abc', ' ww', { remaps }).commands, ['workbench.action.evenEditorWidths']);
  assert.deepEqual(run('abc', ' /', { remaps }).commands, ['editor.action.commentLine']);
});

test('テンプレートの Visual モード側も効く', () => {
  const remaps = { ...configuration };
  assert.equal(run('hello world', 'vLd', { remaps }).text, '');
  assert.deepEqual(run('hello', 'v /', { remaps }).commands, ['editor.action.commentLine']);
});

test('テンプレートは Vim 既定のキーを壊さない', () => {
  const remaps = { ...configuration };
  assert.equal(run('hello world', 'dw', { remaps }).text, 'world');
  assert.equal(run('one\ntwo', 'dd', { remaps }).text, 'two');
  assert.equal(run('aJb', 'fJ', { remaps }).at, '0:1', 'f の引数は置き換えられない');
});

function pos0(character: number): { line: number; character: number } {
  return { line: 0, character };
}

/** Removes `//` comments, leaving anything that appears inside a string alone. */
function stripComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      if (newline === -1) break;
      i = newline - 1;
      continue;
    }

    result += char;
  }
  return result;
}

/** Takes the first balanced `{...}`, ignoring the explanatory notes that follow it. */
function extractObject(text: string): string {
  const start = text.indexOf('{');
  assert.notEqual(start, -1, 'テンプレートに JSON オブジェクトが見つかりません');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }

  throw new Error('テンプレートの波括弧が閉じていません');
}
