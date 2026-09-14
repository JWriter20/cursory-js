/**
 * Runs the JavaScript snippets in README.md against the real package.
 *
 * A snippet that no longer works is the first thing a new user hits, so they are
 * executed here rather than trusted. Snippets that need a browser or a cursor
 * get a stub for it; everything else is the package itself.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import * as cursory from '../src/index';

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8');

/** Bindings the README's snippets assume from their surrounding prose. */
const scope = {
  ...cursory,
  console: { log: () => undefined },
  from: [10, 10] as const,
  to: [400, 300] as const,
  page: {
    mouse: { move: async () => undefined },
    context: () => ({ newCDPSession: async () => ({ send: async () => undefined }) }),
  },
  sleep: async () => undefined,
};

function extractJavaScriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```js\n([\s\S]*?)```/g)].map((match) => match[1]);
}

test('every JavaScript snippet in the README runs', async () => {
  const blocks = extractJavaScriptBlocks(README);
  assert.ok(blocks.length >= 3, `expected README snippets, found ${blocks.length}`);

  for (const [index, block] of blocks.entries()) {
    // The snippets import from the published package name; run them against the
    // local source instead.
    const body = block.replace(/^import .* from 'cursory-js';\n/gm, '');
    const names = Object.keys(scope);
    const run = new Function(...names, `return (async () => {\n${body}\n})();`) as (
      ...args: unknown[]
    ) => Promise<void>;

    await assert.doesNotReject(
      () => run(...names.map((name) => scope[name as keyof typeof scope])),
      `README snippet ${index + 1} failed`,
    );
  }
});

test('the README documents every public export', () => {
  for (const name of Object.keys(cursory)) {
    assert.ok(README.includes(name), `${name} is exported but not mentioned in the README`);
  }
});
