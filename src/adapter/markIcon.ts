/**
 * Gutter icons for marks.
 *
 * VS Code's gutter takes an image, not text, so the letter has to be drawn. The
 * SVG is built here as a plain string and kept free of any `vscode` import, so
 * that what ends up in the gutter can be asserted in a test.
 *
 * A gutter icon cannot follow a `ThemeColor`, because it is a picture rather than
 * a styled element. Two are produced instead, and the decoration declares one for
 * light themes and one for dark.
 */
export const MARK_ICON_COLORS = {
  light: '#0a5ea8',
  dark: '#6fb3f2'
} as const;

/** Marks that are worth drawing: the named ones a user deliberately set. */
export function isDrawableMark(name: string): boolean {
  return /^[a-z]$/.test(name);
}

export function markIconSvg(name: string, color: string): string {
  // The viewBox is square and the glyph centred, so VS Code can scale the icon
  // to whatever the line height happens to be without cropping it.
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">',
    `<text x="8" y="12" fill="${color}" font-family="monospace" font-size="12"`,
    ' font-weight="bold" text-anchor="middle">',
    escapeXml(name),
    '</text></svg>'
  ].join('');
}

export function markIconUri(name: string, color: string): string {
  const svg = markIconSvg(name, color);
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}
