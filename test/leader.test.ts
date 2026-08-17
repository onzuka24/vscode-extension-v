import assert from 'node:assert/strict';
import test from 'node:test';
import { RemapTable } from '../src/core/remap';
import { run } from './harness';

/** The window and tab mappings from the author's init.vim, leader being Space. */
const INIT_VIM = {
  normal: [
    { before: ['<leader>', 'h'], commands: ['workbench.action.navigateLeft'] },
    { before: ['<leader>', 'j'], commands: ['workbench.action.navigateDown'] },
    { before: ['<leader>', 'k'], commands: ['workbench.action.navigateUp'] },
    { before: ['<leader>', 'l'], commands: ['workbench.action.navigateRight'] },
    { before: ['<leader>', 'o'], commands: ['workbench.action.nextEditor'] },
    { before: ['<leader>', 'y'], commands: ['workbench.action.previousEditor'] },
    { before: ['<leader>', 's'], commands: ['workbench.action.files.save'] },
    { before: ['<leader>', 'n'], commands: ['workbench.view.explorer'] },
    { before: ['<leader>', 'w', 'h'], commands: ['workbench.action.decreaseViewWidth'] },
    { before: ['<leader>', 'w', 'l'], commands: ['workbench.action.increaseViewWidth'] },
    { before: ['<leader>', 'w', 'w'], commands: ['workbench.action.evenEditorWidths'] }
  ]
};

test('leader は既定でスペースになる', () => {
  assert.deepEqual(run('abc', ' n', { remaps: INIT_VIM }).commands, ['workbench.view.explorer']);
  assert.deepEqual(run('abc', ' s', { remaps: INIT_VIM }).commands, ['workbench.action.files.save']);
});

test('leader だけでは何も起きず、次のキーを待つ', () => {
  const session = run('abc', ' ', { remaps: INIT_VIM });
  assert.deepEqual(session.commands, []);
  assert.equal(session.text, 'abc');
  assert.equal(session.pending, '␣', '待機中であることが表示に出る');
});

test('3打鍵の規則は2打鍵の接頭辞を越えて解決する', () => {
  const afterTwo = run('abc', ' w', { remaps: INIT_VIM });
  assert.deepEqual(afterTwo.commands, [], 'まだ確定しない');
  assert.equal(afterTwo.pending, '␣w');

  assert.deepEqual(run('abc', ' wh', { remaps: INIT_VIM }).commands, [
    'workbench.action.decreaseViewWidth'
  ]);
  assert.deepEqual(run('abc', ' ww', { remaps: INIT_VIM }).commands, [
    'workbench.action.evenEditorWidths'
  ]);
});

test('確定したら待機表示は消える', () => {
  assert.equal(run('abc', ' wh', { remaps: INIT_VIM }).pending, '');
});

test('leader から始まらない打鍵は素通りする', () => {
  // ` ` で始まる規則しかないので、x は通常どおり1文字削除になる。
  assert.equal(run('abc', 'x', { remaps: INIT_VIM }).text, 'bc');
});

test('leader 直後に未定義のキーが来たら両方とも打鍵どおりに流れる', () => {
  // ` ` と `x` が順に流れ、スペースは何のコマンドでもないので捨てられ、x が効く。
  const session = run('abc', ' x', { remaps: INIT_VIM });
  assert.equal(session.text, 'bc');
  assert.deepEqual(session.commands, []);
});

test('leader は設定で変えられる', () => {
  const remaps = {
    leader: ',',
    normal: [{ before: ['<leader>', 'n'], commands: ['workbench.view.explorer'] }]
  };
  assert.deepEqual(run('abc', ',n', { remaps }).commands, ['workbench.view.explorer']);
  assert.deepEqual(run('abc', ' n', { remaps }).commands, [], 'スペースはもう leader ではない');
});

test('leader は <Space> とも書ける', () => {
  const remaps = {
    leader: '<Space>',
    normal: [{ before: ['<leader>', 'n'], commands: ['workbench.view.explorer'] }]
  };
  assert.deepEqual(run('abc', ' n', { remaps }).commands, ['workbench.view.explorer']);
});

test('<Space> は leader を介さずそのまま書ける', () => {
  const remaps = { normal: [{ before: ['<Space>', 'q'], commands: ['noop'] }] };
  assert.deepEqual(run('abc', ' q', { remaps }).commands, ['noop']);
});

test('after 側の <leader> も解決されるが、展開結果は再リマップされない', () => {
  const remaps = {
    leader: ',',
    normal: [
      { before: ['q'], after: ['<leader>', 'n'] },
      { before: ['<leader>', 'n'], commands: ['workbench.view.explorer'] }
    ]
  };

  const { table, problems } = RemapTable.from(remaps);
  assert.deepEqual(problems, []);
  const match = table.match(['q'], 'normal');
  assert.deepEqual(match.kind === 'exact' ? match.rule.after : undefined, [',', 'n'], '<leader> は解決される');

  // ただし展開結果は再びリマップされないので、`,n` は解釈されず捨てられる。
  assert.deepEqual(run('abc', 'q', { remaps }).commands, []);
});

test('解釈できない leader は報告され、既定に戻る', () => {
  const { table, problems } = RemapTable.from({
    leader: '<nope>',
    normal: [{ before: ['<leader>', 'n'], commands: ['noop'] }]
  });
  assert.equal(problems.length, 1);
  assert.ok(problems[0]?.includes('vimLike.leader'));
  assert.equal(table.leader, ' ');
});

test('leader に特殊キーは指定できない', () => {
  const { problems } = RemapTable.from({ leader: '<Esc>' });
  assert.equal(problems.length, 1);
});

test('コマンド待機中のキーも表示される', () => {
  assert.equal(run('abc', 'd', {}).pending, 'd', 'オペレータ待ちも見える');
  assert.equal(run('abc', '2d', {}).pending, '2d');
});

test('Visual モードでも leader が効く', () => {
  const remaps = {
    visual: [{ before: ['<leader>', 'd'], commands: ['editor.action.clipboardCutAction'] }]
  };
  assert.deepEqual(run('hello', 'vl d', { remaps }).commands, ['editor.action.clipboardCutAction']);
});
