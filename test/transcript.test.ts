import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTranscriptEntry, keepTail, plainTerminalText } from '../src/adapter/transcript';

const ESC = '\x1b';

test('色の指定は取り除かれる', () => {
  assert.equal(plainTerminalText(`${ESC}[32mok${ESC}[0m`), 'ok');
  assert.equal(plainTerminalText(`${ESC}[1;31mFAIL${ESC}[m more`), 'FAIL more');
});

test('カーソル移動や行消去も取り除かれる', () => {
  assert.equal(plainTerminalText(`a${ESC}[2Kb`), 'ab');
  assert.equal(plainTerminalText(`${ESC}[?25lhidden${ESC}[?25h`), 'hidden');
});

test('ウィンドウタイトルやハイパーリンク (OSC) も取り除かれる', () => {
  assert.equal(plainTerminalText(`${ESC}]0;my title\x07text`), 'text');
  assert.equal(plainTerminalText(`${ESC}]8;;http://example.com${ESC}\\link`), 'link');
});

test('進捗表示は最後に表示されていた状態だけ残る', () => {
  // \r で行頭に戻って上書きするので、途中の状態を全部残すと読めなくなる。
  assert.equal(plainTerminalText('10%\r50%\r100%'), '100%');
  assert.equal(plainTerminalText('aaaaa\rbb'), 'bbaaa', '上書きは覆った分だけ');
});

test('改行コードは LF に揃える', () => {
  assert.equal(plainTerminalText('a\r\nb\r\nc'), 'a\nb\nc');
});

test('装飾のない出力はそのまま', () => {
  assert.equal(plainTerminalText('  2 passing\n  1 failing'), '  2 passing\n  1 failing');
});

test('長い出力は末尾を残す', () => {
  const text = ['first', 'second', 'third', 'fourth'].join('\n');
  // 末尾14文字は "d\nthird\nfourth" だが、頭の欠けた行は落とす。
  const { text: kept, truncated } = keepTail(text, 14);
  assert.equal(truncated, true);
  assert.equal(kept, 'third\nfourth', '行の途中からではなく行頭から始まる');
});

test('収まる出力はそのまま返る', () => {
  const { text, truncated } = keepTail('short', 100);
  assert.equal(text, 'short');
  assert.equal(truncated, false);
});

test('1回の実行は区切り線つきの記録になる', () => {
  const entry = formatTranscriptEntry('npm test', '# tests 267\n# fail 0\n\n');
  assert.equal(entry, '\n\u2500\u2500\u2500 $ npm test\n# tests 267\n# fail 0\n');
});

test('出力が空でも形は崩れない', () => {
  assert.equal(formatTranscriptEntry('true', ''), '\n\u2500\u2500\u2500 $ true\n\n');
});
