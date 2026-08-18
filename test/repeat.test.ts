import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `.` は直前の「変更」を繰り返します。カーソル移動やヤンクは変更ではないので、
 * それらを挟んでも繰り返す対象は変わりません。
 *
 * Insert モードを通った変更（`cw` など）では、打った内容も繰り返しの一部です。
 * 打鍵そのものを覗くのではなく、Insert を抜けた時点でバッファから読み戻しています。
 */

const LINES = 'one two three\nfour five six';

test('直前の変更を繰り返す', () => {
  assert.equal(run('a b c d', 'dw.').text, 'c d');
  assert.equal(run('abcdef', 'x.').text, 'cdef');
  assert.equal(run(LINES, 'dd.').text, '');
});

test('カーソル移動やヤンクは繰り返しの対象にならない', () => {
  // `x` のあと `w` で移動しても、`.` が繰り返すのは `x` のままです。
  assert.equal(run('ab cd', 'xw.').text, 'b d');
  assert.equal(run('ab cd', 'xyyw.').text, 'b d', 'yy を挟んでも変わらない');
});

test('カウントは元のコマンドのカウントを置き換える', () => {
  // Vim と同じ規則です。`3.` は「3回繰り返す」ではなく「3語ぶん削除し直す」。
  assert.equal(run('a b c d e', 'dw3.').text, 'e');
  assert.equal(run('a b c d e', '2dw.').text, 'e', 'カウントなしの . は元のカウントを引き継ぐ');
});

test('Insert モードを通った変更は、打った内容ごと繰り返す', () => {
  assert.equal(run('one two', 'cwX<Esc>w.').text, 'X X');
  assert.equal(run('foo bar', 'ihi <Esc>0.').text, 'hi hi foo bar');
});

test('繰り返しのあとカーソルは挿入した末尾に来る', () => {
  const session = run('one two', 'cwXY<Esc>w.');
  assert.equal(session.text, 'XY XY');
  assert.equal(session.at, '0:4');
  assert.equal(session.mode, 'normal', 'Insert モードには入ったままにならない');
});

test('o や O も繰り返せる', () => {
  assert.equal(run('one', 'otwo<Esc>.').text, 'one\ntwo\ntwo');
  assert.equal(run('  one', 'obee<Esc>.').text, '  one\n  bee\n  bee', 'インデントも引き継ぐ');
});

test('置換・連結・大小反転も変更として記録する', () => {
  assert.equal(run('aaaa', 'rzll.', { cursor: pos(0, 0) }).text, 'zaza');
  assert.equal(run('a\nb\nc', 'J.').text, 'a b c');
  assert.equal(run('abc', '~.').text, 'ABc');
});

test('貼り付けも繰り返せる', () => {
  assert.equal(run('one\ntwo', 'yyp.').text, 'one\none\none\ntwo');
});

test('インデントも繰り返せる', () => {
  const session = run(LINES, '>>j.');
  assert.deepEqual(session.indents, [
    { startLine: 0, endLine: 0, direction: 'in', levels: 1 },
    { startLine: 1, endLine: 1, direction: 'in', levels: 1 }
  ]);
});

test('取り消しは繰り返しの対象にならない', () => {
  // `u` は VS Code の履歴に委ねるので、エンジンからは編集として見えません。
  // ハーネスには取り消し履歴がないため文字列は戻りませんが、`.` が `u` ではなく
  // `x` を繰り返していることは、もう1文字消えることで分かります。
  const session = run('abcdef', 'xu.');
  assert.deepEqual(session.commands, ['undo']);
  assert.equal(session.text, 'cdef');
});

test('. 自身は記録されない', () => {
  // `..` は「x を2回」であって「. を繰り返す」ではありません。
  assert.equal(run('abcdef', 'x..').text, 'def');
});

test('変更がまだ何もなければ何も起きない', () => {
  const session = run(LINES, '.');
  assert.equal(session.text, LINES);
  assert.equal(session.at, '0:0');
});

test('検索と組み合わせて使える', () => {
  // Vim で日常的に使う `cw` して `n.` `n.` の形です。
  assert.equal(run('foo bar foo', 'cwX<Esc>/foo<CR>.').text, 'X bar X');
});
