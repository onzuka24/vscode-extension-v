import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileAiPanels } from '../src/core/aiPanels';
import { compileExCommands, parseExCommand } from '../src/core/excommands';
import { RemapConfiguration, RemapRule, RemapTable } from '../src/core/remap';
import { run } from './harness';
import { parseJsonc, withoutComments } from './jsonc';
import { isValidKeyBinding } from './keySyntax';

/**
 * The template in `examples/` is the one artefact a user copies verbatim, so a
 * stale key name there is as bad as a bug. Loading it through the real validator
 * on every CI run keeps it honest.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const source = readFileSync(path.join(ROOT, 'examples', 'settings.jsonc'), 'utf8');

interface Settings {
  'vimLike.leader': string;
  'vimLike.exCommands': Record<string, string[]>;
  'vimLike.aiPanels': unknown;
  'vimLike.normalModeKeyBindings': RemapRule[];
  'vimLike.visualModeKeyBindings': RemapRule[];
}

const settings = parseJsonc<Settings>(source);

const configuration: RemapConfiguration = {
  leader: settings['vimLike.leader'],
  normal: settings['vimLike.normalModeKeyBindings'],
  visual: settings['vimLike.visualModeKeyBindings']
};

test('テンプレートは設定として読み込める', () => {
  const { problems } = RemapTable.from(configuration);
  assert.deepEqual(problems, []);
});

test('テンプレートの規則はすべて after か commands を持つ', () => {
  const rules = [...configuration.normal!, ...configuration.visual!];
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    const kinds = [rule.after, rule.commands].filter(value => value !== undefined && value.length > 0);
    assert.equal(kinds.length, 1, `${rule.before.join('')} の指定が片方だけになっていません`);
  }
});

test('テンプレートの移動キーが init.vim どおりに動く', () => {
  const remaps = { ...configuration };
  const twentyLines = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');

  assert.equal(run('    indented', 'H', { cursor: pos0(9), remaps }).at, '0:4');
  assert.equal(run('hello', 'L', { remaps }).at, '0:4');
  assert.equal(run(twentyLines, 'J', { remaps }).at, '10:0');
  assert.equal(run(twentyLines, 'K', { cursor: { line: 15, character: 0 }, remaps }).at, '5:0');
});

test('テンプレートの leader マッピングが発火する', () => {
  const remaps = { ...configuration };
  assert.deepEqual(run('abc', ' s', { remaps }).commands, ['workbench.action.files.save']);
  assert.deepEqual(run('abc', ' wh', { remaps }).commands, ['workbench.action.decreaseViewWidth']);
  assert.deepEqual(run('abc', ' ww', { remaps }).commands, ['workbench.action.evenEditorWidths']);
  assert.deepEqual(run('abc', ' /', { remaps }).commands, ['actions.find']);
  assert.deepEqual(run('abc', ' c', { remaps }).commands, ['editor.action.commentLine']);
  assert.deepEqual(run('abc', ' e', { remaps }).commands, ['vimLike.sendToAIPanel']);
  assert.deepEqual(run('abc', ' r', { remaps }).commands, ['vimLike.sendToTerminal']);
  assert.deepEqual(run('abc', ' R', { remaps }).commands, ['vimLike.chooseTerminal']);
  assert.deepEqual(run('abc', ' E', { remaps }).commands, ['vimLike.chooseAIPanel']);
  assert.deepEqual(run('abc', ' n', { remaps }).commands, ['vimLike.toggleFileTree']);
});

test('テンプレートの AI パネルが読み込める', () => {
  const { panels, problems } = compileAiPanels(settings['vimLike.aiPanels']);
  assert.deepEqual(problems, []);
  assert.ok(panels.length > 0);
  // 送り先のコマンドは、こちらが選択範囲を合わせたうえで実行されるものだけです。
  assert.deepEqual(panels[0], { name: 'Claude Code', command: 'claude-vscode.focus' });
});

test('テンプレートの Ex コマンドが読み込める', () => {
  const { table, problems } = compileExCommands(settings['vimLike.exCommands']);
  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('gg', table), { kind: 'commands', commands: ['git-graph.view'] });
});

test('テンプレートの Visual モード側も効く', () => {
  const remaps = { ...configuration };
  assert.equal(run('hello world', 'vLd', { remaps }).text, '');
  assert.deepEqual(run('hello', 'v /', { remaps }).commands, ['actions.findWithSelection']);
  assert.deepEqual(run('hello', 'v c', { remaps }).commands, ['editor.action.commentLine']);
  assert.deepEqual(run('hello', 'v e', { remaps }).commands, ['vimLike.sendToAIPanel']);
});

test('テンプレートは Vim 既定のキーを壊さない', () => {
  const remaps = { ...configuration };
  assert.equal(run('hello world', 'dw', { remaps }).text, 'world');
  assert.equal(run('one\ntwo', 'dd', { remaps }).text, 'two');
  assert.equal(run('aJb', 'fJ', { remaps }).at, '0:1', 'f の引数は置き換えられない');

  // <leader>c を足しても、オペレータの c は c のままでなければなりません。
  const changed = run('hello world', 'cw', { remaps });
  assert.equal(changed.text, ' world');
  assert.equal(changed.mode, 'insert');
});

/**
 * <leader>/ を検索バーに割り当てても、`/` 単体はこちらの検索のままでなければ
 * なりません。leader はスペースなので両者は打鍵が隣り合っており、片方の割り当てが
 * もう片方を飲み込むと `d/foo` のような組み合わせが黙って死にます。
 */
