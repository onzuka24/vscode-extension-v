import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { runManualTests } from './manual/runner';

/**
 * `npm test` の入口。
 *
 *   npm test                  自動テストだけ（手動テストは skip として一覧に出る）
 *   npm test -- -manual       自動テストのあと、手動テストの結果を対話で受け取る
 *   npm test -- -manual=ui    手動テストを id か area で絞り込む
 *
 * 手動テストを `node --test` の中に置けないのは、テストファイルが子プロセスで動き、
 * 標準入力が繋がらないためです。だから自動テストを子プロセスとして呼び、手動テストは
 * この親プロセスで走らせています。呼び出し口が `npm test` ひとつで済むのはそのためです。
 */

const MANUAL_FLAG = /^--?manual(?:=(.*))?$/;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const manual = args.map(arg => MANUAL_FLAG.exec(arg)).find(match => match !== null);
  const passthrough = args.filter(arg => !MANUAL_FLAG.test(arg));

  const status = runAutomated(passthrough);
  if (manual === undefined) return status;

  // 自動テストが落ちている状態で人に手を動かしてもらうのは無駄が大きいので、先に直してもらう。
  if (status !== 0) {
    console.error('\n自動テストが失敗したため、手動テストは実行しません。');
    return status;
  }

  const filter = (manual[1] ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0);

  return await runManualTests(filter);
}

function runAutomated(passthrough: readonly string[]): number {
  const files = testFiles(__dirname);
  if (files.length === 0) {
    console.error('テストファイルが見つかりません。npm run compile を先に実行してください。');
    return 1;
  }

  const result = spawnSync(process.execPath, ['--test', ...passthrough, ...files], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function testFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (entry.name.endsWith('.test.js')) found.push(full);
  }
  return found.sort();
}

void main().then(status => {
  process.exitCode = status;
});
