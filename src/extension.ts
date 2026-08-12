import * as vscode from 'vscode';
import { applyActions, readCursor } from './adapter/apply';
import { DocumentBuffer } from './adapter/buffer';
import { ModeStatusBar } from './adapter/statusBar';
import { EngineResult, VimEngine, VimState, createState, withExternalCursor } from './core/engine';
import { Mode } from './core/types';

const engine = new VimEngine();
let state: VimState = createState('normal');
let statusBar: ModeStatusBar;
let enabled = true;

/**
 * The selection we last placed ourselves. VS Code delivers selection-change
 * events asynchronously, so a simple "busy" flag would already be cleared by the
 * time our own move comes back and would make us resync against it.
 */
let lastAppliedSelection: string | undefined;

/** Last `enabled:mode` pair pushed to the context keys, to avoid redundant round trips. */
let lastPublishedMode: string | undefined;

/** Serialises edits: `type` fires faster than `editor.edit` resolves. */
let queue: Promise<void> = Promise.resolve();

export function activate(context: vscode.ExtensionContext): void {
  statusBar = new ModeStatusBar();
  context.subscriptions.push(statusBar);

  enabled = configuration().get('enabled', true);
  state = createState(configuration().get('startInNormalMode', true) ? 'normal' : 'insert');

  registerTypeInterceptor(context);
  registerCommands(context);
  registerListeners(context);

  void refresh();
}

export function deactivate(): void {
  void vscode.commands.executeCommand('setContext', 'vimLike.active', false);
  void vscode.commands.executeCommand('setContext', 'vimLike.mode', undefined);
}

// --------------------------------------------------------------------- input

/**
 * Overriding `type` is what makes Normal mode a mode: keys that are not bound to
 * a command are swallowed instead of reaching the buffer. The override is global
 * to the whole window, so every path that is not certainly ours delegates to
 * `default:type` — in particular Insert mode and any multi-character text, which
 * is how IME composition results arrive. Getting this wrong breaks typing
 * everywhere, not just in this extension.
 */
function registerTypeInterceptor(context: vscode.ExtensionContext): void {
  try {
    context.subscriptions.push(
      vscode.commands.registerCommand('type', (args: { text?: string } | undefined) => {
        const editor = vscode.window.activeTextEditor;

        if (!enabled || !editor || !isEditableEditor(editor) || state.mode === 'insert') {
          return vscode.commands.executeCommand('default:type', args);
        }

        const text = args?.text;
        if (typeof text !== 'string' || text.length === 0) {
          return vscode.commands.executeCommand('default:type', args);
        }

        // Normal and Visual mode ignore text input. Anything longer than a single
        // character is composed text, which has no meaning as a Vim key, so it is
        // dropped rather than forwarded into the buffer.
        if ([...text].length !== 1) return undefined;

        return enqueue(() => handleKey(editor, text));
      })
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Vim Like could not take over key input, most likely because another Vim extension is active. ${String(error)}`
    );
    enabled = false;
  }
}

async function handleKey(editor: vscode.TextEditor, key: string): Promise<void> {
  try {
    const buffer = new DocumentBuffer(editor.document);
    const result = engine.handleKey(state, key, buffer, readCursor(editor, state.mode));

    if (!result.handled) {
      await vscode.commands.executeCommand('default:type', { text: key });
      return;
    }
    await commit(editor, result);
  } catch (error) {
    // One bad command must not wedge the session with a half-parsed prefix still
    // pending, which would make every following key look wrong too.
    state = { ...state, pendingKeys: '' };
    console.error(`Vim Like failed to handle the key ${JSON.stringify(key)}`, error);
  }
}

async function commit(editor: vscode.TextEditor, result: EngineResult): Promise<void> {
  state = result.state;
  await applyActions(editor, result.actions, setMode, state.mode);
  lastAppliedSelection = selectionKey(editor.selection);
  await refresh();
}

function selectionKey(selection: vscode.Selection): string {
  const { anchor, active } = selection;
  return `${anchor.line}:${anchor.character}/${active.line}:${active.character}`;
}

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.catch(() => undefined).then(task);
  return queue;
}

// ------------------------------------------------------------------ commands

function registerCommands(context: vscode.ExtensionContext): void {
  const register = (id: string, callback: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));

  register('vimLike.escape', () =>
    withActiveEditor(editor => {
      const buffer = new DocumentBuffer(editor.document);
      return enqueue(() => commit(editor, engine.escape(state, buffer, readCursor(editor, state.mode))));
    })
  );

  register('vimLike.enterNormalMode', () =>
    withActiveEditor(editor => {
      const buffer = new DocumentBuffer(editor.document);
      return enqueue(() => commit(editor, engine.escape(state, buffer, readCursor(editor, state.mode))));
    })
  );

  register('vimLike.enterInsertMode', () =>
    withActiveEditor(editor =>
      enqueue(() => commit(editor, engine.setMode(state, 'insert', readCursor(editor, state.mode))))
    )
  );

  register('vimLike.redo', () => vscode.commands.executeCommand('redo'));

  register('vimLike.toggleEnabled', async () => {
    enabled = !enabled;
    await configuration().update('enabled', enabled, vscode.ConfigurationTarget.Global);
    await refresh();
  });
}

function registerListeners(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      const mode: Mode = configuration().get('startInNormalMode', true) ? 'normal' : state.mode;
      state = { ...createState(mode), desiredColumn: readCursor(editor, mode).character };
      void refresh();
    }),

    // A click, an arrow key or a jump to a definition moves the caret without us:
    // resync so that the column `j` and `k` aim for is not stale.
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor !== vscode.window.activeTextEditor) return;
      if (selectionKey(event.textEditor.selection) === lastAppliedSelection) return;
      state = withExternalCursor(state, readCursor(event.textEditor, state.mode));
    }),

    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('vimLike')) return;
      enabled = configuration().get('enabled', true);
      void refresh();
    })
  );
}

// -------------------------------------------------------------------- shared

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('vimLike');
}

function withActiveEditor<T>(action: (editor: vscode.TextEditor) => T): T | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor ? action(editor) : undefined;
}

/** Excludes the output panel and debug console, which report as text editors. */
function isEditableEditor(editor: vscode.TextEditor): boolean {
  return editor.viewColumn !== undefined && editor.document.uri.scheme !== 'output';
}

function setMode(mode: Mode): void {
  state = { ...state, mode };
}

/** Pushes the current mode out to the context keys, the status bar and the caret. */
async function refresh(): Promise<void> {
  // `refresh` runs on every keystroke, and `setContext` is a round trip through
  // the extension host, so publish only when the mode has actually changed.
  const published = `${enabled}:${state.mode}`;
  if (published !== lastPublishedMode) {
    lastPublishedMode = published;
    await vscode.commands.executeCommand('setContext', 'vimLike.active', enabled);
    await vscode.commands.executeCommand('setContext', 'vimLike.mode', enabled ? state.mode : 'insert');
  }

  statusBar.update(state.mode, {
    visible: configuration().get('showModeInStatusBar', true),
    enabled
  });

  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  // A block caret is how Normal mode announces itself. Only assign when it
  // actually differs — this runs on every keystroke.
  const wanted =
    enabled && state.mode !== 'insert'
      ? vscode.TextEditorCursorStyle.Block
      : vscode.TextEditorCursorStyle.Line;
  if (editor.options.cursorStyle !== wanted) {
    editor.options = { ...editor.options, cursorStyle: wanted };
  }
}
