import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

/**
 * `:` のコマンドラインです。入力欄はステータスバーで、フォーカスはエディターに残ります。
 * Enter と Backspace は `type` を通らないため `<CR>` `<BS>` として届きます (Escape と同じ道)。
 *
 * リマップから VS Code のコマンドを直接呼べるので、`:w` は保存する唯一の手段ではありません。
 * ここが引き受けているのは「つい `:w` と打ってしまう」ほうです。
 */

const LINES = 'one\ntwo\nthree\nfour';

test(': でコマンドラインモードに入り、打った文字が見える', () => {
  assert.equal(run(LINES, ':').mode, 'command');
  assert.equal(run(LINES, ':').pending, ':');
  assert.equal(run(LINES, ':wq').pending, ':wq');
  assert.equal(run(LINES, ':w').text, LINES, 'バッファには何も入らない');
});

test('Enter で実行し、Normal モードへ戻る', () => {
  const session = run(LINES, ':w<CR>');
  assert.deepEqual(session.commands, ['workbench.action.files.save']);
  assert.equal(session.mode, 'normal');
  assert.equal(session.pending, '');
});

test('init.vim が使う4つが揃っている', () => {
  assert.deepEqual(run(LINES, ':w<CR>').commands, ['workbench.action.files.save']);
  assert.deepEqual(run(LINES, ':sp<CR>').commands, ['workbench.action.splitEditorDown']);
  assert.deepEqual(run(LINES, ':vs<CR>').commands, ['workbench.action.splitEditor']);
  assert.deepEqual(run(LINES, ':tabnew<CR>').commands, ['workbench.action.files.newUntitledFile']);
});

test('反射的に打つ q 系も受け付ける', () => {
  assert.deepEqual(run(LINES, ':q<CR>').commands, ['workbench.action.closeActiveEditor']);
  assert.deepEqual(run(LINES, ':q!<CR>').commands, ['workbench.action.revertAndCloseActiveEditor']);
  assert.deepEqual(run(LINES, ':wq<CR>').commands, [
    'workbench.action.files.save',
    'workbench.action.closeActiveEditor'
  ]);
  assert.deepEqual(run(LINES, ':x<CR>').commands, run(LINES, ':wq<CR>').commands);
});

test('省略しない綴りでも同じ', () => {
  assert.deepEqual(run(LINES, ':write<CR>').commands, run(LINES, ':w<CR>').commands);
  assert.deepEqual(run(LINES, ':vsplit<CR>').commands, run(LINES, ':vs<CR>').commands);
});

test('数字は行番号への移動になる', () => {
  assert.equal(run(LINES, ':3<CR>').at, '2:0');
  assert.equal(run('one\n    two', ':2<CR>').at, '1:4', '行頭の非空白へ');
  assert.equal(run(LINES, ':999<CR>').at, '3:0', 'バッファの末尾で止まる');
  assert.equal(run(LINES, ':$<CR>').at, '3:0');
});

test('知らないコマンドは黙って消えず、Vim と同じ文言で知らせる', () => {
  const session = run(LINES, ':foo<CR>');
  assert.deepEqual(session.messages, ['E492: Not an editor command: foo']);
  assert.deepEqual(session.commands, []);
  assert.equal(session.mode, 'normal');
});

test('引数付きは受け付けない', () => {
  // `:w other.txt` を「別名で保存」と思って打った人が、黙って上書き保存されると困ります。
  assert.deepEqual(run(LINES, ':w other.txt<CR>').commands, []);
  assert.equal(run(LINES, ':w other.txt<CR>').messages.length, 1);
});

test(': だけで Enter を押しても何も起きない', () => {
  const session = run(LINES, ':<CR>');
  assert.deepEqual(session.commands, []);
  assert.deepEqual(session.messages, []);
  assert.equal(session.mode, 'normal');
});

test('Escape で取り消せる', () => {
  const session = run(LINES, ':wq<Esc>');
  assert.equal(session.mode, 'normal');
  assert.deepEqual(session.commands, []);
  assert.equal(session.pending, '');
});

