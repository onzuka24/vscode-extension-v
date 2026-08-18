import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `vimLike.search` を `editorFind` にしたときの検索です。パターンの照合も一致の記憶も
 * VS Code の検索バーが持つので、コアが決めるのは「どれを頼むか」だけになります。
 *
 * 比べる相手は test/search.test.ts の既定の検索です。差が出るのは次の3点で、
 * ここではその差そのものをテストにしています。
 *
 *   1. `/` はコマンドラインモードに入らず、検索バーを開くだけ
 *   2. `n` `N` はモーションではなくコマンドなので、カーソル位置をコアが知らない
 *   3. その帰結として、オペレータとは組み合わせられない
 */

const TEXT = 'foo bar\nbaz foo\nqux';
const FIND = { search: 'editorFind' } as const;

test('/ と ? は検索バーを開く', () => {
  const session = run(TEXT, '/', FIND);
  assert.deepEqual(session.finds, [{ request: 'open', count: 1 }]);
  assert.equal(session.mode, 'normal', 'コマンドラインモードには入らない');
  assert.equal(session.pending, '', '打鍵は検索バーへ行くので、こちらは何も抱えない');
  assert.deepEqual(run(TEXT, '?', FIND).finds, [{ request: 'open', count: 1 }]);
});

test('検索バーに渡したあとの打鍵は横取りしない', () => {
  // `/foo` の foo は検索バーの入力欄へ行きます。ここに届く分にはモーションとして働きます。
  const session = run(TEXT, '/', FIND);
  assert.equal(session.text, TEXT);
  assert.equal(session.at, '0:0');
});

test('n と N は次・前の一致へのコマンドになる', () => {
  assert.deepEqual(run(TEXT, 'n', FIND).finds, [{ request: 'next', count: 1 }]);
  assert.deepEqual(run(TEXT, 'N', FIND).finds, [{ request: 'previous', count: 1 }]);
  assert.deepEqual(run(TEXT, '3n', FIND).finds, [{ request: 'next', count: 3 }]);
});

test('* と # は単語を選んでから検索バーに渡す', () => {
  const session = run(TEXT, '*', FIND);
  assert.deepEqual(session.finds, [
    { request: 'next', count: 1, seed: { start: pos(0, 0), end: pos(0, 3) } }
  ]);
  assert.deepEqual(run(TEXT, '#', FIND).finds, [
    { request: 'previous', count: 1, seed: { start: pos(0, 0), end: pos(0, 3) } }
  ]);
});

test('カーソルが空白の上なら、行の次の単語を選ぶ', () => {
  assert.deepEqual(run('  foo', '*', FIND).finds, [
    { request: 'next', count: 1, seed: { start: pos(0, 2), end: pos(0, 5) } }
  ]);
});

test('単語がなければその旨を知らせる', () => {
  assert.deepEqual(run('   ', '*', FIND).messages, ['E348: No string under cursor']);
});

test('オペレータとは組み合わせられないと明示する', () => {
  // 既定の検索では `dn` が効きます。検索バー方式ではカーソルの着地点をコアが
  // 知らないため、黙って何かを消すよりも、できないと言うほうを選びます。
  const session = run('one two three', 'dn', FIND);
  assert.equal(session.text, 'one two three');
  assert.deepEqual(session.finds, []);
  assert.equal(session.messages.length, 1);
  assert.match(session.messages[0]!, /オペレータ/);
});

test('既定の検索とは違って、コアはパターンを覚えない', () => {
  // 記憶しているのは検索バーの側です。`//` に当たるものもそちらの履歴になります。
  assert.deepEqual(run(TEXT, 'n', FIND).messages, [], '直前の検索がなくてもコアは文句を言わない');
});

test('検索以外のキーは何も変わらない', () => {
  assert.equal(run(TEXT, 'dw', FIND).text, 'bar\nbaz foo\nqux');
  assert.equal(run(TEXT, 'j', FIND).at, '1:0');
  assert.deepEqual(run(TEXT, ':w<CR>', FIND).commands, ['workbench.action.files.save']);
});
