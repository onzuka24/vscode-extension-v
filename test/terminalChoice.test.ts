import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalChoice, describeTerminal } from '../src/adapter/terminalChoice';

/**
 * `<leader>R` の一覧に出る文字列 (issue #41)。
 *
 * シェル統合の有無をここに出すのが要点です。無い相手に送るとコマンドは動くのに
 * 出力だけが取り込めず、黙って何も追記されません。選ぶ時点で見えていれば、
 * 「知って選んだ」のか「気づかなかった」のかが分かれます。
 */

function choice(extra: Partial<TerminalChoice> = {}): TerminalChoice {
  return { name: 'zsh', shell: 'zsh', hasShellIntegration: true, isCurrent: false, ...extra };
}

test('シェルとシェル統合の有無が並ぶ', () => {
  assert.deepEqual(describeTerminal(choice()), {
    label: 'zsh',
    description: 'zsh · シェル統合あり'
  });
});

test('シェル統合が無いことは理由まで書く', () => {
  // 「なし」だけでは何が困るのか伝わりません。
  assert.deepEqual(describeTerminal(choice({ hasShellIntegration: false })), {
    label: 'zsh',
    description: 'zsh · シェル統合なし (出力を取り込めません)'
  });
});

test('シェルが分からないときも黙らない', () => {
  // state.shell は開いた直後や未対応のシェルで undefined になります。
  assert.equal(describeTerminal(choice({ shell: undefined })).description, 'シェル不明 · シェル統合あり');
});

test('現在の送り先には印が付く', () => {
  assert.equal(
    describeTerminal(choice({ isCurrent: true })).description,
    'zsh · シェル統合あり · 現在の送り先'
  );
});

test('名前はそのまま出す', () => {
  // ターミナルの名前は利用者が付け替えられるので、こちらで加工しません。
  assert.equal(describeTerminal(choice({ name: 'dev server' })).label, 'dev server');
});

test('サブシェルも検出されたとおりに出す', () => {
  // zsh の中で node を起動すると state.shell は 'node' に変わります。
  assert.equal(describeTerminal(choice({ name: 'zsh', shell: 'node' })).description, 'node · シェル統合あり');
});
