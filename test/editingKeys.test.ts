import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECIAL_KEYS, isSpecialKey, normalizeKey } from '../src/core/keys';
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

// ---------------------------------------------------------------------------
// Tab と Shift+Tab (issue #50)
// ---------------------------------------------------------------------------

/**
 * どちらも `type` を通らないので、受け止めないと VS Code の字下げがそのまま働き、
 * Normal モードなのにファイルが変わります。Vim では `<Tab>` はジャンプリストの
 * 前進、コマンドラインでは補完ですが、この拡張機能はどちらも持っていません。
 * 持つまでは「何もしない」が正しい動作で、素通しさせないことが要点です。
 */

test('Normal モードの Tab は字下げせず、何も変えない', () => {
  const session = run(TEXT, '<Tab>', { cursor: pos(1, 3) });
  assert.equal(session.text, TEXT);
  assert.equal(session.at, '1:3', 'カーソルも動かない');
  assert.equal(session.mode, 'normal');
});

test('Shift+Tab も同じく何も変えない', () => {
  const session = run(TEXT, '<S-Tab>', { cursor: pos(1, 3) });
  assert.equal(session.text, TEXT);
  assert.equal(session.at, '1:3');
});

test('Visual モードの Tab は選択範囲を字下げしない', () => {
  // 選択があると VS Code の Tab は選択行をまとめて下げます。ここが一番危険です。
  const session = run(TEXT, 'Vj<Tab>');
  assert.equal(session.text, TEXT);
  assert.deepEqual(session.indents, [], '字下げも要求しない');
  assert.equal(session.mode, 'visual-line', '選択も保たれる');
});

test('コマンドライン入力中の Tab は行を汚さない', () => {
  // 補完が無いので何も起きませんが、`<Tab>` という文字列が混ざるのは論外です。
  const session = run(TEXT, ':w<Tab>');
  assert.equal(session.pending, ':w', '打った内容そのまま');
  assert.equal(session.text, TEXT);

  // そのまま実行できる。
  assert.deepEqual(run(TEXT, ':w<Tab><CR>').commands, ['workbench.action.files.save']);
});

test('検索の入力中でも同じ', () => {
  assert.equal(run(TEXT, '/wor<Tab>').pending, '/wor');
  assert.equal(run(TEXT, '/wor<Tab>ld<CR>').at, '1:2');
});

test('打ちかけのコマンドは Tab で取り消される', () => {
  // 解釈できないキーが来たときの扱いと揃えています。
  const session = run(TEXT, 'd<Tab>');
  assert.equal(session.text, TEXT);
  assert.equal(session.pending, '', '保留が残らない');
});

test('Tab と Shift+Tab は別の特殊キーとして区別される', () => {
  // 同じ綴りに潰すと、Shift+Tab がパーサへ落ちて素通りしかねません。
  assert.notEqual(SPECIAL_KEYS.tab, SPECIAL_KEYS.shiftTab);
  assert.ok(isSpecialKey(SPECIAL_KEYS.tab));
  assert.ok(isSpecialKey(SPECIAL_KEYS.shiftTab));
});

test('設定では <Tab> <S-Tab> <Shift-Tab> と書ける', () => {
  assert.equal(normalizeKey('<Tab>', null), SPECIAL_KEYS.tab);
  assert.equal(normalizeKey('<tab>', null), SPECIAL_KEYS.tab);
  assert.equal(normalizeKey('<S-Tab>', null), SPECIAL_KEYS.shiftTab);
  assert.equal(normalizeKey('<Shift-Tab>', null), SPECIAL_KEYS.shiftTab);
});

test('リマップの綴りとしても書ける', () => {
  const remaps = { normal: [{ before: ['g', 't'], after: ['<Tab>'] }] };
  const session = run(TEXT, 'gt', { remaps });
  assert.equal(session.text, TEXT, '展開先が Tab でも本文は変わらない');
});

// ---------------------------------------------------------------------------
// 矢印キー (issue #64)
// ---------------------------------------------------------------------------

/**
 * 矢印も `type` を通らないので、放っておくと VS Code の `cursorLeft` などが働きます。
 * それらは行頭・行末で隣の行へ回り込むので、Vim とずれます。
 *
 * 期待値は Vim 9.1 の実測です。既定の `whichwrap` は `b,s`（Backspace と Space だけが
 * 回り込む）なので、4つとも `h` `l` `k` `j` とまったく同じ動きになります。
 */

const TWO = 'hello\nab\nworld';

test('行頭の左矢印は前の行へ回り込まない', () => {
  // これが issue #64 の本体。VS Code は 1:0 から 0:4 へ動かしてしまう。
  assert.equal(run(TWO, '<Left>', { cursor: pos(2, 0) }).at, '2:0');
  assert.equal(run(TWO, 'h', { cursor: pos(2, 0) }).at, '2:0', 'h と同じ');
});

test('行末の右矢印は次の行へ回り込まない', () => {
  assert.equal(run(TWO, '<Right>', { cursor: pos(0, 4) }).at, '0:4');
  assert.equal(run(TWO, 'l', { cursor: pos(0, 4) }).at, '0:4', 'l と同じ');
});

test('行の途中では普通に動く', () => {
  assert.equal(run(TWO, '<Left>', { cursor: pos(0, 3) }).at, '0:2');
  assert.equal(run(TWO, '<Right>', { cursor: pos(0, 1) }).at, '0:2');
  assert.equal(run(TWO, '<Down>', { cursor: pos(0, 1) }).at, '1:1');
  assert.equal(run(TWO, '<Up>', { cursor: pos(2, 1) }).at, '1:1');
});

test('上下の矢印は希望列を覚えている', () => {
  // 長い行から短い行へ降りて戻ると、元の列に帰ります。j / k と同じ扱いです。
  assert.equal(run(TWO, '<Down>', { cursor: pos(0, 4) }).at, '1:1', '短い行では末尾へ寄る');
  assert.equal(run(TWO, '<Down><Up>', { cursor: pos(0, 4) }).at, '0:4', '戻ると元の列へ');
});

test('矢印はカウントを取る', () => {
  assert.equal(run(TWO, '3<Right>', { cursor: pos(0, 0) }).at, '0:3');
  assert.equal(run('a\nb\nc\nd', '2<Down>').at, '2:0');
});

test('矢印はオペレータと組み合わせられる', () => {
  assert.equal(run('hello', 'd<Right>').text, 'ello');
  assert.equal(run('hello', 'd<Left>', { cursor: pos(0, 2) }).text, 'hllo');
  assert.equal(run('one\ntwo\nthree', 'd<Down>').text, 'three');
});

test('Visual モードでは選択が伸びる', () => {
  assert.equal(run('hello', 'v<Right><Right>d').text, 'lo');
});

test('コマンドライン入力中の矢印は行を汚さない', () => {
  // 回り込みより静かな壊れ方ですが、`:w` が `:wh` になるのは同じくらい困ります。
  assert.equal(run(TWO, ':w<Left>').pending, ':w');
  assert.deepEqual(run(TWO, ':w<Left><CR>').commands, ['workbench.action.files.save']);
  assert.equal(run(TWO, '/he<Up>').pending, '/he');
});

test('設定では <Left> <Down> などと書ける', () => {
  assert.equal(normalizeKey('<Left>', null), SPECIAL_KEYS.left);
  assert.equal(normalizeKey('<down>', null), SPECIAL_KEYS.down);
  assert.ok(isSpecialKey(SPECIAL_KEYS.up));
  assert.ok(isSpecialKey(SPECIAL_KEYS.right));
});
