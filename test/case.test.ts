import assert from 'node:assert/strict';
import test from 'node:test';
import { LinesBuffer } from '../src/core/buffer';
import { applyCase } from '../src/core/case';
import { Target } from '../src/core/operators';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `gu` `gU` `g~` と、Visual モードの `u` `U` `~`。
 *
 * 期待値はすべて Vim 9.1 (`vim -u NONE -N`) で実測したものです。とくにカーソルの
 * 着地点は Normal と Visual で違い、推測では当たりません。インデントのある行で
 * `guu` は先頭の非空白へ、`Vu` は列0へ行きます。
 */

// --------------------------------------------------------------- Visual モード

test('Visual モードの ~ は選択範囲を反転する', () => {
  // これが issue #25 の本体。以前は選択を見ずカーソル位置だけ変えていた。
  const session = run('hello world', 'vll~');
  assert.equal(session.text, 'HELlo world');
  assert.equal(session.at, '0:0', 'カーソルは選択の先頭へ');
  assert.equal(session.mode, 'normal', 'Vim と同じく Normal へ戻る');
});

test('Visual モードの u は選択範囲を小文字にする', () => {
  const session = run('HELLO world', 'vllu');
  assert.equal(session.text, 'helLO world');
  assert.equal(session.mode, 'normal');
});

test('Visual モードの U は選択範囲を大文字にする', () => {
  assert.equal(run('hello world', 'vllU').text, 'HELlo world');
});

test('Visual モードの u は undo にならない', () => {
  // Normal モードの u は undo なので、モードで行き先が変わることを固定する。
  assert.deepEqual(run('HELLO', 'vllu').commands, [], 'undo は呼ばれない');
  assert.deepEqual(run('HELLO', 'u').commands, ['undo'], 'Normal では undo のまま');
});

test('Visual モードでは行をまたいで選択できる', () => {
  const session = run('aaa\nbbb', 'vjlU');
  assert.equal(session.text, 'AAA\nBBb');
  assert.equal(session.at, '0:0');
});

test('o で両端を入れ替えたあとの範囲に効く', () => {
  // v で0、ll で2、o で活性端が0へ、l で1。範囲は 1..2 の "el"。
  assert.equal(run('hello', 'vllolU').text, 'hELlo');
});

test('Visual Line では行全体に効き、カーソルは列0へ行く', () => {
  const session = run('    HELLO\nX', 'Vu');
  assert.equal(session.text, '    hello\nX');
  assert.equal(session.at, '0:0', 'Vim は Visual Line では列0に置く');
});

test('Visual Line で複数行', () => {
  const session = run('  aa\n  bb\ncc', 'VjU');
  assert.equal(session.text, '  AA\n  BB\ncc');
  assert.equal(session.at, '0:0');
});

test('Visual モードでも gu と書ける', () => {
  assert.equal(run('HELLO world', 'vllgu').text, 'helLO world');
  assert.equal(run('hello world', 'vllgU').text, 'HELlo world');
  assert.equal(run('Hello world', 'vllg~').text, 'hELlo world');
});

// ------------------------------------------------- Normal モードのオペレータ形

test('gU はモーションの範囲を大文字にする', () => {
  const session = run('one two three', 'gU2w');
  assert.equal(session.text, 'ONE TWO three');
  assert.equal(session.at, '0:0', 'カーソルは範囲の先頭へ');
});

test('gU はテキストオブジェクトと組める', () => {
  const session = run('hello world', 'wgUiw');
  assert.equal(session.text, 'hello WORLD');
  assert.equal(session.at, '0:6');
});

test('gu は小文字にする', () => {
  assert.equal(run('HELLO WORLD', 'gu$').text, 'hello world');
});

test('g~ は反転する', () => {
  assert.equal(run('Hello World', 'g~$').text, 'hELLO wORLD');
});

test('二重打ちは行全体になる', () => {
  assert.equal(run('HELLO WORLD\nSECOND', 'guu').text, 'hello world\nSECOND');
  assert.equal(run('hello world\nsecond', 'gUU').text, 'HELLO WORLD\nsecond');
  assert.equal(run('Hello World\nsecond', 'g~~').text, 'hELLO wORLD\nsecond');
});

test('gugu も guu と同じ', () => {
  // Vim はどちらの綴りも受け付ける。
  assert.equal(run('HELLO WORLD\nSECOND', 'gugu').text, 'hello world\nSECOND');
  assert.equal(run('hello\nsecond', 'gUgU').text, 'HELLO\nsecond');
});

test('行全体のときカーソルは先頭の非空白へ行く', () => {
  const session = run('    HELLO THERE\nX', 'guu');
  assert.equal(session.text, '    hello there\nX');
  assert.equal(session.at, '0:4', 'Visual Line の列0とは違う');
});

