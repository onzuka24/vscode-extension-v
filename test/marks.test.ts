import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkStore, normalizeMarkName } from '../src/core/marks';
import { pos } from '../src/core/types';
import { run } from './harness';

const SAMPLE = 'alpha\n  beta\ngamma\ndelta';

test('m で付けたマークに ` で正確に戻る', () => {
  const session = run(SAMPLE, 'maG`a', { cursor: pos(1, 4) });
  assert.equal(session.at, '1:4');
  assert.equal(session.text, SAMPLE, 'マークを付けても本文は変わらない');
});

test("' はマーク行の先頭非空白へ移動する", () => {
  assert.equal(run(SAMPLE, "maG'a", { cursor: pos(1, 4) }).at, '1:2');
});

test('m はカーソルを動かさない', () => {
  const session = run(SAMPLE, 'ma', { cursor: pos(2, 3) });
  assert.equal(session.at, '2:3');
  assert.deepEqual(session.messages, []);
});

test('マークは複数を別々に覚える', () => {
  const session = run(SAMPLE, 'majmbG`a', { cursor: pos(0, 0) });
  assert.equal(session.at, '0:0');
  assert.equal(run(SAMPLE, 'majmbG`b', { cursor: pos(0, 0) }).at, '1:0');
});

test('マークを上書きできる', () => {
  assert.equal(run(SAMPLE, 'majjma G`a', { cursor: pos(0, 0) }).at, '2:0');
});

test('` は exclusive なので、その文字は消さずに残る', () => {
  // 0:0 にマークを置き、2 行下から d`a で戻ると 2 行分が消える。
  assert.equal(run('a\nb\nc\nd', 'majjd`a').text, 'c\nd');
});

test("' は linewise なので行ごと消える", () => {
  assert.equal(run('a\nb\nc\nd', "majjd'a").text, 'd');
});

test('マークはヤンクにも使える', () => {
  assert.equal(run('a\nb\nc\nd', "majjy'aP").text, 'a\nb\nc\na\nb\nc\nd');
});

test('付けていないマークへ移動しても何も起きない', () => {
  const session = run(SAMPLE, '`z', { cursor: pos(2, 1) });
  assert.equal(session.at, '2:1');
  assert.equal(session.text, SAMPLE);
});

test('マーク名にならない文字は理由が表示される', () => {
  const session = run(SAMPLE, 'mA');
  assert.equal(session.messages.length, 1);
  assert.match(session.messages[0] ?? '', /E191/);
});

test('大きな移動は戻り先を残し、`` で戻れる', () => {
  assert.equal(run(SAMPLE, 'G``', { cursor: pos(1, 3) }).at, '1:3');
  assert.equal(run(SAMPLE, "G''", { cursor: pos(1, 3) }).at, '1:2', "'' は行頭の非空白へ");
});

test('小さな移動は戻り先を残さない', () => {
  // j や l はジャンプではないので、`` は G が残した 0:0 のままになる。
  assert.equal(run(SAMPLE, 'Gkkll``').at, '0:0');
});

test('検索はジャンプとして扱われる', () => {
  const text = 'one\ntwo\nthree\nfour';
  // 先に移動そのものを確かめてから戻る。移動が起きていなければ
  // 戻り先も動かないので、両方を見ないと素通りに気づけない。
  assert.equal(run(text, '/four<CR>', { cursor: pos(1, 0) }).at, '3:0');
  assert.equal(run(text, '/four<CR>``', { cursor: pos(1, 0) }).at, '1:0');
});

test('段落移動はジャンプとして扱われる', () => {
  const text = 'a\n\nb\n\nc';
  assert.equal(run(text, '}', { cursor: pos(2, 0) }).at, '3:0');
  assert.equal(run(text, '}``', { cursor: pos(2, 0) }).at, '2:0');
});

test('失敗したジャンプは戻り先を上書きしない', () => {
  // G で 0:0 を記録したあと、存在しないマークへの移動が失敗しても
  // `` は 0:0 のままでなければならない。
  assert.equal(run(SAMPLE, 'G`z``').at, '0:0');
});

test('マークは編集に追従しない', () => {
  // 現状の割り切り。上の行を消すとマークは行番号のままずれる。
  // 追従させる実装を入れたら、このテストは期待値ごと書き換わる。
  const session = run('a\nb\nc\nd', 'jjmagg dd `a');
  assert.equal(session.text, 'b\nc\nd');
  assert.equal(session.at, '2:0', 'マークは 2 行目を指したままで、内容は d に変わっている');
});

test('マーク名の正規化', () => {
  assert.equal(normalizeMarkName('a'), 'a');
  assert.equal(normalizeMarkName('z'), 'z');
  assert.equal(normalizeMarkName('`'), '`');
  assert.equal(normalizeMarkName("'"), '`', "` と ' は同じマークを指す");
  assert.equal(normalizeMarkName('A'), null);
  assert.equal(normalizeMarkName('1'), null);
});

test('マークはバッファごとに分かれている', () => {
  const marks = new MarkStore();
  marks.set('file:///a.ts', 'a', pos(10, 2));
  marks.set('file:///b.ts', 'a', pos(3, 0));

  assert.deepEqual(marks.get('file:///a.ts', 'a'), pos(10, 2));
  assert.deepEqual(marks.get('file:///b.ts', 'a'), pos(3, 0));
  assert.equal(marks.get('file:///c.ts', 'a'), undefined);
});

test('マーク名にならない名前は保存されない', () => {
  const marks = new MarkStore();
  assert.equal(marks.set('file:///a.ts', 'A', pos(1, 1)), false);
  assert.equal(marks.get('file:///a.ts', 'A'), undefined);
});

test('マーク名はリマップされない', () => {
  // a を b に割り当てていても、ma は名前 a のマークを付ける。
  const remaps = { normal: [{ before: ['a'], after: ['b'] }] };
  assert.equal(run('alpha\nbeta\ngamma', 'maG`a', { remaps }).at, '0:0');
});
