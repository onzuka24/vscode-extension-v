import assert from 'node:assert/strict';
import test from 'node:test';
import { RemapTable } from '../src/core/remap';
import { pos } from '../src/core/types';
import { run } from './harness';

/** The mappings this feature exists for, taken from the author's init.vim. */
const INIT_VIM = {
  normal: [
    { before: ['H'], after: ['^'] },
    { before: ['J'], after: ['1', '0', 'j'] },
    { before: ['K'], after: ['1', '0', 'k'] },
    { before: ['L'], after: ['$'] },
    { before: ['U'], after: ['<C-r>'] }
  ],
  visual: [
    { before: ['H'], after: ['^'] },
    { before: ['J'], after: ['1', '0', 'j'] },
    { before: ['K'], after: ['1', '0', 'k'] },
    { before: ['L'], after: ['$'] }
  ]
};

const TWENTY_LINES = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');

test('init.vim の H J K L がそのとおりに動く', () => {
  assert.equal(run('    indented', 'H', { cursor: pos(0, 9), remaps: INIT_VIM }).at, '0:4');
  assert.equal(run('hello', 'L', { remaps: INIT_VIM }).at, '0:4');
  assert.equal(run(TWENTY_LINES, 'J', { remaps: INIT_VIM }).at, '10:0');
  assert.equal(run(TWENTY_LINES, 'K', { cursor: pos(15, 0), remaps: INIT_VIM }).at, '5:0');
});

test('リマップがないときは Vim 既定のまま', () => {
  assert.equal(run('foo\n  bar', 'J').text, 'foo bar', 'J は行連結');
});

test('リマップは既定を置き換える', () => {
  assert.equal(run('foo\n  bar', 'J', { remaps: INIT_VIM }).text, 'foo\n  bar', '行連結は起きない');
});

test('<C-r> への展開は redo コマンドになる', () => {
  assert.deepEqual(run('abc', 'U', { remaps: INIT_VIM }).commands, ['redo']);
});

test('commands 指定で VS Code のコマンドを直接呼べる', () => {
  const remaps = { normal: [{ before: ['g', 'n'], commands: ['workbench.view.explorer'] }] };
  const session = run('abc', 'gn', { remaps });
  assert.deepEqual(session.commands, ['workbench.view.explorer']);
  assert.equal(session.text, 'abc');
});

test('展開結果は再度リマップされない', () => {
  // x を dl に展開する。その l がさらに j に置き換わってしまうと dj となり、
  // 1文字ではなく2行が消える。nnoremap が非再帰であることの確認。
  const remaps = {
    normal: [
      { before: ['x'], after: ['d', 'l'] },
      { before: ['l'], after: ['j'] }
    ]
  };
  assert.equal(run('abc\ndef', 'x', { remaps }).text, 'bc\ndef');
});

test('複数キーの規則は次のキーを待つ', () => {
  const remaps = { normal: [{ before: ['g', 's'], after: ['d', 'd'] }] };
  assert.equal(run('one\ntwo', 'g', { remaps }).text, 'one\ntwo', 'g だけでは何も起きない');
  assert.equal(run('one\ntwo', 'gs', { remaps }).text, 'two');
});

test('規則に一致しなかった保留キーは打鍵どおりに流れる', () => {
  // gs を定義しても gg は壊れない。
  const remaps = { normal: [{ before: ['g', 's'], after: ['d', 'd'] }] };
  assert.equal(run('one\ntwo\nthree', 'gg', { cursor: pos(2, 0), remaps }).at, '0:0');
});

test('f の引数はリマップされない', () => {
  // J が 10j に割り当てられていても、fJ は文字 J を探す。
  assert.equal(run('aJb', 'fJ', { remaps: INIT_VIM }).at, '0:1');
});

test('r の引数はリマップされない', () => {
  assert.equal(run('abc', 'rJ', { remaps: INIT_VIM }).text, 'Jbc');
});

test('レジスタ名はリマップされない', () => {
  const remaps = { normal: [{ before: ['a'], after: ['b'] }] };
  const session = run('one\ntwo\nthree', '"ayyG"ap', { remaps });
  assert.equal(session.text, 'one\ntwo\nthree\none');
});

test('編集を含む展開は途中でバッファを読み直す', () => {
  // dd の直後の p は、削除後のバッファを見ないと正しい位置に貼れない。
  const remaps = { normal: [{ before: ['q'], after: ['d', 'd', 'p'] }] };
  assert.equal(run('one\ntwo\nthree', 'q', { remaps }).text, 'two\none\nthree');
});

test('Visual モードの規則は Visual モードでのみ効く', () => {
  assert.equal(run('hello world', 'vLd', { remaps: INIT_VIM }).text, '', 'L が $ として働く');

  const visualOnly = { visual: [{ before: ['x'], after: ['d'] }] };
  assert.equal(run('abc', 'x', { remaps: visualOnly }).text, 'bc', 'Normal では既定の x のまま');
});

test('Normal モードの規則は Visual モードに漏れない', () => {
  const normalOnly = { normal: [{ before: ['L'], after: ['$'] }] };
  assert.equal(run('hello world', 'vLd', { remaps: normalOnly }).text, 'ello world', 'L は無効なので l 相当も起きない');
});

test('Insert モードでは打った文字がそのまま入る', () => {
  assert.equal(run('', 'iJK<Esc>', { remaps: INIT_VIM }).text, 'JK');
});

test('壊れた規則は捨てられ、理由が報告される', () => {
  const { table, problems } = RemapTable.from({
    normal: [
      { before: [], after: ['j'] },
      { before: ['x'] },
      { before: ['y'], after: ['j'], commands: ['noop'] },
      { before: ['<C-q>'], after: ['j'] },
      { before: ['z'], after: ['<nope>'] },
      { before: ['g'], after: ['j'] }
    ]
  });

  assert.equal(problems.length, 5);
  assert.ok(problems[0]?.includes('before は空にできません'));
  assert.ok(problems[1]?.includes('after か commands'));
  assert.ok(problems[2]?.includes('after か commands'));
  assert.ok(problems[3]?.includes('<C-q>'));
  assert.ok(problems[4]?.includes('<nope>'));
  assert.equal(table.match(['g'], 'normal').kind, 'exact', '正しい規則だけが残る');
});

test('長い規則があるあいだ短い規則は待たされる', () => {
  const { table } = RemapTable.from({
    normal: [
      { before: ['g', 'w'], after: ['j'] },
      { before: ['g', 'w', 'h'], after: ['k'] }
    ]
  });
  assert.equal(table.match(['g', 'w'], 'normal').kind, 'prefix');
  assert.equal(table.match(['g', 'w', 'h'], 'normal').kind, 'exact');
});

test('キー名の綴りは大文字小文字を問わない', () => {
  const { table, problems } = RemapTable.from({ normal: [{ before: ['q'], after: ['<ESC>'] }] });
  assert.deepEqual(problems, []);
  const match = table.match(['q'], 'normal');
  assert.equal(match.kind === 'exact' ? match.rule.after?.[0] : undefined, '<Esc>');
});