test('Backspace で1文字消し、: まで消すとモードを抜ける', () => {
  assert.equal(run(LINES, ':wq<BS>').pending, ':w');
  assert.equal(run(LINES, ':wq<BS><BS>').pending, ':');
  assert.equal(run(LINES, ':w<BS><BS>').mode, 'normal');
  assert.deepEqual(run(LINES, ':w<BS>w<CR>').commands, ['workbench.action.files.save']);
});

test('コマンドラインの文字は Vim のコマンドとして解釈されない', () => {
  // `:dd` は「dd という Ex コマンド」であって、行の削除ではありません。
  const session = run(LINES, ':dd<CR>');
  assert.equal(session.text, LINES);
  assert.equal(session.messages.length, 1);
});

test('引数を1文字取るコマンドの途中では : を奪わない', () => {
  assert.equal(run('a:b', 'f:').at, '0:1', 'f の引数としてのコロン');
  assert.equal(run('a:b', 'r:', { cursor: pos(0, 0) }).text, '::b', 'r の引数としてのコロン');
});

test('Visual モードからも開ける', () => {
  const session = run(LINES, 'vj:w<CR>');
  assert.deepEqual(session.commands, ['workbench.action.files.save']);
  assert.equal(session.mode, 'normal');
});

test('コマンドラインの入力にはリマップがかからない', () => {
  // `w` を別のキーに割り当てている人でも、:w は :w のままです。
  const remaps = { normal: [{ before: ['w'], after: ['j'] }] };
  assert.deepEqual(run(LINES, ':w<CR>', { remaps }).commands, ['workbench.action.files.save']);
});

test('リマップから :w<CR> を展開できる', () => {
  // init.vim の `nnoremap <leader>s :w<enter>` をそのまま書けます。
  const remaps = { normal: [{ before: ['<leader>', 's'], after: [':', 'w', '<CR>'] }] };
  assert.deepEqual(run(LINES, ' s', { remaps }).commands, ['workbench.action.files.save']);
});

const CLOSE_ALL = 'workbench.action.closeAllEditors';
const SAVE_ALL = 'workbench.action.files.saveAll';

test(':qa はすべてのエディターを閉じる', () => {
  assert.deepEqual(run(LINES, ':qa<CR>').commands, [CLOSE_ALL]);
  assert.deepEqual(run(LINES, ':qall<CR>').commands, [CLOSE_ALL]);
});

test(':wqa と :xa はすべて保存してから閉じる', () => {
  assert.deepEqual(run(LINES, ':wqa<CR>').commands, [SAVE_ALL, CLOSE_ALL]);
  assert.deepEqual(run(LINES, ':xa<CR>').commands, [SAVE_ALL, CLOSE_ALL]);
  assert.deepEqual(run(LINES, ':wqall<CR>').commands, [SAVE_ALL, CLOSE_ALL]);
});

test(':qa! は :qa と同じで、未保存の確認は VS Code に任せる', () => {
  // 全体を破棄して閉じるコマンドが VS Code に存在しないため。
  // 断るよりは閉じて確認を出すほうがましだという判断で、README にも書いてある。
  assert.deepEqual(run(LINES, ':qa!<CR>').commands, [CLOSE_ALL]);
  assert.deepEqual(run(LINES, ':qa!<CR>').messages, [], '黙って別のことをするわけではない');
});

test('1つだけ閉じる :q と全部閉じる :qa は別物のまま', () => {
  assert.deepEqual(run(LINES, ':q<CR>').commands, ['workbench.action.closeActiveEditor']);
  assert.deepEqual(run(LINES, ':q!<CR>').commands, ['workbench.action.revertAndCloseActiveEditor']);
});

test('綴りを間違えれば従来どおり断る', () => {
  assert.deepEqual(run(LINES, ':qaa<CR>').commands, []);
  assert.match(run(LINES, ':qaa<CR>').messages[0] ?? '', /^E492/);
});
