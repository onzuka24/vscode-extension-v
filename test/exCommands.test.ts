import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExCommands, parseExCommand } from '../src/core/excommands';
import { run } from './harness';

/**
 * `:` で使える名前をユーザーが足せるようにしたものです。他の拡張機能のコマンドを
 * この拡張機能の表へ焼き込まないための仕組みで、`:gg` で Git Graph を開くような
 * 使い方を想定しています。
 */

test('設定した名前が Ex コマンドになる', () => {
  const { table, problems } = compileExCommands({ gg: ['git-graph.view'] });
  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('gg', table), {
    kind: 'commands',
    commands: [{ command: 'git-graph.view' }]
  });
});

test('複数のコマンドを順に実行できる', () => {
  const { table } = compileExCommands({ review: ['workbench.view.scm', 'git-graph.view'] });
  assert.deepEqual(parseExCommand('review', table), {
    kind: 'commands',
    commands: [{ command: 'workbench.view.scm' }, { command: 'git-graph.view' }]
  });
});

test('設定がなければ従来どおり知らないコマンドとして扱う', () => {
  assert.deepEqual(parseExCommand('gg'), { kind: 'unknown', input: 'gg' });
});

test('組み込みの名前は上書きできない', () => {
  // :w を奪われると保存できなくなるので、組み込みが必ず勝つ。
  const { table, problems } = compileExCommands({ w: ['some.other.command'] });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /既に使われています/);
  assert.deepEqual(parseExCommand('w', table), {
    kind: 'commands',
    commands: [{ command: 'workbench.action.files.save' }]
  });
});

test('marks や delmarks も守られる', () => {
  for (const name of ['marks', 'delmarks', 'delm', 'qa', 'wq']) {
    const { problems } = compileExCommands({ [name]: ['x'] });
    assert.equal(problems.length, 1, name);
  }
});

test('名前として使えない綴りは断る', () => {
  for (const name of ['', '1gg', 'g g', 'g-g', ':gg', 'gg!!']) {
    const { table, problems } = compileExCommands({ [name]: ['x'] });
    assert.equal(problems.length, 1, JSON.stringify(name));
    assert.equal(Object.keys(table).length, 0, JSON.stringify(name));
  }
});

test('末尾の ! は使える', () => {
  const { table, problems } = compileExCommands({ 'gg!': ['git-graph.view'] });
  assert.deepEqual(problems, []);
  assert.equal(parseExCommand('gg!', table).kind, 'commands');
});

test('コマンドの指定が空なら断る', () => {
  for (const commands of [[], [''], ['ok', '']]) {
    const { table, problems } = compileExCommands({ gg: commands });
    assert.equal(problems.length, 1, JSON.stringify(commands));
    assert.equal(Object.keys(table).length, 0);
  }
});

test('断った項目以外は残る', () => {
  const { table, problems } = compileExCommands({ w: ['bad'], gg: ['git-graph.view'] });
  assert.equal(problems.length, 1);
  assert.deepEqual(Object.keys(table), ['gg']);
});

test('行番号やマーク系の解釈より後に見る', () => {
  // 数字や $ は組み込みの解釈が先。名前として登録しても届かない。
  const { table } = compileExCommands({ gg: ['git-graph.view'] });
  assert.deepEqual(parseExCommand('42', table), { kind: 'goto', line: 42 });
  assert.deepEqual(parseExCommand('$', table), { kind: 'goto', line: 'last' });
});

/**
 * 引数を渡す書き方 (#63)。VS Code のコマンドには、引数がないと何もできないものが
 * あります。workbench.action.tasks.runTask はタスク名を渡さないと選択リストが開き、
 * workbench.action.terminal.sendSequence は何も送りません。コマンド ID だけしか
 * 書けないうちは、これらに `:` から届きませんでした。
 */

test('引数付きの書き方ができる', () => {
  const { table, problems } = compileExCommands({
    pi: [{ command: 'workbench.action.tasks.runTask', args: 'package & install' }]
  });

  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('pi', table), {
    kind: 'commands',
    commands: [{ command: 'workbench.action.tasks.runTask', args: 'package & install' }]
  });
});

test('引数の中身は解釈せずそのまま渡す', () => {
  // 何を受け取れるかはコマンド側の都合なので、こちらは形を問わない。
  const args = { text: 'npm test', when: { count: 3, deep: [null, true] } };
  const { table, problems } = compileExCommands({ t: [{ command: 'some.command', args }] });

  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('t', table), {
    kind: 'commands',
    commands: [{ command: 'some.command', args }]
  });
});

test('コマンド ID だけの書き方と混ぜられる', () => {
  const { table, problems } = compileExCommands({
    dev: ['workbench.view.scm', { command: 'workbench.action.tasks.runTask', args: 'watch' }]
  });

  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('dev', table), {
    kind: 'commands',
    commands: [{ command: 'workbench.view.scm' }, { command: 'workbench.action.tasks.runTask', args: 'watch' }]
  });
});

test('args を書かなければ引数なしのまま', () => {
  // undefined を渡すのと渡さないのはコマンドによって違うので、キーごと持たない。
  const { table } = compileExCommands({ gg: [{ command: 'git-graph.view' }] });
  const parsed = parseExCommand('gg', table);

  assert.equal(parsed.kind, 'commands');
  assert.ok(parsed.kind === 'commands' && !('args' in parsed.commands[0]!));
});

test('コマンドの形が壊れていれば断る', () => {
  const broken = [
    [{ args: 'package & install' }],
    [{ command: '' }],
    [{ command: 42 }],
    [['workbench.view.scm']],
    [null],
    'workbench.view.scm'
  ];

  for (const commands of broken) {
    const { table, problems } = compileExCommands({ gg: commands });
    assert.equal(problems.length, 1, JSON.stringify(commands));
    assert.match(problems[0] ?? '', /コマンド ID/);
    assert.equal(Object.keys(table).length, 0, JSON.stringify(commands));
  }
});

test(':pi と打つと引数付きでコマンドが呼ばれる', () => {
  const session = run('abc', ':pi<CR>', {
    exCommands: { pi: [{ command: 'workbench.action.tasks.runTask', args: 'package & install' }] }
  });

  assert.deepEqual(session.commandCalls, [
    { command: 'workbench.action.tasks.runTask', args: 'package & install' }
  ]);
  assert.equal(session.mode, 'normal', 'コマンドラインは閉じる');
});
