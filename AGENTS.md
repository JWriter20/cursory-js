# cursory-js for agents

Generates human-realistic mouse trajectories with timings. Use it when you are
driving a real cursor — Playwright, Puppeteer, CDP, a desktop automation
library — and a straight jump or a linear interpolation would not pass for a
person.

## Install and call

```bash
npm install cursory-js
```

```js
import { generateTrajectory } from 'cursory-js';

const { points, timings } = generateTrajectory([120, 80], [940, 560]);
```

`points[i]` is a position, `timings[i]` is how many milliseconds after the start
of the movement the cursor should be there. The arrays are the same length,
`timings[0]` is 0, and the first and last points are exactly the endpoints you
passed.

## Moving the cursor

Dispatch each move without awaiting it, and pace the loop against the timings:

```js
const cdp = await page.context().newCDPSession(page);
const start = performance.now();

for (let i = 0; i < points.length; i += 1) {
  void cdp
    .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[i][0], y: points[i][1] })
    .catch(() => {});

  const next = timings[i + 1];
  if (next !== undefined) {
    await sleep(next - (performance.now() - start));
  }
}
```

Two ways to get this wrong:

- **Skipping the waits.** The timing pattern is most of what makes the movement
  look human; replaying the points as fast as possible does not.
- **Awaiting each move.** `await page.mouse.move()` waits for the browser to
  acknowledge the event, which takes a median of 16.67 ms -- one 60 Hz frame.
  That is the whole budget between two 60 Hz samples, so the playback stretches
  and the timing is lost. Awaiting raw CDP costs the same; not awaiting is the
  fix.

## Things worth knowing

- **Chain movements.** Pass the previous `targetEnd` as the next `targetStart`
  so the cursor does not teleport between movements.
- **`frequency` is the polling rate you are imitating**, not a speed control.
  60 is a normal mouse; the duration comes from the recording, not from you.
- **`seed` makes a movement reproducible.** Leave it out in production, or every
  movement between the same two points will be identical.
- **`directness`** (0 to 1, default 0.65) shifts the whole distribution towards
  straighter or more wandering paths. It does not exclude either extreme.
- **An awaited mouse event costs a full browser frame** (~16.7 ms measured), so
  await it per sample and you cannot exceed roughly 60 Hz. Dispatch without
  awaiting, as above, and playback lands within 0.05% of the intended duration.
- **A zero-length movement returns a single point**, so guard against feeding it
  the position the cursor is already at if your caller cannot handle that.

Full API, including the lower-level selection functions: [README.md](./README.md).
