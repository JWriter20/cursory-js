<h1 align="center">📐 cursory-js</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/cursory-js"><img alt="npm" src="https://img.shields.io/npm/v/cursory-js?label=version"></a>
  <a href="https://www.npmjs.com/package/cursory-js"><img alt="downloads" src="https://img.shields.io/npm/dm/cursory-js?color=seagreen"></a>
  <a href="./LICENSE"><img alt="licence" src="https://img.shields.io/badge/License-GNU%20LGPL-green"></a>
</p>

#### Mouse Trajectory Factory. Generate 100% human-realistic mouse trajectories with timings.

A TypeScript port of [Cursory](https://github.com/Vinyzu/cursory) by
[Vinyzu](https://github.com/Vinyzu/), with the same algorithms, the same
recorded-trajectory database, and the same licence. A given seed produces the
same trajectory here as it does in Python — see
[Parity with the Python original](#parity-with-the-python-original).

<p align="center">
  <img alt="Ten generated trajectories" src="https://raw.githubusercontent.com/JWriter20/cursory-js/main/docs/trajectories.svg" width="820">
</p>

*Ten trajectories at the default 60 Hz. Hollow circles start, filled circles
finish, and each dot is one sample — so dots bunch up where the cursor slowed
down and spread out mid-flight.*

---

## Install

```bash
npm install cursory-js
```

Node 18 or newer. TypeScript types are included.

---

## Usage

```js
import { generateTrajectory } from 'cursory-js';

const { points, timings } = generateTrajectory([120, 80], [940, 560]);

for (const [index, point] of points.entries()) {
  const pause = timings[index] - (timings[index - 1] ?? 0);
  console.log(`wait ${pause}ms, then move to ${point[0]}, ${point[1]}`);
}
```

`points[i]` is the position to move to, and `timings[i]` is how many
milliseconds after the start of the movement to be there. Both arrays are the
same length, `timings` starts at 0 and never goes backwards, and the first and
last points are exactly the start and end you asked for.

`require('cursory-js')` works too.

### Driving a real cursor

Dispatch each move without awaiting it, and pace the loop yourself:

```js
import { generateTrajectory } from 'cursory-js';

const { points, timings } = generateTrajectory(from, to, { frequency: 60 });
const cdp = await page.context().newCDPSession(page);
const start = performance.now();

for (let i = 0; i < points.length; i += 1) {
  // Not awaited: see below.
  void cdp
    .send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[i][0], y: points[i][1] })
    .catch(() => {});

  const next = timings[i + 1];
  if (next !== undefined) {
    await sleep(next - (performance.now() - start));
  }
}
```

**Do not `await page.mouse.move()` per sample.** Awaiting waits for the browser
to acknowledge the event, and it acknowledges on its rendering cadence. Measured
against headless Chromium 140: a median of **16.67 ms per awaited move**, which
is exactly one 60 Hz frame. At 60 Hz that is the entire budget between samples,
so 44% of moves overrun their deadline and the trajectory plays back stretched —
losing the timing that made it look human in the first place. Awaiting raw CDP
costs the same 16.6 ms, so "drop to CDP" is not the fix; not awaiting is.

Dispatched without awaiting, the same trajectories play back within **0.05%** of
their intended duration. The browser coalesces a few events when they arrive
faster than it renders, which is what a real mouse does too.

[`examples/playwright.mjs`](./examples/playwright.mjs) is a complete, runnable
version, and it reports its own drift so you can measure your setup rather than
trust these numbers.

### Reproducible trajectories

```js
const first = generateTrajectory([0, 0], [500, 300], { seed: 42 });
const second = generateTrajectory([0, 0], [500, 300], { seed: 42 });
// first and second are identical
```

Without a seed, each call draws fresh OS entropy.

---

## API

### `generateTrajectory(targetStart, targetEnd, options?)`

| Parameter | Type | Description |
|---|---|---|
| `targetStart` | `[number, number]` | Where the cursor starts. |
| `targetEnd` | `[number, number]` | Where the cursor ends up. |

| Option | Type | Default | Description |
|---|---|---|---|
| `frequency` | `number` | `60` | Samples per second. |
| `frequencyRandomizer` | `number` | `1` | Largest jitter, in milliseconds, applied to each sample time. |
| `seed` | `number \| bigint` | — | Seed for a reproducible trajectory. Seeds above `Number.MAX_SAFE_INTEGER` must be a `bigint`. |
| `directness` | `number` | `0.65` | Relative preference for shorter, straighter paths, from 0 to 1. |

Returns `{ points: [number, number][], timings: number[] }`.

Throws a `RangeError` if `frequency` is not positive, `frequencyRandomizer` is
negative, or `directness` is outside 0 to 1. A zero-length movement returns a
single point at `timings` 0 without consuming any randomness.

`directness` moves the whole distribution rather than filtering it: at 1 the
straight, efficient recordings are preferred, at 0 the wandering ones, and
either extreme stays reachable at any setting.

### Lower-level exports

`findTrajectory`, `findNearestTrajectory`, `findClosestTrajectory`,
`morphTrajectory`, `jitterTrajectory`, `knotTrajectory`,
`generateMiddleBiasedPoint`, `LOADED_TRAJECTORIES`, and `defaultGenerator` are
exported as well — the equivalents of Python's `cursory.trajectory_selection`.
They take a generator from `defaultGenerator(seed)` where the Python versions
take an `rng` argument.

---

## How it works

1. **Find a close human trajectory.** A database of thousands of trajectories
   recorded from real people, searched for the closest match to the requested
   movement, with some randomisation.
2. **Morph it.** Scaled, rotated and translated onto the requested endpoints
   exactly, while keeping the shape of the original.
3. **Add noise.** Jittered and knotted, so positions vary slightly and the path
   cannot be recognised by hashing it.
4. **Regenerate with timings.** Resampled at the requested frequency using the
   recording's own interval pattern, with noise added to the sample times.
5. **Re-add noise.** Jittered and knotted again, since resampling smooths the
   path out.
6. **Morph again.** Put back onto the requested endpoints exactly.

> [!WARNING]
> It is theoretically possible to detect trajectories generated by Cursory, but
> doing so would take an infeasible amount of compute. The greater risk is a bad
> trajectory, which the algorithms above are what mitigate.

---

## Parity with the Python original

This is a port, not a rewrite, and it is tested against output recorded from
Python Cursory 2.0.0 — see [`test/parity.test.ts`](./test/parity.test.ts) and
[`scripts/generate-parity-fixtures.py`](./scripts/generate-parity-fixtures.py),
which regenerates the fixtures.

**Random numbers match bit for bit.** Cursory's output is driven entirely by
`numpy.random.default_rng(seed)`, so this package reimplements the parts of
numpy that reach the result: the PCG64 bit generator, SeedSequence, the ziggurat
normal sampler with numpy's own constant tables, Lemire's bounded-integer method
and its rejection loop, weighted `choice`, and pairwise summation. The test
suite checks 12 seeds across every distribution, and hashes a 200,000-draw
normal stream, against values numpy produced. A seed that drew even one
different number would give a different trajectory, not a slightly different
one, so this is the part that has to be exact.

**Coordinates match to about 1.4 × 10⁻¹² px.** Over 490 randomised movements —
85,506 coordinates — the largest difference in any one of them was 1.36e-12 px,
and 80% were identical bit for bit. The residue is `exp`, `atan2`, `sin` and
`cos` rounding differently in V8 than in the C library numpy and CPython call,
which is also why the parity test compares coordinates to a tolerance rather
than exactly. `math.hypot` is reproduced exactly, using CPython's own
`vector_norm`, because the distance between the endpoints feeds everything
downstream.

Those are measurements, not estimates, and `npm test` prints its own:

```
149 trajectories, 23512 coordinates: worst gap 1.36e-12 px, 77.8% bit-identical
```

The committed fixture holds 149 movements to keep the repository small.
`python scripts/generate-parity-fixtures.py --cases 500` regenerates it at any
size, and the suite re-measures rather than repeating the figure above.

**About 0.2% of movements pick a different recording.** When two recordings
score exactly the same, numpy's ordering comes from an unstable sort whose SIMD
kernel is chosen at run time — so Python itself does not always agree with
Python across CPUs. This port breaks those ties by index instead, which is
deterministic everywhere. In 3,000 sampled queries, 5 disagreed with numpy, and
every one of them was an exact tie; there were no disagreements without one. A
tie means the recordings were equally good matches, so the result is equally
valid, just not the same one.

The fixture generator excludes any movement that hit a tie anywhere — about 2%
of them, since each movement runs 21 candidate queries — so the checked-in
expectations never depend on the CPU that produced them.

**One quirk of the original is reproduced on purpose.** numpy types an array of
recorded whole-pixel coordinates as `int64`, so the original's
`np.zeros_like(tangents)` is an integer array, and storing unit normals in it
rounds them to 0 and ±1. Most recordings in the database are whole-pixel, so
this shapes most of the jitter Cursory actually produces. `jitterTrajectory`
does the same thing for whole-pixel input. Removing it would be a different
library, not a bug fix.

### Differences from the Python API

Behaviour is the same; the surface is TypeScript-idiomatic.

| Python | TypeScript |
|---|---|
| `generate_trajectory(start, end, frequency, frequency_randomizer, seed, directness)` | `generateTrajectory(start, end, { frequency, frequencyRandomizer, seed, directness })` |
| returns `(points, timings)` | returns `{ points, timings }` |
| `rng` keyword argument | a `Generator` from `defaultGenerator(seed)`, passed positionally |
| `ValueError` | `RangeError` |

---

## Development

```bash
npm install
npm test          # unit, behaviour and parity tests
npm run coverage
npm run build
node examples/plotTrajectories.mjs   # writes examples/trajectories.svg
```

Regenerating the parity fixtures needs the Python original:

```bash
pip install "cursory==2.0.0" "numpy~=2.3"
python scripts/generate-parity-fixtures.py
```

---

## Copyright and license

Cursory © [Vinyzu](https://github.com/Vinyzu/). This port © Jake Writer.
Both under [GNU LGPL v3 or later](./LICENSE).

All Cursory versions are retroactively dual-licensed under LGPLv3-or-later and
GPLv3-or-later. Commercial use is allowed, but the source, licence and copyright
have to be made available. No liability or warranty is provided.

[`NOTICE`](./NOTICE) credits the recorded-trajectory data and the numpy and
CPython algorithms this port reimplements.

### Thanks to

[Vinyzu](https://github.com/Vinyzu/), for Cursory.
<br/>
[Pointergeist](https://github.com/Pointergeist), for helping Vinyzu understand
mouse trajectories better.
<br/>
[sameelarif](https://github.com/sameelarif/), for
[Scribe](https://github.com/sameelarif/scribe).
<br/>
[Margit Antal, Norbert Fejer and Krisztian Buza](https://github.com/margitantal68),
for [SapiMouse](https://ieeexplore.ieee.org/document/9465583).
<br/>
[MIMIC-LOGICS](https://github.com/MIMIC-LOGICS/), for
[Mouse-Synthesizer](https://github.com/MIMIC-LOGICS/Mouse-Synthesizer).

---

## Disclaimer

This repository is provided for **educational purposes only**.

No warranties are provided regarding accuracy, completeness, or suitability for
any purpose. **Use at your own risk** — the authors and maintainers assume **no
liability** for **any damages**, **legal issues**, or **warranty breaches**
resulting from use, modification, or distribution of this code.

**Any misuse or legal violations are the sole responsibility of the user.**
