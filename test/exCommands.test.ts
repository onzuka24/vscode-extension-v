import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExCommands, parseExCommand } from '../src/core/excommands';

/**
 * `:` で使える名前をユーザーが足せるようにしたものです。他の拡張機能のコマンドを
 * この拡張機能の表へ焼き込まないための仕組みで、`:gg` で Git Graph を開くような
 * 使い方を想定しています。
 */

test('設定した名前が Ex コマンドになる', () => {
  const { table, problems } = compileExCommands({ gg: ['git-graph.view'] });
  assert.deepEqual(problems, []);
  assert.deepEqual(parseExCommand('gg', table), { kind: 'commands', commands: ['git-graph.view'] });
});

test('複数のコマンドを順に実行できる', () => {
  const { table } = compileExCommands({ review: ['workbench.view.scm', 'git-graph.view'] });
  assert.deepEqual(parseExCommand('review', table), {
    kind: 'commands',
    commands: ['workbench.view.scm', 'git-graph.view']
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
    commands: ['workbench.action.files.save']
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
