import * as vscode from 'vscode';

type Mode = 'normal' | 'insert';

let mode: Mode = 'normal';
let modeItem: vscode.StatusBarItem;

function setMode(next: Mode): void {
  mode = next;
  vscode.commands.executeCommand('setContext', 'vimLike.mode', mode);
  if (modeItem) {
    modeItem.text = mode === 'normal' ? '$(terminal) NORMAL' : '$(edit) INSERT';
    modeItem.backgroundColor = mode === 'normal'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    if (vscode.workspace.getConfiguration('vimLike').get('showModeInStatusBar', true)) {
      modeItem.show();
    } else {
      modeItem.hide();
    }
  }
}

function activeEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor;
}

async function editCurrentLine(edit: (builder: vscode.TextEditorEdit, line: vscode.TextLine) => void): Promise<void> {
  const editor = activeEditor();
  if (!editor) return;
  const line = editor.document.lineAt(editor.selection.active.line);
  await editor.edit(builder => edit(builder, line));
}

export function activate(context: vscode.ExtensionContext): void {
  modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  modeItem.command = 'vimLike.enterNormalMode';
  context.subscriptions.push(modeItem);
  setMode(vscode.workspace.getConfiguration('vimLike').get('startInNormalMode', true) ? 'normal' : 'insert');

  const register = (id: string, callback: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));

  register('vimLike.enterNormalMode', () => setMode('normal'));
  register('vimLike.enterInsertMode', () => setMode('insert'));
  register('vimLike.deleteCharacter', async () => {
    const editor = activeEditor();
    if (!editor) return;
    const position = editor.selection.active;
    const end = position.translate(0, 1);
    if (!editor.document.validatePosition(end).isEqual(position)) {
      await editor.edit(builder => builder.delete(new vscode.Range(position, end)));
    }
  });
  register('vimLike.deleteLine', () => editCurrentLine((builder, line) => {
    builder.delete(new vscode.Range(line.range.start, line.rangeIncludingLineBreak.end));
  }));
  register('vimLike.openLineBelow', async () => {
    const editor = activeEditor();
    if (!editor) return;
    const line = editor.document.lineAt(editor.selection.active.line);
    await editor.edit(builder => builder.insert(line.rangeIncludingLineBreak.end, '\n'));
    setMode('insert');
  });
  register('vimLike.openLineAbove', async () => {
    const editor = activeEditor();
    if (!editor) return;
    const line = editor.document.lineAt(editor.selection.active.line);
    await editor.edit(builder => builder.insert(line.range.start, '\n'));
    setMode('insert');
  });

  const builtIn = (id: string, command: string) => register(id, () => vscode.commands.executeCommand(command));
  builtIn('vimLike.toggleSidebar', 'workbench.action.toggleSidebarVisibility');
  builtIn('vimLike.togglePanel', 'workbench.action.togglePanel');
  builtIn('vimLike.toggleAuxiliaryBar', 'workbench.action.toggleAuxiliaryBar');
  builtIn('vimLike.toggleActivityBar', 'workbench.action.toggleActivityBarVisibility');

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('vimLike.showModeInStatusBar') &&
        !vscode.workspace.getConfiguration('vimLike').get('showModeInStatusBar', true)) {
      modeItem.hide();
    } else {
      setMode(mode);
    }
  }));
}

export function deactivate(): void { /* subscriptions are disposed by VS Code */ }
