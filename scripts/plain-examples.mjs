/**
 * Writes the comment-free twin of every `examples/*.jsonc` beside it as `.json`.
 *
 * Two files rather than one because they answer different questions. The
 * annotated `.jsonc` says *why* each binding is there and which init.vim line it
 * came from; the plain `.json` is what actually gets pasted, where three lines in
 * every four being prose is a nuisance rather than a help.
 *
 * The stripping itself comes from the test helper that already has to read these
 * files, so the two can never disagree about what counts as a comment. That is
 * also why this needs `out/` to exist — hence `npm run examples`, which compiles
 * first.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutComments } from '../out/test/jsonc.js';

const directory = join(import.meta.dirname, '..', 'examples');

for (const name of readdirSync(directory).filter(file => file.endsWith('.jsonc')).sort()) {
  const source = readFileSync(join(directory, name), 'utf8');
  const target = name.replace(/\.jsonc$/, '.json');
  const plain = withoutComments(source);

  writeFileSync(join(directory, target), plain);
  console.log(`${name} → ${target}  (${source.split('\n').length} 行 → ${plain.split('\n').length} 行)`);
}
