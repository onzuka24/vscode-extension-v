import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { IndentRequest, run } from './harness';

/**
 * `>` と `<` は行を動かす幅を自分で決めません。幅・タブかスペースか・言語ごとの設定は
 * すべて VS Code 側にあるためです。だからここで検査するのは、コアが実際に決めていること
 * ——「どの行を、どちら向きに、何段」——であり、字下げ後の文字列ではありません。
 * 実際に字下げされることの確認は、本物のエディタでの手動確認になります。
 */

const LINES = 'one\ntwo\nthree\nfour';

function request(startLine: number, endLine: number, direction: 'in' | 'out', levels = 1): IndentRequest {
  return { startLine, endLine, direction, levels };
}

test('>> は現在行を1段下げ、<< は上げる', () => {
  assert.deepEqual(run(LINES, '>>').indents, [request(0, 0, 'in')]);
  assert.deepEqual(run(LINES, '<<').indents, [request(0, 0, 'out')]);
});

test('Normal モードのカウントは行数になる', () => {
  assert.deepEqual(run(LINES, '3>>').indents, [request(0, 2, 'in')]);
  assert.deepEqual(run(LINES, '2<<', { cursor: pos(1, 0) }).indents, [request(1, 2, 'out')]);
});

test('カウントがバッファの末尾を越えても最終行で止まる', () => {
  assert.deepEqual(run(LINES, '9>>', { cursor: pos(2, 0) }).indents, [request(2, 3, 'in')]);
});

test('モーションと組み合わせられる', () => {
  assert.deepEqual(run(LINES, '>j').indents, [request(0, 1, 'in')]);
  assert.deepEqual(run(LINES, '>3j').indents, [request(0, 3, 'in')]);
  assert.deepEqual(run(LINES, '>2j').indents, [request(0, 2, 'in')]);
  assert.deepEqual(run(LINES, '>G').indents, [request(0, 3, 'in')]);
  assert.deepEqual(run(LINES, '<k', { cursor: pos(2, 0) }).indents, [request(1, 2, 'out')]);
});

test('文字単位のモーションでも行単位で効く', () => {
  // Vim の `>` はモーションが文字単位でも常に行に作用します。
  assert.deepEqual(run('alpha beta', '>w').indents, [request(0, 0, 'in')]);
  assert.deepEqual(run('alpha beta', '>e').indents, [request(0, 0, 'in')]);
});

test('次の行の先頭で終わるモーションは、その行を巻き込まない', () => {
  // `dw` と同じ規則です。行末で `>w` を打っても、下の行は動きません。
  assert.deepEqual(run('alpha\nbeta', '>w', { cursor: pos(0, 4) }).indents, [request(0, 0, 'in')]);
});

test('テキストオブジェクトとも組み合わせられる', () => {
  assert.deepEqual(run(LINES, '>iw').indents, [request(0, 0, 'in')]);
});

test('モーションが動けなければ何も起きない', () => {
  const session = run(LINES, '>j', { cursor: pos(3, 0) });
  assert.deepEqual(session.indents, []);
  assert.equal(session.text, LINES);
});

test('Visual モードでは選択している行が対象になる', () => {
  assert.deepEqual(run(LINES, 'vj>').indents, [request(0, 1, 'in')]);
  assert.deepEqual(run(LINES, 'Vj>').indents, [request(0, 1, 'in')]);
  assert.deepEqual(run(LINES, 'Vj<').indents, [request(0, 1, 'out')]);
});

test('Visual モードのカウントは段数になる', () => {
  assert.deepEqual(run(LINES, 'v3>').indents, [request(0, 0, 'in', 3)]);
  assert.deepEqual(run(LINES, 'Vj2>').indents, [request(0, 1, 'in', 2)]);
});

test('Visual モードの > は選択を解いて Normal モードへ戻る', () => {
  // Vim と同じ挙動です。VS Code の indentLines は選択を保ちますが、そちらには寄せません。
  const session = run(LINES, 'Vj>');
  assert.equal(session.mode, 'normal');
});

test('カーソルは対象の先頭行の非空白へ移る', () => {
  assert.equal(run('    one\ntwo', '>j').at, '0:4');
  assert.equal(run('one\n    two', '>>', { cursor: pos(1, 6) }).at, '1:4');
});

test('インデントはバッファもレジスタも触らない', () => {
  assert.equal(run(LINES, '>>').text, LINES, '編集は VS Code 側が行う');
  // yy で取った行が >> のあとも残っていることを、貼り付けて確かめます。
  assert.equal(run('one\ntwo', 'yy>>p').text, 'one\none\ntwo');
});

test('> と < だけでは待ち状態のまま', () => {
  assert.equal(run(LINES, '>').pending, '>');
  assert.deepEqual(run(LINES, '>').indents, []);
});
