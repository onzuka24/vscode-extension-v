import assert from 'node:assert/strict';
import test from 'node:test';
import { VimEngine } from '../src/core/engine';
import { RegisterStore } from '../src/core/registers';
import { run } from './harness';

/**
 * 既定のレジスタを OS のクリップボードにできるようにした話 (issue #59)。
 *
 * Vim の `clipboard=unnamed` に相当します。クリップボードの API は非同期で、
 * エンジンは同期の純粋関数なので、コアはクリップボードを「普通のレジスタ」として
 * 扱い、外の世界との同期はアダプタに任せる形にしています。
 */

const CLIP = { defaultRegister: '+' } as const;

// ------------------------------------------------------------- 既定の切り替え

test('既定のままならクリップボードには触らない', () => {
  const session = run('alpha\nbeta', 'yy');
  assert.deepEqual(session.clipboardWrites, []);
});

test('clipboard を選ぶと、ヤンクがクリップボードへ出る', () => {
  const session = run('alpha\nbeta', 'yy', CLIP);
  assert.deepEqual(session.clipboardWrites, ['alpha\n']);
});

test('削除も同じくクリップボードへ出る', () => {
  assert.deepEqual(run('alpha\nbeta', 'dd', CLIP).clipboardWrites, ['alpha\n']);
  assert.deepEqual(run('hello', 'dw', CLIP).clipboardWrites, ['hello']);
  assert.deepEqual(run('hello', 'x', CLIP).clipboardWrites, ['h']);
  assert.deepEqual(run('hello', 's', CLIP).clipboardWrites, ['h']);
});

test('貼り付けはクリップボードから読む', () => {
  const session = run('alpha', 'p', { ...CLIP, clipboard: 'outside' });
  assert.equal(session.text, 'aoutsidelpha');
});

test('外から来た行末改行つきの文字列は行として貼られる', () => {
  // クリップボードは文字列しか運ばないので、行かどうかは推測になります。
  // 改行で終わっていれば行、というのが Vim の規則です。
  const session = run('alpha\nbeta', 'p', { ...CLIP, clipboard: 'inserted\n' });
  assert.equal(session.text, 'alpha\ninserted\nbeta');
});

test('自分で書いたクリップボードは行かどうかを覚えている', () => {
  // yy した内容をそのまま p で貼るときに、行として貼られなければ困ります。
  const session = run('alpha\nbeta', 'yyjp', CLIP);
  assert.equal(session.text, 'alpha\nbeta\nalpha');
});

// --------------------------------------------------- 名指しした指定が優先される

test('名前付きレジスタを指定すればクリップボードには出ない', () => {
  const session = run('alpha\nbeta', '"ayy', CLIP);
  assert.deepEqual(session.clipboardWrites, [], 'a はこの拡張機能のレジスタ');
});

test('"+ と "* は既定に関わらずクリップボード', () => {
  assert.deepEqual(run('alpha\nbeta', '"+yy').clipboardWrites, ['alpha\n']);
  assert.deepEqual(run('alpha\nbeta', '"*yy').clipboardWrites, ['alpha\n']);
});

test('"+ と "* は同じ場所を指す', () => {
  const session = run('alpha\nbeta', '"+yyj"*p');
  assert.equal(session.text, 'alpha\nbeta\nalpha');
});

test('既定がクリップボードでも "a で普通のレジスタが使える', () => {
  const session = run('alpha\nbeta', '"ayyj"ap', CLIP);
  assert.equal(session.text, 'alpha\nbeta\nalpha');
});

// ----------------------------------------------------------- Visual モードの p

test('Visual の p は置き換えた内容をクリップボードへ出す', () => {
  // Vim と同じく、貼り付けで消えたほうがレジスタに入ります。
  const session = run('hello', 'vl p', { ...CLIP, clipboard: 'XY' });
  assert.deepEqual(session.clipboardWrites, ['he']);
});

// ------------------------------------------------ アダプタが読むべきかの判定

test('クリップボードを読む必要があるかを、貼り付け前に判断できる', () => {
  // アダプタはこれを見て、p の直前だけクリップボードを取りに行きます。
  // 毎打鍵で取ると、1文字打つたびに IPC の往復が増えてしまいます。
  const plain = new VimEngine();
  assert.equal(plain.pasteWouldReadClipboard(undefined), false);
  assert.equal(plain.pasteWouldReadClipboard('+'), true, '名指しなら既定に関わらず必要');
  assert.equal(plain.pasteWouldReadClipboard('*'), true);

  const clip = new VimEngine();
  clip.setDefaultRegister('+');
  assert.equal(clip.pasteWouldReadClipboard(undefined), true);
  assert.equal(clip.pasteWouldReadClipboard('a'), false, '名指しの a はクリップボードではない');
});

// ----------------------------------------------------------- レジスタの保管庫

test('書き込みがクリップボード行きかどうかを返す', () => {
  const registers = new RegisterStore();
  assert.equal(registers.write(undefined, { text: 'x', kind: 'characterwise' }), false);
  assert.equal(registers.write('a', { text: 'x', kind: 'characterwise' }), false);
  assert.equal(registers.write('+', { text: 'x', kind: 'characterwise' }), true);
  assert.equal(registers.write('*', { text: 'x', kind: 'characterwise' }), true);
});

test('大文字は追記のままで、クリップボードには出ない', () => {
  const registers = new RegisterStore();
  registers.write('a', { text: 'one', kind: 'characterwise' });
  assert.equal(registers.write('A', { text: 'two', kind: 'characterwise' }), false);
  assert.deepEqual(registers.read('a'), { text: 'onetwo', kind: 'characterwise' });
});

test('外から入ったクリップボードは、行かどうかを推測する', () => {
  const registers = new RegisterStore();
  registers.setClipboard('plain');
  assert.deepEqual(registers.read('+'), { text: 'plain', kind: 'characterwise' });

  registers.setClipboard('a line\n');
  assert.deepEqual(registers.read('+'), { text: 'a line\n', kind: 'linewise' });
});

test('自分が書いた内容が返ってきたら、推測せず覚えたほうを使う', () => {
  const registers = new RegisterStore();
  registers.write('+', { text: 'no trailing newline', kind: 'linewise' });
  registers.setClipboard('no trailing newline');
  assert.deepEqual(registers.read('+'), { text: 'no trailing newline', kind: 'linewise' });
});

test('クリップボードへの書き込みは無名レジスタも更新する', () => {
  const registers = new RegisterStore();
  registers.write('+', { text: 'x', kind: 'characterwise' });
  assert.deepEqual(registers.read(undefined), { text: 'x', kind: 'characterwise' });
});
