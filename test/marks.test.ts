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

const LISTED = 'first line\n  second line\nthird line\nfourth line';

test(':marks は付けたマークを行の中身つきで並べる', () => {
  const session = run(LISTED, 'majjmb:marks<CR>');
  assert.equal(session.markLists.length, 1);

  assert.deepEqual(session.markLists[0], [
    { name: 'a', line: 0, character: 0, text: 'first line' },
    { name: 'b', line: 2, character: 0, text: 'third line' }
  ]);
});

test(':marks は名前順に並ぶ', () => {
  const session = run(LISTED, 'mzjmajma:marks<CR>');
  assert.deepEqual(
    session.markLists[0]?.map(entry => entry.name),
    ['a', 'z']
  );
});

test(':marks は直前の位置も載せる', () => {
  // ガターには出さないが、一覧では「どこから飛んできたか」が有用なので載せる。
  const session = run(LISTED, 'jmaG:marks<CR>');
  const names = session.markLists[0]?.map(entry => entry.name) ?? [];
  assert.ok(names.includes('`'), '一覧には直前の位置が含まれる');
  assert.ok(names.includes('a'));
});

test('マークが1つもなければ一覧を出さずに知らせる', () => {
  const session = run(LISTED, ':marks<CR>');
  assert.deepEqual(session.markLists, []);
  assert.deepEqual(session.messages, ['No marks set']);
});

test(':marks は本文もカーソルも動かさない', () => {
  const session = run(LISTED, 'ma:marks<CR>', { cursor: pos(1, 3) });
  assert.equal(session.text, LISTED);
  assert.equal(session.at, '1:3');
  assert.equal(session.mode, 'normal');
});

test('マークが消えた行を指していても一覧は落ちない', () => {
  // 追従しない割り切りの結果、行番号がバッファ外を指しうる。
  const session = run('a\nb\nc\nd\ne', 'GmaggdGdd:marks<CR>');
  assert.equal(session.markLists.length, 1);
  assert.equal(session.markLists[0]?.length, 2);
});

/** What `:marks` still lists, which is the readable way to see what was deleted. */
function remaining(keys: string): string[] {
  const session = run(LISTED, `${keys}:marks<CR>`);
  return (session.markLists[0] ?? []).map(entry => entry.name);
}

test(':delmarks は名指しでマークを消す', () => {
  assert.deepEqual(remaining('majmbjmc:delmarks b<CR>'), ['a', 'c']);
});

test(':delmarks は複数の名前を取る', () => {
  assert.deepEqual(remaining('majmbjmc:delmarks a c<CR>'), ['b']);
  assert.deepEqual(remaining('majmbjmc:delmarks ac<CR>'), ['b'], '空白なしでも同じ');
});

test(':delmarks は範囲を取る', () => {
  assert.deepEqual(remaining('majmbjmc:delmarks a-b<CR>'), ['c']);
  assert.deepEqual(remaining('majmbjmc:delmarks a-c<CR>'), []);
});

test(':delmarks! はすべての名前付きマークを消す', () => {
  assert.deepEqual(remaining('majmbjmc:delmarks!<CR>'), []);
});

test(':delmarks! は戻り先を残す', () => {
  // 戻り先は移動が勝手に付け直すもので、消しても意味がない。
  const names = remaining('jmaG:delmarks!<CR>');
  assert.deepEqual(names, ['`']);
  assert.equal(run(LISTED, 'jmaG:delmarks!<CR>``').at, '1:0', '`` はまだ効く');
});

test('消したマークへは移動しなくなる', () => {
  assert.equal(run(LISTED, 'majj:delmarks a<CR>`a').at, '2:0', 'カーソルはそのまま');
  assert.equal(run(LISTED, 'majj`a').at, '0:0', '消す前は戻れる');
});

test(':delm と省略しても同じ', () => {
  assert.deepEqual(remaining('majmb:delm a<CR>'), ['b']);
  assert.deepEqual(remaining('majmb:delm!<CR>'), []);
});

test(':delmarks は引数がないと断る', () => {
  const session = run(LISTED, 'ma:delmarks<CR>');
  assert.deepEqual(session.messages, ['E471: Argument required']);
  assert.deepEqual(remaining('ma:delmarks<CR>'), ['a'], 'マークは残ったまま');
});

test(':delmarks! に引数は付けられない', () => {
  const session = run(LISTED, 'ma:delmarks! a<CR>');
  assert.match(session.messages[0] ?? '', /^E475: Invalid argument/);
  assert.deepEqual(remaining('ma:delmarks! a<CR>'), ['a'], '断ったなら消してはいけない');
});

test('マーク名にならない引数は断る', () => {
  for (const argument of ['A', '1', 'a-', 'c-a', 'a-1']) {
    const session = run(LISTED, `ma:delmarks ${argument}<CR>`);
    assert.match(session.messages[0] ?? '', /^E475: Invalid argument/, argument);
    assert.deepEqual(remaining(`ma:delmarks ${argument}<CR>`), ['a'], argument);
  }
});

test('付けていないマークを消しても何も起きない', () => {
  const session = run(LISTED, 'ma:delmarks z<CR>');
  assert.deepEqual(session.messages, []);
  assert.deepEqual(remaining('ma:delmarks z<CR>'), ['a']);
});
