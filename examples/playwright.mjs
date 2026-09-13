// Moves a real cursor along a generated trajectory in Playwright.
//
//   npm install playwright && npx playwright install chromium
//   npm run build && node examples/playwright.mjs
//
// Playwright drives the browser over a socket, so each move costs a millisecond
// or two of its own. That overhead is subtracted from each wait below, and the
// script reports how often it could not keep up. If you need tighter timing than
// this can give you, drive CDP directly.

import { chromium } from 'playwright';

import { generateTrajectory } from '../dist/index.js';

/** Sleeps for `milliseconds`, busy-waiting the last stretch that setTimeout cannot resolve. */
async function preciseSleep(milliseconds) {
  const deadline = performance.now() + milliseconds;
  const coarse = milliseconds - 2;
  if (coarse > 0) {
    await new Promise((resolve) => setTimeout(resolve, coarse));
  }
  while (performance.now() < deadline) {
    // Spin out the remainder; setTimeout cannot resolve it accurately.
  }
}

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(`
  <style>body{margin:0;height:100vh;background:#111}i{position:fixed;width:4px;height:4px;
  border-radius:50%;background:#4ade80;transform:translate(-50%,-50%)}</style>
  <script>addEventListener('mousemove', (event) => {
    const dot = document.createElement('i');
    dot.style.left = event.clientX + 'px';
    dot.style.top = event.clientY + 'px';
    document.body.append(dot);
  });</script>
`);

let position = [20, 20];
let total = 0;
let late = 0;

for (let move = 0; move < 8; move += 1) {
  const destination = [40 + Math.random() * 1200, 40 + Math.random() * 640];
  const { points, timings } = generateTrajectory(position, destination, {
    frequency: 60,
    frequencyRandomizer: 0,
  });

  for (let i = 0; i < points.length; i += 1) {
    const gap = timings[i] - (i > 0 ? timings[i - 1] : 0);
    const before = performance.now();
    await page.mouse.move(points[i][0], points[i][1]);
    const spent = performance.now() - before;

    total += 1;
    if (spent > gap) {
      late += 1;
    }
    await preciseSleep(Math.max(gap - spent, 0));
  }

  await page.mouse.click(destination[0], destination[1]);
  position = destination;
  await page.waitForTimeout(400);
}

console.log(`${total} moves, ${late} slower than their timing (${((late / total) * 100).toFixed(1)}%)`);
await page.waitForTimeout(2000);
await browser.close();
