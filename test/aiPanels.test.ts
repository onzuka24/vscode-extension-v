import assert from 'node:assert/strict';
import test from 'node:test';
import { AiPanel, compileAiPanels, referenceRange } from '../src/core/aiPanels';
import { LinesBuffer } from '../src/core/buffer';
import { pos } from '../src/core/types';

/**
 * `<leader>e` の送り先の設定と、参照を作る範囲の決め方 (issue #40)。
 *
 * 送るのは本文ではなく参照 (`@file#12-20`) です。相手のコマンドは引数を取らず、
 * 自分で `editor.selection` を読むので、こちらは範囲を合わせてから呼びます。
 */

// ------------------------------------------------------------------ 設定の検証

test('name と command の並びを読める', () => {
  const { panels, problems } = compileAiPanels([
    { name: 'Claude Code', command: 'claude-vscode.focus' },
    { name: 'Codex', command: 'chatgpt.addToThread' }
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(panels, [
    { name: 'Claude Code', command: 'claude-vscode.focus' },
    { name: 'Codex', command: 'chatgpt.addToThread' }
  ]);
});

test('未設定なら空になる', () => {
  assert.deepEqual(compileAiPanels(undefined), { panels: [], problems: [] });
});

test('配列でなければ報告する', () => {
  const { panels, problems } = compileAiPanels({ name: 'x', command: 'y' });
  assert.deepEqual(panels, []);
  assert.equal(problems.length, 1);
});

test('name か command が欠けている項目は落とし、理由を残す', () => {
  const { panels, problems } = compileAiPanels([
    { name: 'ok', command: 'a.b' },
    { name: 'name だけ' },
    { command: 'c.d' },
    { name: '', command: 'e.f' },
    { name: 'g', command: '' },
    'ただの文字列',
    null
  ]);
  assert.deepEqual(panels, [{ name: 'ok', command: 'a.b' }], '正しい項目は残る');
  assert.equal(problems.length, 6);
  for (const problem of problems) assert.match(problem, /vimLike\.aiPanels\[\d+\]/);
});

test('名前の重複は報告する', () => {
  // 名前は選ぶときに出る唯一の手がかりなので、重なると選べません。
  const { panels, problems } = compileAiPanels([
    { name: 'Claude', command: 'a.b' },
    { name: 'Claude', command: 'c.d' }
  ]);
  assert.deepEqual(panels, [{ name: 'Claude', command: 'a.b' }], '先に書いたほうが残る');
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /重複/);
});

test('余分なキーがあっても name と command だけを取る', () => {
  const { panels } = compileAiPanels([{ name: 'x', command: 'y', nonsense: 1 }]);
  assert.deepEqual(panels, [{ name: 'x', command: 'y' }] as AiPanel[]);
});

// ------------------------------------------------------------ 参照する範囲

test('選択範囲があればそれを使う', () => {
  const buffer = new LinesBuffer('one\ntwo\nthree', '\n');
  const selected = { start: pos(0, 1), end: pos(2, 2) };
  assert.deepEqual(referenceRange(buffer, pos(2, 2), selected), selected);
});

test('選択範囲がなければ現在行の全体を指す', () => {
  const buffer = new LinesBuffer('one\ntwo', '\n');
  assert.deepEqual(referenceRange(buffer, pos(1, 1), null), { start: pos(1, 0), end: pos(1, 3) });
});

test('空行は何も指さない', () => {
  // 相手のコマンドは選択が空だとファイル全体を参照します。カーソルがたまたま
  // 空行にあっただけでファイル全体を渡してしまうより、送らないほうがましです。
  const buffer = new LinesBuffer('one\n\ntwo', '\n');
  assert.equal(referenceRange(buffer, pos(1, 0), null), null);
});

test('空白だけの行も何も指さない', () => {
  const buffer = new LinesBuffer('one\n    \ntwo', '\n');
  assert.equal(referenceRange(buffer, pos(1, 2), null), null);
});

test('空白を含む行は、行頭から行末までを指す', () => {
  // インデントは範囲に入れます。相手が使うのは行番号だけなので列は影響しません。
  const buffer = new LinesBuffer('  code  ', '\n');
  assert.deepEqual(referenceRange(buffer, pos(0, 3), null), { start: pos(0, 0), end: pos(0, 8) });
});
