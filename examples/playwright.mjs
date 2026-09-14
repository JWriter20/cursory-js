// Moves a real cursor along a generated trajectory in Playwright.
//
//   npm install playwright && npx playwright install chromium
//   npm run build && node examples/playwright.mjs
//
// The important detail is that the mouse events are dispatched without awaiting
// them. `await page.mouse.move(...)` waits for the browser to acknowledge the
// event, which it does on its rendering cadence: a median of ~16.7ms, one 60Hz
// frame. Await it and the move alone spends the whole budget between two 60Hz
// samples, so the trajectory plays back slower than it was generated and its
// timing -- the part that makes it look human -- is lost. Raw CDP behaves the
// same way when awaited; it is the acknowledgement that costs, not Playwright.
//
// Dispatching without awaiting and pacing locally keeps playback within a
// fraction of a percent of the intended duration.

import { chromium } from 'playwright';

import { generateTrajectory } from '../dist/index.js';

/** Sleeps for `milliseconds`, spinning the last stretch that setTimeout cannot resolve. */
async function preciseSleep(milliseconds) {
  const deadline = performance.now() + milliseconds;
  if (milliseconds > 2) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds - 2));
  }
  while (performance.now() < deadline) {
    // Spin out the remainder; setTimeout is not accurate enough for it.
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
const cdp = await page.context().newCDPSession(page);

let position = [20, 20];
let intended = 0;
let actual = 0;

for (let move = 0; move < 8; move += 1) {
  const destination = [40 + Math.random() * 1200, 40 + Math.random() * 640];
  const { points, timings } = generateTrajectory(position, destination, { frequency: 60 });

  const start = performance.now();
  for (let i = 0; i < points.length; i += 1) {
    void cdp
      .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[i][0], y: points[i][1] })
      .catch(() => {});

    const next = timings[i + 1];
    if (next !== undefined) {
      await preciseSleep(next - (performance.now() - start));
    }
  }
  intended += timings[timings.length - 1];
  actual += performance.now() - start;

  await page.mouse.click(destination[0], destination[1]);
  position = destination;
  await page.waitForTimeout(400);
}

console.log(
  `played back in ${actual.toFixed(0)}ms against an intended ${intended.toFixed(0)}ms ` +
    `(${(((actual - intended) / intended) * 100).toFixed(2)}% drift)`,
);
await page.waitForTimeout(2000);
await browser.close();
