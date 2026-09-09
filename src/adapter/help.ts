import * as vscode from 'vscode';

/**
 * `:h` — the README, opened as a document.
 *
 * Vim's help is a read-only buffer you move around with Vim's own keys, and that
 * is what this is: a text document, so `/` searches it, `}` steps through it and
 * marks work in it. A rendered Markdown preview would look better and none of
 * that would work, because a webview never sees our keys.
 *
 * The file comes from the installed extension, never from the workspace. `:h`
 * while editing some other project has to show this extension's own README, and
 * a workspace `README.md` is a completely different document that happens to
 * share a name.
 *
 * Served through a content provider rather than opened from disk. That makes the
 * document read-only by construction — the real file lives inside the extension's
 * install directory, where a stray keystroke has no business — and it closes
 * without asking whether to save.
 */
export const HELP_SCHEME = 'vim-like-help';

/** One document, named so the tab reads sensibly and Markdown highlighting applies. */
export const HELP_URI = vscode.Uri.parse(`${HELP_SCHEME}:Vim Like の使い方.md`);

export class HelpDocument implements vscode.TextDocumentContentProvider {
  private text: string | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public async provideTextDocumentContent(): Promise<string> {
    this.text ??= await this.read();
    return this.text;
  }

  /** Opens the help in the active group. `:q` closes it, as it does in Vim. */
  public async show(): Promise<void> {
    const document = await vscode.workspace.openTextDocument(HELP_URI);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async read(): Promise<string> {
    const file = vscode.Uri.joinPath(this.extensionUri, 'README.md');
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    } catch (error) {
      // Saying which file was looked for is the whole value of this message: the
      // usual cause is a packaging change that stopped shipping it.
      return [
        '# Vim Like',
        '',
        `README.md を読めませんでした (${file.toString()})。`,
        '',
        `理由: ${String(error)}`,
        '',
        'GitHub の https://github.com/onzuka24/vscode-extension-v にも同じものがあります。'
      ].join('\n');
    }
  }
}