test('テンプレートの <leader>/ は `/` 自体を奪わない', () => {
  const remaps = { ...configuration };
  const opened = run('hello world', '/', { remaps });
  assert.deepEqual(opened.commands, [], '検索バーは開かない');
  assert.equal(opened.mode, 'command', 'こちらの検索行が開く');

  assert.equal(run('hello world', 'd/world<CR>', { remaps }).text, 'world', 'オペレータと組める');
});

function pos0(character: number): { line: number; character: number } {
  return { line: 0, character };
}

// ---------------------------------------------------------------------------
// examples/*.json — 注釈を外した、貼り付ける用の双子
// ---------------------------------------------------------------------------

/**
 * 注釈つきの `.jsonc` は「なぜその割り当てなのか」を、注釈なしの `.json` は
 * 貼り付ける中身を受け持ちます。3行に2行が説明文だと貼るときに邪魔になるからです。
 *
 * 中身が同じであることを下で固定しているので、上のキー名や `when` を検証する
 * テストは両方を守っていることになります。二重に書く必要はありません。
 */
const PAIRS = ['settings', 'keybindings'] as const;

for (const name of PAIRS) {
  const annotated = readFileSync(path.join(ROOT, 'examples', `${name}.jsonc`), 'utf8');
  const plain = readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf8');

  test(`${name}.json は ${name}.jsonc と同じ内容になる`, () => {
    assert.deepEqual(parseJsonc(plain), parseJsonc(annotated));
  });

  test(`${name}.json にはコメントも空行もない`, () => {
    const lines = plain.split('\n').slice(0, -1);
    assert.ok(lines.length > 0);
    for (const [index, line] of lines.entries()) {
      assert.ok(line.trim() !== '', `${index + 1} 行目が空行です`);
      assert.ok(!line.trimStart().startsWith('//'), `${index + 1} 行目がコメントです`);
    }
  });

  test(`${name}.json は生成しなおしても同じになる`, () => {
    // 生成物なので手で直すと次の生成で消えます。ずれたら npm run examples です。
    assert.equal(plain, withoutComments(annotated), '`npm run examples` を実行してください');
  });

  test(`${name}.json は貼り付けても読める形を保っている`, () => {
    // JSON.stringify で作り直すと 1 規則が 4 行に散り、注釈つきより読みにくく
    // なります。行を削るだけにしているので、1 規則 1 行のままです。
    const rules = plain.split('\n').filter(line => line.trim().startsWith('{ "'));
    assert.ok(rules.length >= 8, `1 行に収まった規則が ${rules.length} 件しかありません`);
  });
}

