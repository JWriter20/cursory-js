// Draws ten generated trajectories to an SVG so you can see what they look like.
//
//   npm run build && node examples/plotTrajectories.mjs
//   node examples/plotTrajectories.mjs --seed 7 --out docs/trajectories.svg
//
// Without --seed the endpoints and the paths are both random. Points are drawn
// as dots along the path, so clusters of dots are where the cursor slowed down.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateTrajectory } from '../dist/index.js';

const WIDTH = 1920;
const HEIGHT = 1080;
const COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
                 '#46f0f0', '#f032e6', '#bcf60c', '#008080', '#9a6324'];

const options = process.argv.slice(2);
const valueOf = (flag) => {
  const at = options.indexOf(flag);
  return at === -1 ? undefined : options[at + 1];
};
const seed = valueOf('--seed') === undefined ? undefined : Number(valueOf('--seed'));

/** mulberry32, so --seed also fixes where the trajectories run from and to. */
let pickState = (seed ?? 0) >>> 0;
const pick = () => {
  if (seed === undefined) {
    return Math.random();
  }
  pickState = (pickState + 0x6d2b79f5) >>> 0;
  let x = Math.imul(pickState ^ (pickState >>> 15), 1 | pickState);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

const paths = [];
for (let index = 0; index < 10; index += 1) {
  const start = [pick() * WIDTH, pick() * HEIGHT];
  const end = [pick() * WIDTH, pick() * HEIGHT];
  const { points, timings } = generateTrajectory(start, end, {
    seed: seed === undefined ? undefined : seed * 1000 + index,
  });

  const colour = COLOURS[index];
  const line = points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ');
  const dots = points
    .map((point) => `<circle cx="${point[0].toFixed(2)}" cy="${point[1].toFixed(2)}" r="2.5" fill="${colour}" opacity="0.65"/>`)
    .join('');

  paths.push(
    `<polyline points="${line}" fill="none" stroke="${colour}" stroke-width="2" opacity="0.8"/>${dots}` +
      `<circle cx="${start[0].toFixed(2)}" cy="${start[1].toFixed(2)}" r="9" fill="none" stroke="${colour}" stroke-width="3"/>` +
      `<circle cx="${end[0].toFixed(2)}" cy="${end[1].toFixed(2)}" r="7" fill="${colour}"/>`,
  );

  const duration = timings[timings.length - 1];
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
  console.log(
    `trajectory ${index + 1}: ${points.length} points, ${duration} ms, ` +
      `${distance.toFixed(0)} px, ${((distance / duration) * 1000).toFixed(0)} px/s`,
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
<rect width="100%" height="100%" fill="#faf9f7"/>
${paths.join('\n')}
</svg>
`;

const output = valueOf('--out')
  ? resolve(valueOf('--out'))
  : join(dirname(fileURLToPath(import.meta.url)), 'trajectories.svg');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, svg);
console.log(`\nwrote ${output}`);
