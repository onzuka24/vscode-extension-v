import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { formatTranscriptEntry, keepTail, plainTerminalText } from './transcript';

/**
 * A working document that sits between the editor and the terminal.
 *
 * Output of every command run in a shell-integrated terminal is appended to it,
 * and any line in it can be sent back to the terminal. The point is that the
 * engine only works on `TextDocument`, so putting the whole loop in a document
 * is what gives terminal work Vim's motions, search and marks — none of which
 * had to be reimplemented.
 *
 * It is a real file under the OS temp directory rather than an untitled buffer,
 * so that closing it never asks whether to save, and a session's work is still
 * there to look back at.
 */

/** Roughly a megabyte per capture. Long enough for a test run, short enough to hold. */
const LIMIT = 1_000_000;

export class TerminalBridge {
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Visible under Output → Vim Like. The capture path spans several VS Code
   * subsystems, so when nothing arrives the only way to say which one stayed
   * quiet is to have each step say so. */
  private readonly log = vscode.window.createOutputChannel('Vim Like', { log: true });
  private readonly file: vscode.Uri;
  /**
   * The terminal we send to.
   *
   * `window.activeTerminal` cannot be used for this: it tracks whichever
   * terminal has, or last had, focus — and this feature deliberately never takes
   * focus. Relying on it meant creating a fresh terminal on every send, each one
   * too young to have shell integration, so nothing was ever captured.
   */
  private terminal: vscode.Terminal | undefined;
  /** Said once per session; repeating it on every send would be worse than silence. */
  private warnedAboutIntegration = false;

  public constructor() {
    this.file = workingFile();

    this.subscriptions.push(
      vscode.window.onDidCloseTerminal(closed => {
        if (closed === this.terminal) this.terminal = undefined;
      })
    );

    this.subscriptions.push(this.log);
    this.log.info(`作業ファイル: ${this.file.fsPath}`);
    this.log.info(`シェル統合 API: ${this.available ? '利用可能' : '利用不可'}`);

    // Shell integration arrived long after the version this extension claims to
    // support, and the feature is optional, so it is detected rather than required.
    if (this.available) {
      this.subscriptions.push(
        vscode.window.onDidStartTerminalShellExecution(event => this.capture(event))
      );
    }
  }

  public showLog(): void {
    this.log.show();
  }

  public get available(): boolean {
    return typeof vscode.window.onDidStartTerminalShellExecution === 'function';
  }

