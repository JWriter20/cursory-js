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

Wait the gap between consecutive timings, minus the time the move itself took:

```js
for (let i = 0; i < points.length; i += 1) {
  const gap = timings[i] - (i > 0 ? timings[i - 1] : 0);
  const before = performance.now();
  await page.mouse.move(points[i][0], points[i][1]);
  await sleep(Math.max(gap - (performance.now() - before), 0));
}
```

Do not skip the waits. The timing pattern is most of what makes the movement
look human; replaying the points as fast as possible does not.

## Things worth knowing

- **Chain movements.** Pass the previous `targetEnd` as the next `targetStart`
  so the cursor does not teleport between movements.
- **`frequency` is the polling rate you are imitating**, not a speed control.
  60 is a normal mouse; the duration comes from the recording, not from you.
- **`seed` makes a movement reproducible.** Leave it out in production, or every
  movement between the same two points will be identical.
- **`directness`** (0 to 1, default 0.65) shifts the whole distribution towards
  straighter or more wandering paths. It does not exclude either extreme.
- **Playwright and Puppeteer add a millisecond or two per move**, which eats
  into short gaps. At high `frequency` you may not keep up; drive CDP directly
  if the timing has to be tight.
- **A zero-length movement returns a single point**, so guard against feeding it
  the position the cursor is already at if your caller cannot handle that.

Full API, including the lower-level selection functions: [README.md](./README.md).
