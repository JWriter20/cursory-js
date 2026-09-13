// tsc emits .js and nothing else, so the trajectory database and the test
// fixtures have to be copied into each build output by hand.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('usage: copy-file.mjs <source> <destination>');
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(projectRoot, destination);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(join(projectRoot, source), target);
