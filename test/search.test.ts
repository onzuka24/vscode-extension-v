import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `/` `?` `n` `N` `*` `#` です。入力欄は `:` と同じコマンドラインを使い、`<CR>` で確定します。
 *
 * パターンは JavaScript の正規表現です。Vim の方言 (`\v` `\<` `\{-}`) は解釈しません。
 * 中途半端に翻訳すると、意図と違うものに黙って一致するほうが厄介なためです。
 *
 * 検索は Vim の既定 (`wrapscan`) と同じく、端まで行くと反対側へ回り込みます。
 */

const TEXT = 'foo bar\nbaz foo\nqux';

test('/ で前方へ、? で後方へ移動する', () => {
  assert.equal(run(TEXT, '/foo<CR>').at, '1:4');
  assert.equal(run(TEXT, '?foo<CR>', { cursor: pos(1, 4) }).at, '0:0');
});

test('確定するまではステータスバーに出るだけ', () => {
  const session = run(TEXT, '/foo');
  assert.equal(session.mode, 'command');
  assert.equal(session.pending, '/foo');
  assert.equal(session.at, '0:0', 'まだ動かない');
});

test('端まで行くと反対側へ回り込む', () => {
  assert.equal(run(TEXT, '/foo<CR>', { cursor: pos(1, 4) }).at, '0:0');
  assert.equal(run(TEXT, '?foo<CR>').at, '1:4');
});

test('n と N は直前の検索を繰り返す', () => {
  const three = 'foo\nbar foo\nfoo';
  assert.equal(run(three, '/foo<CR>').at, '1:4');
  assert.equal(run(three, '/foo<CR>n').at, '2:0', 'n は同じ向きへ');
  assert.equal(run(three, '/foo<CR>N').at, '0:0', 'N は逆向きへ');

  assert.equal(run(three, '?foo<CR>').at, '2:0', '後方へ回り込む');
  assert.equal(run(three, '?foo<CR>n').at, '1:4', '? の後の n は後方へ続く');
  assert.equal(run(three, '?foo<CR>N').at, '0:0', 'N は前方へ回り込む');
});

test('カウントは何個目の一致かを指す', () => {
  const text = 'a x a x a x a';
  assert.equal(run(text, '/a<CR>').at, '0:4');
  assert.equal(run(text, '/a<CR>2n').at, '0:12');
  assert.equal(run(text, '3/a<CR>').at, '0:12', '打鍵の前のカウントも効く');
});

test('空のまま確定すると直前の検索を繰り返す', () => {
  assert.equal(run(TEXT, '/foo<CR>/<CR>').at, '0:0');
  assert.equal(run(TEXT, '/foo<CR>?<CR>').at, '0:0', '向きは打った記号で決まる');
});

test('* と # はカーソル下の単語を探す', () => {
  const text = 'foo bar\nbar foo\nfoo';
  assert.equal(run(text, '*').at, '1:4', '前方の foo へ');
  assert.equal(run(text, '#').at, '2:0', '後方へ回り込んで foo へ');
  assert.equal(run(text, '*n').at, '2:0', '* の後は n で続けられる');
});

test('* は単語全体に一致する', () => {
  // `\b` で囲むので、foobar の一部としての foo には止まりません。
  assert.equal(run('foo foobar\nfoo', '*').at, '1:0');
});

test('カーソルが空白の上なら、行の次の単語を探す', () => {
  assert.equal(run('  foo\nfoo', '*').at, '1:0');
});

test('オペレータと組み合わせられる', () => {
  // `/` の前に打ったキーは、パターンを覚えてから `n` として流し直されます。
  assert.equal(run('one two three', 'd/three<CR>').text, 'three');
  assert.equal(run('one two three', 'd/two<CR>').text, 'two three');
  assert.equal(run(TEXT, 'dn' /* 直前の検索なし */).text, TEXT);
  assert.equal(run('alpha beta alpha', '/alpha<CR>dn').text, 'alpha', 'n の位置まで削除して回り込む');
});

test('Visual モードでは選択が伸びる', () => {
  const session = run('one two three', 'v/three<CR>');
  assert.equal(session.mode, 'visual');
  assert.equal(session.at, '0:8');
  // Visual の選択は着地点の文字を含むので、`t` まで消えます。
  assert.equal(run('one two three', 'v/three<CR>d').text, 'hree');
});

test('検索を取り消せる', () => {
  const session = run(TEXT, '/foo<Esc>');
  assert.equal(session.mode, 'normal');
  assert.equal(session.at, '0:0');
  assert.equal(session.pending, '');
});

test('取り消すと開いたときのモードへ戻る', () => {
  assert.equal(run(TEXT, 'v/foo<Esc>').mode, 'visual');
  assert.equal(run(TEXT, 'V/foo<Esc>').mode, 'visual-line');
});

test('Backspace で消せる', () => {
  assert.equal(run(TEXT, '/fox<BS>o<CR>').at, '1:4');
  assert.equal(run(TEXT, '/f<BS><BS>').mode, 'normal', '記号まで消すと抜ける');
});

test('見つからないときは黙らずに知らせる', () => {
  const session = run(TEXT, '/zzz<CR>');
  assert.deepEqual(session.messages, ['E486: Pattern not found: zzz']);
  assert.equal(session.at, '0:0');
});

test('直前の検索がない n は、その旨を知らせる', () => {
  assert.deepEqual(run(TEXT, 'n').messages, ['E35: No previous regular expression']);
  assert.deepEqual(run(TEXT, '/<CR>').messages, ['E35: No previous regular expression']);
});

test('壊れた正規表現は拒む', () => {
  const session = run(TEXT, '/foo(<CR>');
  assert.deepEqual(session.messages, ['E383: Invalid search string: foo(']);
});

test('正規表現として解釈する', () => {
  assert.equal(run('foo123bar', '/[0-9]+<CR>').at, '0:3');
  assert.equal(run('a.b axb', '/a\\.b<CR>', { cursor: pos(0, 1) }).at, '0:0', 'エスケープが効く');
});

test('引数を1文字取るコマンドの途中では / を奪わない', () => {
  assert.equal(run('a/b', 'f/').at, '0:1');
  assert.equal(run('a/b', 'r/').text, '//b');
});

test('検索はバッファを変えない', () => {
  assert.equal(run(TEXT, '/foo<CR>').text, TEXT);
  assert.equal(run(TEXT, '*').text, TEXT);
});
