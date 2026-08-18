import * as vscode from 'vscode';
import { applyActions, readCursor } from './adapter/apply';
import { DocumentBuffer } from './adapter/buffer';
import { MarkDecorations } from './adapter/markDecorations';
import { ModeStatusBar } from './adapter/statusBar';
import { EngineResult, VimEngine, VimState, createState, describePending, withExternalCursor } from './core/engine';
import { DEFAULT_LEADER, SPECIAL_KEYS } from './core/keys';
import { RemapRule, RemapTable } from './core/remap';
import { Mode } from './core/types';

const engine = new VimEngine();
let state: VimState = createState('normal');
let statusBar: ModeStatusBar;
let markDecorations: MarkDecorations;
let enabled = true;
let leader: string = DEFAULT_LEADER;

/**
 * Whether we actually own the `type` command. Without it there is no modal
 * editing at all, so the extension reports itself inactive however the `enabled`
 * setting is left — a half-working Vim mode is worse than none.
 */
let typeInterceptorReady = false;

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
  markDecorations = new MarkDecorations();
  context.subscriptions.push(markDecorations);

  enabled = configuration().get('enabled', true);
  loadSearchStyle();
  state = createState(configuration().get('startInNormalMode', true) ? 'normal' : 'insert');
  loadRemaps();

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
    typeInterceptorReady = true;
  } catch (error) {
    // `type` is a single, window-wide registration. Losing the race to another
    // Vim extension is by far the most common reason to land here, so name the
    // culprit instead of reporting a bare failure.
    const rivals = conflictingExtensions();
    const cause =
      rivals.length > 0
        ? `${rivals.join('、')} が同じキー入力の仕組みを使っています。どちらか一方を無効にしてください。`
        : `他の拡張機能がキー入力を先に確保しています。 ${String(error)}`;

    void vscode.window.showErrorMessage(`Vim Like: キー入力を受け取れないため無効化しました。${cause}`);
  }
}

/** Extensions known to register the `type` command, which only one owner may have. */
const RIVAL_EXTENSIONS: readonly { id: string; name: string }[] = [
  { id: 'asvetliakov.vscode-neovim', name: 'VSCode Neovim' },
  { id: 'vscodevim.vim', name: 'Vim (vscodevim.vim)' }
];

function conflictingExtensions(): string[] {
  return RIVAL_EXTENSIONS.filter(rival => vscode.extensions.getExtension(rival.id) !== undefined).map(
    rival => rival.name
  );
}

async function handleKey(editor: vscode.TextEditor, key: string): Promise<void> {
  try {
    await feed(editor, key, false);
  } catch (error) {
    // One bad command must not wedge the session with a half-parsed prefix still
    // pending, which would make every following key look wrong too.
    state = { ...state, pendingKeys: '' };
    console.error(`Vim Like failed to handle the key ${JSON.stringify(key)}`, error);
  }
}

/**
 * Feeds one key, then any keys a remap expanded to. Each replayed key gets a
 * freshly read buffer, because an expansion such as `ddp` must see the document
 * as it stands after the delete. Replays go through `handleLiteralKey`, which is
 * what makes remapping non-recursive.
 */
async function feed(editor: vscode.TextEditor, key: string, literal: boolean): Promise<void> {
  const buffer = new DocumentBuffer(editor.document);
  const cursor = readCursor(editor, state.mode);
  const result = literal
    ? engine.handleLiteralKey(state, key, buffer, cursor)
    : engine.handleKey(state, key, buffer, cursor);

  if (!result.handled) {
    await vscode.commands.executeCommand('default:type', { text: key });
    return;
  }

  await commit(editor, result);

  for (const replayed of result.replay ?? []) {
    await feed(editor, replayed, true);
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
  const register = (id: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

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

  // Enter and Backspace never arrive through `type`, so command-line mode gets
  // them the way Escape is already delivered: as a keybinding that feeds the
  // matching token back into the engine.
  for (const [id, key] of [
    ['vimLike.commandLineAccept', SPECIAL_KEYS.enter],
    ['vimLike.commandLineBackspace', SPECIAL_KEYS.backspace]
  ] as const) {
    register(id, () =>
      withActiveEditor(editor => enqueue(() => feed(editor, key, true)))
    );
  }

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
  loadSearchStyle();
      loadRemaps();
      void refresh();
    })
  );
}

// -------------------------------------------------------------------- shared

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('vimLike');
}

/**
 * Reads the user's remap rules. Rules that cannot be understood are reported
 * rather than dropped in silence — a binding that quietly never fires is
 * indistinguishable from a broken feature.
 */
function loadRemaps(): void {
  const settings = configuration();
  const { table, problems } = RemapTable.from({
    normal: settings.get<RemapRule[]>('normalModeKeyBindings', []),
    visual: settings.get<RemapRule[]>('visualModeKeyBindings', []),
    leader: settings.get<string>('leader', DEFAULT_LEADER)
  });

  engine.setRemaps(table);
  leader = table.leader;

  if (problems.length > 0) {
    void vscode.window.showWarningMessage(
      `Vim Like: 設定のキー割り当てを一部読み込めませんでした。 ${problems.join(' / ')}`
    );
  }
}

/** `/` either opens our own line in the status bar or VS Code's find widget. */
function loadSearchStyle(): void {
  const style = configuration().get<string>('search', 'statusBar');
  engine.setSearchStyle(style === 'editorFind' ? 'editorFind' : 'statusBar');
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

/**
 * The extension counts as active only when the `enabled` setting is on *and* we
 * own key input. Reporting active without owning `type` would light up the
 * keybindings and the status bar while Normal mode silently let every key
 * through to the buffer.
 */
function isActive(): boolean {
  return enabled && typeInterceptorReady;
}

/** Pushes the current mode out to the context keys, the status bar and the caret. */
async function refresh(): Promise<void> {
  const active = isActive();

  // `refresh` runs on every keystroke, and `setContext` is a round trip through
  // the extension host, so publish only when the mode has actually changed.
  const published = `${active}:${state.mode}`;
  if (published !== lastPublishedMode) {
    lastPublishedMode = published;
    await vscode.commands.executeCommand('setContext', 'vimLike.active', active);
    await vscode.commands.executeCommand('setContext', 'vimLike.mode', active ? state.mode : 'insert');
  }

  statusBar.update(state.mode, {
    visible: configuration().get('showModeInStatusBar', true),
    enabled: active,
    pending: describePending(state, leader)
  });

  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  // Cheap on a keystroke that changed nothing: the renderer compares what it
  // last drew and returns before touching the editor.
  markDecorations.render(
    editor,
    engine.listMarks(editor.document.uri.toString()),
    active && configuration().get('showMarks', true)
  );

  // A block caret is how Normal mode announces itself. Only assign when it
  // actually differs — this runs on every keystroke.
  const wanted =
    active && state.mode !== 'insert' ? vscode.TextEditorCursorStyle.Block : vscode.TextEditorCursorStyle.Line;
  if (editor.options.cursorStyle !== wanted) {
    editor.options = { ...editor.options, cursorStyle: wanted };
  }
}
