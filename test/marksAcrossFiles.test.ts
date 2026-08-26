import assert from 'node:assert/strict';
import test from 'node:test';
import { Action } from '../src/core/actions';
import { LinesBuffer } from '../src/core/buffer';
import { VimEngine, VimState, createState } from '../src/core/engine';
import { Mode, Position, pos } from '../src/core/types';

/**
 * ファイルを横断するマーク (issue #58) のうち、エンジンが受け持つ部分。
 *
 * ここは `run` ヘルパでは書けません。ヘルパは1つのバッファしか持たず、`run` ごとに
 * エンジンも作り直すためです。マークが「別のファイルにある」状態を作るには、同じ
 * エンジンに id の違うバッファを渡す必要があります。
 */

/** 1つのエンジンに複数のバッファを渡せる、最小限の駆動役。 */
class Session {
  private readonly engine = new VimEngine();
  private state: VimState = createState('normal');
  public actions: Action[] = [];

  public feed(buffer: LinesBuffer, cursor: Position, keys: string, mode: Mode = 'normal'): void {
    this.state = { ...this.state, mode };
    this.actions = [];
    let at = cursor;
    for (const key of tokenize(keys)) {
      const result = this.engine.handleKey(this.state, key, buffer, at);
      this.state = result.state;
      this.actions.push(...result.actions);
      for (const action of result.actions) {
        if (action.type === 'setCursor') at = action.position;
      }
    }
  }

  public opened(): Extract<Action, { type: 'openFile' }> | undefined {
    return this.actions.find((action): action is Extract<Action, { type: 'openFile' }> =>
      action.type === 'openFile'
    );
  }

  public messages(): string[] {
    return this.actions.filter(action => action.type === 'notify').map(action => action.message);
  }
}

/** `<CR>` のような山括弧の綴りを1キーとして扱う。ハーネスと同じ規則。 */
function tokenize(keys: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === '<') {
      const close = keys.indexOf('>', i);
      if (close !== -1) {
        tokens.push(keys.slice(i, close + 1));
        i = close;
        continue;
      }
    }
    tokens.push(keys[i]!);
  }
  return tokens;
}

const one = new LinesBuffer('one alpha\none beta\none gamma', '\n', 'file:///one.ts');
const two = new LinesBuffer('two alpha\ntwo beta\ntwo gamma', '\n', 'file:///two.ts');

test('別のファイルに付けたマークへ ` で飛べる', () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(0, 0), '`a');

  assert.deepEqual(session.opened(), {
    type: 'openFile',
    bufferId: 'file:///one.ts',
    position: pos(1, 4),
    toFirstNonBlank: false
  });
});

test("' なら別ファイルでも行頭の非空白へ", () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(0, 0), "'a");

  assert.equal(session.opened()?.toFirstNonBlank, true);
});

test('同じファイルのマークは今までどおり、ファイルを開かない', () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(one, pos(0, 0), '`a');

  assert.equal(session.opened(), undefined, 'ファイルは開かない');
});

test('同じ名前を別のファイルで付け直すと、後のほうが勝つ', () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(2, 2), 'ma');
  session.feed(one, pos(0, 0), '`a');

  assert.equal(session.opened()?.bufferId, 'file:///two.ts');
});

test('別ファイルのマークはオペレータと組み合わせられない', () => {
  // Vim も自前のファイル横断マーク (大文字) で同じく断ります。`d`A` は E20 を
  // 出して何も消しません。着地点が分からないまま削除するより、断るほうがましです。
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(0, 0), 'd`a');

  assert.equal(session.opened(), undefined, 'ファイルも開かない');
  assert.equal(session.actions.filter(a => a.type === 'edit').length, 0, '何も消さない');
  assert.match(session.messages()[0] ?? '', /別のファイル.*オペレータ/);
});

test('Visual モードでも別ファイルへは伸ばせない', () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(0, 0), '`a', 'visual');

  assert.equal(session.opened(), undefined);
  assert.match(session.messages()[0] ?? '', /別のファイル.*Visual/);
});

test('飛ぶ前の位置は、離れるファイル側の ` に残る', () => {
  // そのファイルへ戻ってきたときに `` で元の場所へ帰れるようにするためです。
  const session = new Session();
  session.feed(one, pos(2, 0), 'ma');
  session.feed(two, pos(1, 5), '`a');

  session.feed(two, pos(0, 0), '``');
  assert.equal(session.opened(), undefined, '同じファイル内なので開き直さない');
});

test('`:marks` は別ファイルのマークも並べ、そのファイルを名指しする', () => {
  const session = new Session();
  session.feed(one, pos(1, 4), 'ma');
  session.feed(two, pos(0, 2), 'mb');
  session.feed(two, pos(0, 0), ':marks<CR>');

  const listing = session.actions.find(action => action.type === 'showMarks');
  assert.ok(listing && listing.type === 'showMarks');
  assert.deepEqual(listing.entries, [
    { name: 'a', line: 1, character: 4, bufferId: 'file:///one.ts', text: '' },
    { name: 'b', line: 0, character: 2, bufferId: 'file:///two.ts', text: 'two alpha' }
  ]);
});
