import assert from 'node:assert/strict';
import test from 'node:test';
import { LinesBuffer } from '../src/core/buffer';
import { ExternalCaret, clampCursor, shouldPullCaretBack } from '../src/core/cursor';
import { Mode, pos } from '../src/core/types';

/**
 * マウスや矢印キーで動いたキャレットを、モードの規則へ引き戻すかどうかの判断
 * (issue #30)。
 *
 * コマンドの側は昔から `readCursor` でクランプされているので、これは「画面に
 * 描かれるキャレット」だけの話です。行末の後ろに立ったまま `i` を押すと最後の
 * 文字の手前に入る、という食い違いをなくすのが目的です。
 */

/**
 * VS Code が置いた位置とモードから、判断材料を組み立てる。
 *
 * モードは `clampCursor` に渡した時点で使い切られ、`shouldPullCaretBack` には
 * 渡りません。アダプタの `readCursor` がやっているのと同じ順番です。
 */
function caret(
  text: string,
  active: { line: number; character: number },
  mode: Mode,
  extra: { caretCount?: number; hasSelection?: boolean } = {}
): ExternalCaret {
  const buffer = new LinesBuffer(text, '\n');
  return {
    active: pos(active.line, active.character),
    clamped: clampCursor(buffer, pos(active.line, active.character), mode),
    caretCount: extra.caretCount ?? 1,
    hasSelection: extra.hasSelection ?? false
  };
}

test('Normal モードで行末より後ろに立ったら引き戻す', () => {
  assert.equal(shouldPullCaretBack(caret('abc', { line: 0, character: 3 }, 'normal')), true);
  assert.deepEqual(caret('abc', { line: 0, character: 3 }, 'normal').clamped, pos(0, 2));
});

test('行の中に立っているなら何もしない', () => {
  assert.equal(shouldPullCaretBack(caret('abc', { line: 0, character: 1 }, 'normal')), false);
  assert.equal(shouldPullCaretBack(caret('abc', { line: 0, character: 2 }, 'normal')), false);
});

test('空行の列0は正しい位置なので触らない', () => {
  assert.equal(shouldPullCaretBack(caret('\nx', { line: 0, character: 0 }, 'normal')), false);
});

test('Insert モードでは行末の後ろが正しい位置', () => {
  // ここを引き戻すと、行末に文字を足せなくなります。判断しているのは
  // shouldPullCaretBack の分岐ではなく clampCursor で、Insert モードでは
  // 行の長さと同じ列を許すため、引き戻す先が今いる場所と一致します。
  const insert = caret('abc', { line: 0, character: 3 }, 'insert');
  assert.deepEqual(insert.clamped, pos(0, 3), 'Insert では行末の後ろが規則どおりの位置');
  assert.equal(shouldPullCaretBack(insert), false);

  // 同じ位置でも Normal モードなら引き戻す先が変わる。
  assert.deepEqual(caret('abc', { line: 0, character: 3 }, 'normal').clamped, pos(0, 2));
});

test('Visual モードでも引き戻す', () => {
  assert.equal(shouldPullCaretBack(caret('abc', { line: 0, character: 3 }, 'visual')), true);
  assert.equal(shouldPullCaretBack(caret('abc', { line: 0, character: 3 }, 'visual-line')), true);
});

test('複数キャレットには触らない', () => {
  // Cmd+D や Alt+クリックで作った複数キャレットを1つに畳んでしまいます。
  const many = caret('abc', { line: 0, character: 3 }, 'normal', { caretCount: 3 });
  assert.equal(shouldPullCaretBack(many), false);
});

test('選択があるときは触らない', () => {
  // ドラッグ選択・検索の一致・リネームの対象を消してしまいます。Vim の mouse=a
  // 相当（ドラッグで Visual モードへ）を入れるかは別の判断です。
  const dragged = caret('abc', { line: 0, character: 3 }, 'normal', { hasSelection: true });
  assert.equal(shouldPullCaretBack(dragged), false);
});

test('行をまたいだ位置でも行の範囲に収める', () => {
  const past = caret('ab\ncd', { line: 9, character: 0 }, 'normal');
  assert.deepEqual(past.clamped, pos(1, 0));
  assert.equal(shouldPullCaretBack(past), true);
});