  /** Opens the working document and puts the caret at the end, ready to type. */
  public async open(): Promise<void> {
    const document = await this.document();
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const end = document.lineAt(document.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    editor.revealRange(new vscode.Range(end, end));
  }

  /**
   * Sends the selection, or the current line when nothing is selected, to the
   * terminal. The terminal is revealed without taking focus, so the next command
   * can be typed straight away.
   */
  public async send(editor: vscode.TextEditor): Promise<boolean> {
    const text = editor.selection.isEmpty
      ? editor.document.lineAt(editor.selection.active.line).text
      : editor.document.getText(editor.selection);

    if (text.trim() === '') return false;

    const terminal = await this.terminalToSendTo();
    this.log.info(`送信: ${JSON.stringify(text)} / シェル統合=${terminal.shellIntegration ? 'あり' : 'なし'}`);

    // Sending works either way; only the capture needs shell integration. Saying
    // so is worth a notice, because the failure is otherwise silent — the command
    // runs, and the output simply never appears.
    if (!terminal.shellIntegration) this.noticeMissingIntegration();

    terminal.show(true);
    terminal.sendText(text, true);
    return true;
  }

  private noticeMissingIntegration(): void {
    if (this.warnedAboutIntegration) return;
    this.warnedAboutIntegration = true;

    void vscode.window
      .showInformationMessage(
        'Vim Like: このターミナルはシェル統合が有効でないため、出力を取り込めません。' +
          'コマンドの実行そのものはできます。シェルを置き換える種類のツール ' +
          '(kiro-cli、Amazon Q、Fig など) を使っている場合はそれが原因です。',
        'ログを見る'
      )
      .then(choice => {
        if (choice) this.log.show();
      });
  }

  /** Reuses a terminal, and gives a new one time to gain shell integration. */
  private async terminalToSendTo(): Promise<vscode.Terminal> {
    if (this.terminal && this.terminal.exitStatus === undefined) return this.terminal;

    // Whatever the user already has open is friendlier than adding another panel.
    this.terminal = vscode.window.terminals.at(-1) ?? vscode.window.createTerminal();
    await waitForShellIntegration(this.terminal);
    return this.terminal;
  }

  private capture(event: vscode.TerminalShellExecutionStartEvent): void {
    // `read()` only yields what is written after it is first called, so it has to
    // happen here — not after an await, by which point the output has gone.
    const command = event.execution.commandLine.value;
    this.log.info(`実行を検知: ${JSON.stringify(command)}`);
    const stream = event.execution.read();
    void this.consume(stream, command);
  }

  private async consume(stream: AsyncIterable<string>, command: string): Promise<void> {
    let raw = '';
    try {
      for await (const chunk of stream) {
        raw += chunk;
        // Trim as we go so a command that never stops printing cannot grow
        // without bound; the tail is what gets kept in the end anyway.
        if (raw.length > LIMIT * 2) raw = raw.slice(raw.length - LIMIT);
      }
    } catch {
      // A terminal can be closed mid-command. Whatever arrived is still useful.
    }

    this.log.info(`出力を受信: ${raw.length} 文字`);

    const { text, truncated } = keepTail(plainTerminalText(raw), LIMIT);
    const body = truncated ? `… 長いため先頭を省略しました\n${text}` : text;
    try {
      await this.append(formatTranscriptEntry(command, body));
      this.log.info('作業バッファへ追記しました');
    } catch (error) {
      this.log.error(`追記に失敗: ${String(error)}`);
    }
  }

  private async append(entry: string): Promise<void> {
    const document = await this.document();
    const end = document.lineAt(document.lineCount - 1).range.end;

    const edit = new vscode.WorkspaceEdit();
    // The document's own URI, not the one we asked for. On macOS the temp
    // directory is a symlink (`/var` → `/private/var`), so the two can differ —
    // and an edit aimed at the wrong one lands nowhere.
    edit.insert(document.uri, end, entry);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) throw new Error(`applyEdit が拒否されました (${document.uri.toString()})`);
    await document.save();

    this.followAlong(document, end);
  }

  /**
   * Keeps the view at the bottom, but only for a caret that was already there.
   * Someone reading further up is not dragged away by output arriving.
   */
  private followAlong(document: vscode.TextDocument, previousEnd: vscode.Position): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== document.uri.toString()) continue;

      const end = document.lineAt(document.lineCount - 1).range.end;
      if (editor.selection.isEmpty && editor.selection.active.isEqual(previousEnd)) {
        editor.selection = new vscode.Selection(end, end);
      }
      editor.revealRange(new vscode.Range(end, end));
    }
  }

  private async document(): Promise<vscode.TextDocument> {
    try {
      await vscode.workspace.fs.stat(this.file);
    } catch {
      await vscode.workspace.fs.writeFile(this.file, new Uint8Array());
    }
    return vscode.workspace.openTextDocument(this.file);
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions.length = 0;
  }
}

/**
 * Shell integration is never ready the instant a terminal appears, and a command
 * sent before it activates is invisible to us. Waiting is bounded: if it never
 * arrives the command still runs, it just is not captured.
 */
function waitForShellIntegration(terminal: vscode.Terminal): Promise<void> {
  if (terminal.shellIntegration) return Promise.resolve();
  if (typeof vscode.window.onDidChangeTerminalShellIntegration !== 'function') return Promise.resolve();

  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    };
    const timer = setTimeout(done, 3000);
    const subscription = vscode.window.onDidChangeTerminalShellIntegration(event => {
      if (event.terminal === terminal) done();
    });
  });
}

/**
 * One file per workspace, so two projects do not append into the same log while
 * reopening the same project finds the earlier work.
 */
function workingFile(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'no-workspace';
  const id = createHash('sha1').update(folder).digest('hex').slice(0, 8);
  return vscode.Uri.file(join(tmpdir(), `vimlike-terminal-${id}.txt`));
}
