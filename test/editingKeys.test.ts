import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * Backspace, Enter と Delete。いずれも `type` コマンドを通らないため、放っておくと
 * VS Code の編集コマンドがそのまま働き、Normal モードがバッファを書き換えてしまいます。
 * Vim ではどれもモーション（`<Del>` だけ `x` 相当）なので、そちらに合わせています。
 */

const TEXT = 'Hello\n  world\nlast';

test('Normal モードの Backspace は文字を消さず、左へ動く', () => {
  // https://github.com/onzuka24/vscode-extension-v/issues/20 の報告そのまま。
  const session = run('Hello', '<BS>', { cursor: pos(0, 2) });
  assert.equal(session.text, 'Hello');
  assert.equal(session.at, '0:1');
});

test('Backspace は行をまたいで戻る', () => {
  // `h` と違い、Vim の Backspace は既定で前の行へ回り込む。
  assert.equal(run(TEXT, '<BS>', { cursor: pos(1, 0) }).at, '0:4');
  assert.equal(run(TEXT, '<BS>', { cursor: pos(1, 0) }).text, TEXT);
});

test('先頭での Backspace は何もしない', () => {
  const session = run(TEXT, '<BS>');
  assert.equal(session.at, '0:0');
  assert.equal(session.text, TEXT);
});

test('Normal モードの Enter は改行せず、次の行の非空白へ動く', () => {
  const session = run(TEXT, '<CR>');
  assert.equal(session.text, TEXT, '改行が入らない');
  assert.equal(session.at, '1:2', 'インデントを飛ばした位置');
});

test('最終行での Enter は何もしない', () => {
  const session = run(TEXT, '<CR>', { cursor: pos(2, 1) });
  assert.equal(session.text, TEXT);
  assert.equal(session.at, '2:1');
});

test('Delete は x と同じで、レジスタにも入る', () => {
  assert.equal(run('abc', '<Del>').text, 'bc');
  assert.equal(run('abc', '<Del>p').text, 'bac', 'x と同じく貼り付けられる');
});

test('Delete は空行で次の行を引き上げない', () => {
  // VS Code の deleteRight は行を連結してしまう。Vim の x は何もしない。
  assert.equal(run('a\n\nb', '<Del>', { cursor: pos(1, 0) }).text, 'a\n\nb');
});

test('Visual モードでは選択が伸びる', () => {
  assert.equal(run('hello world', 'v<BS>', { cursor: pos(0, 4) }).at, '0:3');
  assert.equal(run('hello world', 'v<BS>d', { cursor: pos(0, 4) }).text, 'hel world');
  // Visual の選択は着地点の文字を含むので、2行目の w まで消える。
  assert.equal(run(TEXT, 'v<CR>d').text, 'orld\nlast', '行をまたいで選択できる');
});

test('コマンドラインでは従来どおり文字を消し、Enter で実行する', () => {
  assert.equal(run(TEXT, ':wq<BS>').pending, ':w');
  assert.deepEqual(run(TEXT, ':w<CR>').commands, ['workbench.action.files.save']);
  assert.equal(run(TEXT, ':<BS>').mode, 'normal', ': まで消せばモードを抜ける');
});

test('Insert モードのキーは VS Code に渡す', () => {
  // ここを奪うと Insert モードで文字を消せなくなる。ハーネスは handled=false を
  // 「拡張が扱わなかった」として、そのまま文字を挿入する側に回す。
  const session = run('abc', 'i<BS>');
  assert.equal(session.mode, 'insert');
  assert.equal(session.text, '<BS>abc', 'エンジンは受け取らず、そのまま流れる');
});
