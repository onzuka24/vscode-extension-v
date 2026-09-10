/**
 * Turns the README's relative links into ones that work from inside `:h`.
 *
 * The help is served under its own URI scheme, so a link to `docs/demo.md`
 * resolves to `vim-like-help:docs/demo.md` — a document this extension would then
 * be asked to produce, and cannot. Pointing at the repository instead is honest
 * as well as workable: `docs/` is not shipped in the VSIX, so on an installed
 * extension there is no local file to open even in principle.
 *
 * Kept free of `vscode` so it can be tested directly.
 */

/** `https://github.com/owner/repo.git` and friends, as `package.json` writes it. */
export function repositoryPage(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

/**
 * Rewrites `[text](target)` where the target is a path inside the repository.
 *
 * Left alone: anything with a scheme (`https:`, `mailto:`) and anything starting
 * with `#`, which is a heading in this same document and already works.
 *
 * A target ending in `/` is a directory, and GitHub serves those under `tree`
 * rather than `blob`.
 */
export function absoluteLinks(markdown: string, repositoryUrl: string): string {
  const base = repositoryPage(repositoryUrl);

  return markdown.replace(/(\[[^\]]*\])\(([^)\s]+)\)/g, (whole, label: string, target: string) => {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('#')) return whole;

    const [path, fragment] = splitFragment(target);
    const kind = path.endsWith('/') ? 'tree' : 'blob';
    return `${label}(${base}/${kind}/main/${path}${fragment})`;
  });
}

/** `docs/a.md#heading` → `['docs/a.md', '#heading']`. */
function splitFragment(target: string): [string, string] {
  const hash = target.indexOf('#');
  return hash === -1 ? [target, ''] : [target.slice(0, hash), target.slice(hash)];
}