// ---------------------------------------------------------------------------
// examples/keybindings.jsonc — リストを hjkl で操作するためのキーバインド例
// ---------------------------------------------------------------------------

interface KeyBinding {
  key: string;
  command: string;
  when?: string;
}

const keybindings = parseJsonc<KeyBinding[]>(
  readFileSync(path.join(ROOT, 'examples', 'keybindings.jsonc'), 'utf8')
);

test('キーバインド例はすべて VS Code が解釈できるキーを使う', () => {
  assert.ok(keybindings.length > 0);
  for (const binding of keybindings) {
    assert.ok(isValidKeyBinding(binding.key), `"${binding.key}" は ${binding.command} のキーとして無効です`);
  }
});

test('キーバインド例はどれも適用範囲を絞っている', () => {
  // when のないキーバインドは VS Code 全体で効いてしまいます。
  for (const binding of keybindings) {
    assert.ok(binding.when !== undefined && binding.when !== '', `${binding.key} に when がありません`);
  }
});

test('リスト操作のキーは入力欄にフォーカスがあるときは発火しない', () => {
  // これを忘れると、エクスプローラーのファイル名入力中に j が押せなくなります。
  const listBindings = keybindings.filter(
    binding => binding.when?.includes('filesExplorerFocus') || binding.when?.includes('listFocus')
  );
  assert.ok(listBindings.length > 0);
  for (const binding of listBindings) {
    assert.ok(binding.when?.includes('!inputFocus'), `${binding.key} に !inputFocus がありません`);
  }
});

test('同じキーを複数に割り当てる場合は条件が重ならない', () => {
  const byKey = new Map<string, string[]>();
  for (const binding of keybindings) {
    byKey.set(binding.key, [...(byKey.get(binding.key) ?? []), binding.when ?? '']);
  }

  for (const [key, conditions] of byKey) {
    if (conditions.length < 2) continue;

    assert.equal(new Set(conditions).size, conditions.length, `${key} に同じ条件の割り当てが重複しています`);

    // 往復させているキー (エディターと、それ以外の場所) は、エディター側が
    // ちょうど1つでなければどちらが動くか決まりません。
    const editorSide = conditions.filter(when => /(^|[^!])editorTextFocus/.test(when));
    if (editorSide.length > 0) {
      assert.equal(editorSide.length, 1, `${key} のエディター側の条件が1つになっていません`);
    }
  }
});

/**
 * 「見えているか」を表す条件（`claude-vscode.sideBarActive` など）は、別の場所で打って
 * いるあいだも真のままです。これだけでキーを絞ると、同じキーの別の割り当てと同時に成立し、
 * VS Code は後に書いたほうを採るため、狙ったほうが発火しません。開いていないときは正しく
 * 動くので、「開いているときだけ効かない」という分かりにくい形で出ます。
 *
 * フォーカスを表す条件はいずれもこの語のどれかを含みます。
 */
const FOCUS_CONDITION = /focusedView|activeWebviewPanelId|Focus\b/;

test('キーバインドは、見えているかではなくフォーカスで絞る', () => {
  for (const binding of keybindings) {
    // OR で並ぶ条件はどれか1つが成立すれば発火するので、すべてを個別に見ます。
    for (const alternative of (binding.when ?? '').split('||')) {
      assert.match(
        alternative,
        FOCUS_CONDITION,
        `${binding.key} (${binding.command}) の条件 "${alternative.trim()}" が` +
          'フォーカスを見ていません。他の場所で打ったキーまで奪います'
      );
    }
  }
});
