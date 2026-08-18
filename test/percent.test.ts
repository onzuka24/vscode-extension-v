import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `%` は対応する括弧へ移動します。カーソルが括弧の上になければ、その行を右に見ていって
 * 最初の括弧を使います。対象は Vim の既定の `matchpairs` と同じ3種 (`()` `[]` `{}`) です。
 *
 * inclusive なモーションなので、`d%` は括弧を含めて消します。
 */

test('開き括弧から閉じ括弧へ、閉じ括弧から開き括弧へ', () => {
  assert.equal(run('(abc)', '%').at, '0:4');
  assert.equal(run('(abc)', '%', { cursor: pos(0, 4) }).at, '0:0');
});

test('カーソルより右にある最初の括弧を使う', () => {
  assert.equal(run('foo(bar)', '%').at, '0:7', '行を右に見ていく');
  assert.equal(run('foo(bar)baz', '%', { cursor: pos(0, 8) }).at, '0:8', '右に括弧がなければ動かない');
});

test('入れ子を数える', () => {
  assert.equal(run('((a))', '%').at, '0:4');
  assert.equal(run('((a))', '%', { cursor: pos(0, 1) }).at, '0:3');
  assert.equal(run('(a(b)c)', '%').at, '0:6');
});

test('行をまたぐ', () => {
  const text = 'function f() {\n  return 1;\n}';
  assert.equal(run(text, '%', { cursor: pos(0, 13) }).at, '2:0');
  assert.equal(run(text, '%', { cursor: pos(2, 0) }).at, '0:13');
});

test('角括弧と波括弧も対象', () => {
  assert.equal(run('[a, b]', '%').at, '0:5');
  assert.equal(run('{ x }', '%').at, '0:4');
});

test('山括弧は対象外', () => {
  // Vim の既定の matchpairs に `<>` は含まれません。`a < b` が何にでも対応してしまうためです。
  assert.equal(run('<a>', '%').at, '0:0');
});

test('相手がいなければ動かない', () => {
  assert.equal(run('(abc', '%').at, '0:0');
  assert.equal(run('abc)', '%', { cursor: pos(0, 3) }).at, '0:3');
});

test('括弧のない行では動かない', () => {
  assert.equal(run('plain text', '%').at, '0:0');
});

test('オペレータと組み合わせると括弧ごと消える', () => {
  assert.equal(run('foo(bar)baz', 'd%', { cursor: pos(0, 3) }).text, 'foobaz');
  // モーションはカーソルから働くので、括弧の手前から打つとそこまでが範囲に入ります。
  assert.equal(run('foo(bar)baz', 'd%').text, 'baz', 'カーソルから対応する括弧まで');
  assert.equal(run('(abc)', 'd%', { cursor: pos(0, 4) }).text, '', '閉じ括弧からでも同じ範囲');
});

test('c% と y% も使える', () => {
  assert.equal(run('foo(bar)baz', 'c%X<Esc>', { cursor: pos(0, 3) }).text, 'fooXbaz');
  assert.equal(run('(a)\nx', 'y%P').text, '(a)(a)\nx');
});

test('行をまたぐ削除もできる', () => {
  const text = 'f() {\n  body;\n}\nafter';
  assert.equal(run(text, 'd%', { cursor: pos(0, 4) }).text, 'f() \nafter', '{ から } までが消える');
});

test('Visual モードでは選択が伸びる', () => {
  const session = run('(abc)', 'v%');
  assert.equal(session.mode, 'visual');
  assert.equal(session.at, '0:4');
  assert.equal(run('(abc)x', 'v%d').text, 'x');
});

test('. で繰り返せる', () => {
  assert.equal(run('(a)(b)', 'd%.').text, '');
});