test('カウントは行数を指す', () => {
  assert.equal(run('AAA\nBBB\nCCC', '2guu').text, 'aaa\nbbb\nCCC');
  assert.equal(run('AAA\nBBB\nCCC', 'guj').text, 'aaa\nbbb\nCCC');
});

test('カウントが行数を超えても末尾で止まる', () => {
  assert.equal(run('AA\nBB', '10guu').text, 'aa\nbb');
});

test('動けないモーションでは何も起きない', () => {
  const session = run('hello', 'guk');
  assert.equal(session.text, 'hello');
  assert.equal(session.at, '0:0');
});

test('空行に打っても壊れない', () => {
  assert.equal(run('\nX', 'guu').text, '\nX');
});

test('すでにその大文字小文字でもカーソルは動く', () => {
  // Vim は変化がなくてもカーソルを範囲の先頭へ動かす。
  const session = run('hello WORLD', 'gUiw', { cursor: pos(0, 8) });
  assert.equal(session.text, 'hello WORLD');
  assert.equal(session.at, '0:6');
});

test('すでにその大文字小文字なら編集を出さない', () => {
  // 同じ文字列で置き換えるだけの編集も undo の履歴を1段消費してしまいます。
  // テキストが変わらないので harness からは見えず、ここで直接確かめます。
  const buffer = new LinesBuffer('HELLO', '\n');
  const target: Target = { kind: 'characterwise', range: { start: pos(0, 0), end: pos(0, 5) } };

  assert.equal(applyCase('gU', buffer, target, false).edit, null, '変化なし');
  assert.deepEqual(
    applyCase('gu', buffer, target, false).edit,
    { range: target.range, text: 'hello' },
    '変化があれば編集を出す'
  );
});

test('レジスタは書き換えない', () => {
  // d や y と違い、大文字小文字の変更はレジスタに触らない。
  assert.equal(run('one\nTWO', 'yyjgUUP').text, 'one\none\nTWO', 'yy の中身が残っている');
});

test('. で繰り返せる', () => {
  assert.equal(run('aa bb cc', 'gUiww.').text, 'AA BB cc');
});

// ------------------------------------------------- Normal モードの ~ （既存の形）

test('Normal モードの ~ は1文字だけ変えて右へ進む', () => {
  const session = run('hello', '~');
  assert.equal(session.text, 'Hello');
  assert.equal(session.at, '0:1');
});

test('Normal モードの ~ はカウントを取る', () => {
  const session = run('hello', '3~');
  assert.equal(session.text, 'HELlo');
  assert.equal(session.at, '0:3');
});

test('Normal モードの ~ は行末で止まる', () => {
  const session = run('abc', '9~');
  assert.equal(session.text, 'ABC');
  assert.equal(session.at, '0:2');
});

// ----------------------------------------------------------------- 文字の扱い

test('大文字小文字を持たない文字は素通りする', () => {
  assert.equal(run('あいueo', 'gUiw').text, 'あいUEO');
  assert.equal(run('a1-b2', 'gU$').text, 'A1-B2');
});

test('ラテン以外の文字にも効く', () => {
  assert.equal(run('привет', 'gU$').text, 'ПРИВЕТ');
  assert.equal(run('café', 'gU$').text, 'CAFÉ');
});

test('長さが変わる変換は行わない', () => {
  // JavaScript は 'ß' を 'SS' にするが、それでは以降の列がずれる。Vim は
  // 単一の 'ẞ' に変えるので、どちらとも違うがそのまま残すほうを選んでいる。
  assert.equal(run('straße', 'gU$').text, 'STRAßE');
});

test('サロゲートペアを割らない', () => {
  assert.equal(run('a😀b', 'gU$').text, 'A😀B');
});

// --------------------------------------------------------------------- パーサ

test('g だけでは待機する', () => {
  assert.equal(run('hello', 'g').pending, 'g');
  assert.equal(run('hello', 'gu').pending, 'gu');
  assert.equal(run('hello', 'gU').pending, 'gU');
});

test('g で始まる既存のモーションを壊さない', () => {
  assert.equal(run('aaa\nbbb\nccc', 'gg', { cursor: pos(2, 0) }).at, '0:0');
  assert.equal(run('AAA\nBBB\nCCC', 'gugg', { cursor: pos(2, 0) }).text, 'aaa\nbbb\nccc');
});

test('解釈できない綴りは捨てられる', () => {
  const session = run('hello', 'guq');
  assert.equal(session.text, 'hello', 'バッファには入らない');
  assert.equal(session.pending, '', '待機も残らない');
});
