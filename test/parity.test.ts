/**
 * Checks this port against output recorded from the Python original.
 *
 * The fixture is produced by scripts/generate-parity-fixtures.py. Its RNG
 * vectors must match bit for bit: a seed that drew different numbers would
 * produce a different trajectory, not a slightly different one. Coordinates are
 * compared to a tolerance instead, because `exp`, `atan2` and the trigonometric
 * functions round differently in V8 than in the C library numpy and CPython
 * call. See README.md, "Parity with the Python original".
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTrajectory } from '../src/cursory';
import { Generator } from '../src/random/generator';
import { createPcg64 } from '../src/random/pcg64';

/** Well beyond the worst gap observed (2.2e-12 px), well below anything a cursor can express. */
const COORDINATE_TOLERANCE = 1e-9;

interface Fixture {
  cursoryVersion: string;
  numpyVersion: string;
  skippedTiedCases: number;
  rng: {
    vectors: Record<
      string,
      {
        raw: string[];
        doubles: number[];
        normals: number[];
        integers: number[];
        rejectingIntegers: number[];
        uniforms: number[];
        choices: number[];
      }
    >;
    normalStream: { seed: number; length: number; sha256: string };
  };
  trajectories: {
    case: {
      start: [number, number];
      end: [number, number];
      frequency: number;
      frequencyRandomizer: number;
      seed: number;
      directness: number;
    };
    timings: number[];
    points: [number, number][];
  }[];
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'parity.json'), 'utf8'),
) as Fixture;

const INTEGER_RANGES = [1, 2, 3, 5, 86, 255, 256, 1000, 2357, 65535, 65536, 2 ** 32, 1_000_000];

function rampWeights(count: number): Float64Array {
  const weights = Float64Array.from({ length: count }, (_unused, index) => index + 1);
  let total = 0;
  for (const weight of weights) {
    total += weight;
  }
  for (let i = 0; i < weights.length; i += 1) {
    weights[i] /= total;
  }
  return weights;
}

test('the bit generator reproduces numpy PCG64 exactly', () => {
  for (const [seed, expected] of Object.entries(fixture.rng.vectors)) {
    const bitGenerator = createPcg64(BigInt(seed));
    const got = Array.from({ length: expected.raw.length }, () =>
      bitGenerator.nextUint64().toString(),
    );
    assert.deepEqual(got, expected.raw, `raw stream for seed ${seed}`);
  }
});

test('every distribution reproduces numpy exactly', () => {
  for (const [seed, expected] of Object.entries(fixture.rng.vectors)) {
    const seeded = () => new Generator(createPcg64(BigInt(seed)));

    let rng = seeded();
    assert.deepEqual(
      Array.from({ length: expected.doubles.length }, () => rng.random()),
      expected.doubles,
      `random() for seed ${seed}`,
    );

    rng = seeded();
    assert.deepEqual(
      Array.from({ length: expected.normals.length }, () => rng.standardNormal()),
      expected.normals,
      `normal() for seed ${seed}`,
    );

    rng = seeded();
    assert.deepEqual(
      INTEGER_RANGES.map((range) => rng.integers(range)),
      expected.integers,
      `integers() for seed ${seed}`,
    );

    rng = seeded();
    assert.deepEqual(
      Array.from({ length: expected.rejectingIntegers.length }, () => rng.integers(3_000_000_000)),
      expected.rejectingIntegers,
      `integers() through Lemire rejection for seed ${seed}`,
    );

    rng = seeded();
    assert.deepEqual(
      Array.from(rng.uniformArray(-3.5, 7.25, expected.uniforms.length)),
      expected.uniforms,
      `uniform() for seed ${seed}`,
    );

    rng = seeded();
    assert.deepEqual(
      Array.from({ length: expected.choices.length }, () => rng.choice(rampWeights(105))),
      expected.choices,
      `choice() for seed ${seed}`,
    );
  }
});

test('a long normal stream matches numpy through both ziggurat rejection paths', () => {
  const { seed, length, sha256 } = fixture.rng.normalStream;
  const rng = new Generator(createPcg64(BigInt(seed)));
  const bytes = Buffer.allocUnsafe(length * 8);
  for (let i = 0; i < length; i += 1) {
    bytes.writeDoubleLE(rng.standardNormal(), i * 8);
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
});

test('generated trajectories match the Python original', () => {
  assert.ok(fixture.trajectories.length > 0, 'fixture has cases');
  let worstGap = 0;
  let comparedCoordinates = 0;
  let identicalCoordinates = 0;

  for (const recorded of fixture.trajectories) {
    const { start, end, frequency, frequencyRandomizer, seed, directness } = recorded.case;
    const label = `seed ${seed} at ${frequency}Hz`;

    const { points, timings } = generateTrajectory(start, end, {
      frequency,
      frequencyRandomizer,
      seed,
      directness,
    });

    assert.deepEqual(timings, recorded.timings, `timings for ${label}`);
    assert.equal(points.length, recorded.points.length, `point count for ${label}`);

    for (let i = 0; i < points.length; i += 1) {
      for (const axis of [0, 1] as const) {
        const gap = Math.abs(points[i][axis] - recorded.points[i][axis]);
        assert.ok(
          gap <= COORDINATE_TOLERANCE,
          `${label} point ${i} axis ${axis}: off by ${gap}`,
        );
        worstGap = Math.max(worstGap, gap);
        comparedCoordinates += 1;
        if (gap === 0) {
          identicalCoordinates += 1;
        }
      }
    }
  }

  // Reported rather than asserted, so regenerating the fixture with more cases
  // (scripts/generate-parity-fixtures.py --cases N) measures this claim again
  // instead of inheriting it.
  console.log(
    `    ${fixture.trajectories.length} trajectories, ${comparedCoordinates} coordinates: ` +
      `worst gap ${worstGap.toExponential(2)} px, ` +
      `${((100 * identicalCoordinates) / comparedCoordinates).toFixed(1)}% bit-identical`,
  );
});
