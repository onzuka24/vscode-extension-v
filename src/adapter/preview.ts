/**
 * What `:preview` should run for the file being edited.
 *
 * Kept free of `vscode` so the choice can be tested directly; the caller supplies
 * the language and executes what comes back.
 */

/**
 * The languages VS Code's Markdown preview handles. Taken from the `when` clause
 * on its own `Ctrl+K V` keybinding rather than guessed, so `.prompt.md` and the
 * other Markdown-shaped languages are covered too.
 */
const MARKDOWN_LANGUAGES: ReadonlySet<string> = new Set([
  'markdown',
  'prompt',
  'instructions',
  'chatagent',
  'skill'
]);

/** Opens beside the source rather than over it, so the text stays visible. */
export const MARKDOWN_PREVIEW = 'markdown.showPreviewToSide';

/**
 * Everything else. VS Code lists whatever editors are registered for the file —
 * an image viewer, a notebook, a custom editor an extension contributed — and
 * lets one be chosen. A file with only a text editor gets a list of one, which
 * says "there is no other view of this" more clearly than doing nothing would.
 */
export const OTHER_PREVIEW = 'workbench.action.reopenWithEditor';

export function previewCommandFor(languageId: string): string {
  return MARKDOWN_LANGUAGES.has(languageId) ? MARKDOWN_PREVIEW : OTHER_PREVIEW;
}
