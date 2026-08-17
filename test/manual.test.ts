import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { MANUAL_CASES, ManualCase } from './manual/cases';
import { ManualIo, collectResults, selectCases } from './manual/runner';

/**
 * 手動テストそのものは人が判定しますが、項目表は自動で守れます。
 *
 * ここでやっているのは2つです。1つは項目表が壊れていないかの検査。もう1つは、各項目を
 * skip として `npm test` の出力に並べること。手動テストは存在を忘れられた時点で無いのと
 * 同じなので、普段の実行でも「未実施の項目がこれだけある」と目に入るようにしています。
 */

const ROOT = path.resolve(__dirname, '..', '..');

for (const item of MANUAL_CASES) {
  test(`[手動] ${item.id}: ${item.title}`, { skip: '手動テストです。npm test -- -manual で確認します' }, () => {
    /* 実行されません。npm test -- -manual で手順を表示し、結果を受け取ります。 */
  });
}

test('手動テストの id は一意で kebab-case', () => {
  const ids = MANUAL_CASES.map(item => item.id);
  assert.deepEqual([...new Set(ids)], ids, '同じ id の項目があります');
  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${id} は kebab-case ではありません`);
  }
});

test('手動テストの項目には手順と期待する結果と、自動化できない理由がある', () => {
  assert.ok(MANUAL_CASES.length > 0);
  for (const item of MANUAL_CASES) {
    assert.ok(item.title.length > 0, `${item.id} に題がありません`);
    assert.ok(item.why.length > 0, `${item.id} に自動化できない理由がありません`);
    assert.ok(item.steps.length > 0, `${item.id} に手順がありません`);
    assert.ok(item.expected.length > 0, `${item.id} に期待する結果がありません`);
    assert.notEqual(item.setup?.length, 0, `${item.id} の前提が空配列です。不要なら省いてください`);
  }
});

test('絞り込みは id でも area でも効き、指定なしなら全件', () => {
  const first = MANUAL_CASES[0]!;
  assert.deepEqual(selectCases([]), MANUAL_CASES);
  assert.deepEqual(
    selectCases([first.id]).map(item => item.id),
    [first.id]
  );
  assert.ok(selectCases([first.area]).every(item => item.area === first.area));
  assert.ok(selectCases([first.area]).length > 0);
  assert.deepEqual(selectCases(['そんな項目はない']), []);
});

/** 答えを順に返す入出力。書き出した行は検査できるように溜めておきます。 */
function scripted(answers: readonly (string | undefined)[]): ManualIo & { readonly output: string[] } {
  const output: string[] = [];
  let next = 0;
  return {
    output,
    write: line => output.push(line),
    ask: prompt => {
      output.push(prompt);
      return Promise.resolve(answers[next++]);
    }
  };
}

const CASES = MANUAL_CASES.slice(0, 3) as readonly ManualCase[];

test('y / n / s の答えがそのまま結果になり、n では内容を聞き取る', async () => {
  const io = scripted(['y', 'n', 'ステータスバーが空のままだった', 's']);
  const results = await collectResults(CASES, io);

  assert.deepEqual(
    results.map(result => result.verdict),
    ['passed', 'failed', 'skipped']
  );
  assert.equal(results[1]!.note, 'ステータスバーが空のままだった');
  assert.equal(results[0]!.note, undefined);
});

test('答えが n でも内容が空欄なら、注記なしの失敗として扱う', async () => {
  const results = await collectResults(CASES.slice(0, 1), scripted(['n', '  ']));
  assert.deepEqual(results, [{ item: CASES[0]!, verdict: 'failed' }]);
});

test('答えを取り違えたら聞き直す', async () => {
  const io = scripted(['はい', 'Y']);
  const results = await collectResults(CASES.slice(0, 1), io);

  assert.equal(results[0]!.verdict, 'passed');
  assert.ok(io.output.some(line => line.includes('y / n / s / q のいずれかを入力してください')));
});

test('q での中断と入力の切断では、残りが未実施として返る', async () => {
  for (const stop of ['q', undefined]) {
    const results = await collectResults(CASES, scripted(['y', stop]));
    assert.deepEqual(
      results.map(result => result.verdict),
      ['passed', 'skipped', 'skipped'],
      `${String(stop)} で中断したとき`
    );
    assert.equal(results.length, CASES.length);
  }
});

test('手順・期待する結果・自動化できない理由が画面に出る', async () => {
  const io = scripted(['y']);
  await collectResults(CASES.slice(0, 1), io);

  const shown = io.output.join('\n');
  const item = CASES[0]!;
  assert.ok(shown.includes(item.title));
  assert.ok(shown.includes(item.why));
  for (const step of item.steps) assert.ok(shown.includes(step), `手順が出ていません: ${step}`);
  for (const line of item.expected) assert.ok(shown.includes(line), `期待する結果が出ていません: ${line}`);
});

test('npm test は手動テストの入口を通る', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(
    manifest.scripts.test ?? '',
    /out\/test\/run\.js/,
    'test スクリプトが run.js を通らないと -manual を受け取れません'
  );
});
