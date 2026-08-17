import { createInterface } from 'node:readline/promises';
import { MANUAL_CASES, ManualCase } from './cases';

/**
 * 手動テストの対話実行。
 *
 * 自動テストと違い、判定するのは人です。ここがやるのは、手順を1件ずつ読める形で出し、
 * 結果を受け取り、最後にまとめることだけです。まとめには Pull Request の
 * 「手動で確認したこと」へそのまま貼れる Markdown を含めます。転記のときに結果が
 * ねじれないように、報告の文面まで含めてここで作ってしまうのが確実です。
 *
 * 入出力は `ManualIo` で外から差せます。端末に繋がる部分を1箇所に閉じ込めているので、
 * 進行そのもの（答えの解釈、中断の扱い、集計）は manual.test.ts が自動で検査できます。
 *
 * `node --test` は各テストファイルを子プロセスで動かすため標準入力が使えません。
 * だから手動テストは、テストファイルではなく test/run.ts から直接呼ばれます。
 */

export type ManualVerdict = 'passed' | 'failed' | 'skipped';

export interface ManualResult {
  readonly item: ManualCase;
  readonly verdict: ManualVerdict;
  /** failed のときに聞き取った、実際に起きたこと。 */
  readonly note?: string;
}

export interface ManualIo {
  readonly write: (line: string) => void;
  /** 1行受け取ります。中断（Ctrl+D や入力の切断）は undefined で表します。 */
  readonly ask: (prompt: string) => Promise<string | undefined>;
}

const MARK: Record<ManualVerdict, string> = { passed: '✔', failed: '✘', skipped: '−' };
const LABEL: Record<ManualVerdict, string> = { passed: '期待どおり', failed: '違った', skipped: '未実施' };
const RULE = '─'.repeat(72);

/**
 * 絞り込みなしなら全件。`-manual=ui,crlf-buffer` のように id か area を渡せます。
 * 手動テストは1件あたりの手間が大きいので、触った範囲だけ流せることには実用上の意味があります。
 */
export function selectCases(filter: readonly string[]): readonly ManualCase[] {
  if (filter.length === 0) return MANUAL_CASES;
  return MANUAL_CASES.filter(item => filter.includes(item.id) || filter.includes(item.area));
}

/** 手動テストを実行し、プロセスの終了コードとして使える値を返します。 */
export async function runManualTests(filter: readonly string[]): Promise<number> {
  const cases = selectCases(filter);

  if (cases.length === 0) {
    console.error(`手動テストの絞り込み "${filter.join(',')}" に一致する項目がありません。`);
    console.error(`id: ${MANUAL_CASES.map(item => item.id).join(', ')}`);
    return 1;
  }

  if (!process.stdin.isTTY) {
    console.error('手動テストは結果を対話で受け取るため、端末から実行してください。');
    return 1;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const io: ManualIo = {
    write: line => console.log(line),
    ask: async prompt => {
      try {
        return await readline.question(prompt);
      } catch {
        // Ctrl+D や標準入力の切断は「中断」であって障害ではありません。readline はこれを
        // AbortError として投げるので、素通しにすると打ち切っただけでスタックトレースが出ます。
        return undefined;
      }
    }
  };

  try {
    const results = await collectResults(cases, io);
    return report(results, io);
  } finally {
    readline.close();
  }
}

/**
 * 各項目を提示して結果を受け取ります。中断した場合、残りは「未実施」として返るので、
 * 戻り値の長さは常に `cases` と同じです。
 */
export async function collectResults(cases: readonly ManualCase[], io: ManualIo): Promise<readonly ManualResult[]> {
  const results: ManualResult[] = [];

  io.write(`\n${RULE}\n手動テスト（${cases.length} 件）`);
  io.write('自動テストでは追えない項目です。手順のとおりに試して、結果を答えてください。');

  for (const [index, item] of cases.entries()) {
    present(item, index + 1, cases.length, io);
    const result = await ask(item, io);
    if (result === 'aborted') {
      io.write('\n中断しました。残りの項目は未実施として扱います。');
      break;
    }
    results.push(result);
  }

  return [...results, ...cases.slice(results.length).map(item => ({ item, verdict: 'skipped' as const }))];
}

function present(item: ManualCase, position: number, total: number, io: ManualIo): void {
  io.write(`\n${RULE}`);
  io.write(`[${position}/${total}] ${item.title}  (${item.id} / ${item.area})`);
  io.write(`自動テストにできない理由: ${item.why}`);

  if (item.setup) {
    io.write('\n前提:');
    for (const line of item.setup) io.write(`  - ${line}`);
  }

  io.write('\n手順:');
  for (const [index, step] of item.steps.entries()) io.write(`  ${index + 1}. ${step}`);

  io.write('\n期待する結果:');
  for (const line of item.expected) io.write(`  - ${line}`);
}

async function ask(item: ManualCase, io: ManualIo): Promise<ManualResult | 'aborted'> {
  for (;;) {
    const answer = (await io.ask('\n結果は? [y] 期待どおり / [n] 違った / [s] 飛ばす / [q] 中断: '))?.trim().toLowerCase();

    if (answer === undefined || answer === 'q') return 'aborted';
    if (answer === 'y') return { item, verdict: 'passed' };
    if (answer === 's') return { item, verdict: 'skipped' };
    if (answer === 'n') {
      const note = (await io.ask('何が起きましたか（空欄可）: '))?.trim() ?? '';
      return note.length > 0 ? { item, verdict: 'failed', note } : { item, verdict: 'failed' };
    }

    io.write('y / n / s / q のいずれかを入力してください。');
  }
}

/** 一覧・集計・PR へ貼る Markdown を出し、失敗があれば 1 を返します。 */
function report(results: readonly ManualResult[], io: ManualIo): number {
  io.write(`\n${RULE}\n手動テストの結果\n`);
  for (const result of results) {
    io.write(`  ${MARK[result.verdict]} ${result.item.id}: ${LABEL[result.verdict]}${suffix(result)}`);
  }

  const count = (verdict: ManualVerdict): number => results.filter(result => result.verdict === verdict).length;
  io.write(`\n  期待どおり ${count('passed')} / 違った ${count('failed')} / 未実施 ${count('skipped')}`);

  const answered = results.filter(result => result.verdict !== 'skipped');
  if (answered.length > 0) {
    io.write('\nPull Request の「手動で確認したこと」に貼れる形:\n');
    for (const result of answered) {
      io.write(`- [${result.verdict === 'passed' ? 'x' : ' '}] ${result.item.title}${suffix(result)}`);
    }
  }

  io.write(`\n${RULE}`);
  return count('failed') > 0 ? 1 : 0;
}

function suffix(result: ManualResult): string {
  return result.note ? ` — ${result.note}` : '';
}
