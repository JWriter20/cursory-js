/** The contracts that fail loudly rather than returning a plausible wrong answer. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { hypot } from '../src/numeric';
import { defaultGenerator, Generator } from '../src/random/generator';
import { createPcg64 } from '../src/random/pcg64';
import { intToUint32Array } from '../src/random/seedSequence';
import { findClosestTrajectory, findNearestTrajectory, Point } from '../src/trajectorySelection';

test('seeds outside the representable range are rejected, not silently truncated', () => {
  assert.throws(() => createPcg64(Number.MAX_SAFE_INTEGER + 2), /safe integer|bigint/);
  assert.throws(() => createPcg64(1.5), /safe integer|bigint/);
  assert.throws(() => createPcg64(-1n), /non-negative/);
  assert.throws(() => intToUint32Array(-5n), /non-negative/);
  // A bigint past 2**53 is fine; that is what it is for.
  assert.ok(createPcg64(2n ** 90n + 7n).nextUint64() >= 0n);
});

test('integer ranges wider than the supported method are rejected', () => {
  const rng = defaultGenerator(1);
  assert.throws(() => rng.integers(2 ** 33), /2\*\*32/);
  assert.throws(() => rng.integers(0), /positive integer/);
  assert.throws(() => rng.integers(-3), /positive integer/);
  assert.throws(() => rng.integers(2.5), /positive integer/);
  assert.equal(rng.integers(1), 0);
});

test('a uniform range that overflows is rejected', () => {
  const rng = defaultGenerator(1);
  assert.throws(() => rng.uniform(-Number.MAX_VALUE, Number.MAX_VALUE), /Range/);
  assert.throws(() => rng.uniformArray(-Number.MAX_VALUE, Number.MAX_VALUE, 4), /Range/);
});

test('a negative normal scale is rejected', () => {
  assert.throws(() => defaultGenerator(1).normal(0, -1), /scale/);
});

test('hypot handles infinities, NaN and subnormals the way CPython does', () => {
  assert.equal(hypot(Infinity, NaN), Infinity);
  assert.equal(hypot(NaN, -Infinity), Infinity);
  assert.ok(Number.isNaN(hypot(NaN, 1)));
  assert.equal(hypot(0, 0), 0);
  assert.equal(hypot(-3, -4), 5);
  assert.equal(hypot(5e-324, 5e-324), Math.SQRT2 * 5e-324);
});

test('a zero-length target falls back to the shortest recordings', () => {
  const shortest = findNearestTrajectory([7, 7], [7, 7], { topN: 3 });
  assert.equal(shortest.length, 3);
  assert.ok(shortest[0].length <= shortest[1].length);
  assert.ok(shortest[1].length <= shortest[2].length);
});

test('findClosestTrajectory validates directness too', () => {
  const start: Point = [0, 0];
  const end: Point = [100, 100];
  assert.throws(
    () => findClosestTrajectory(start, end, defaultGenerator(1), { directness: 1.5 }),
    /directness/,
  );
});

test('the generator can be driven directly', () => {
  const rng = new Generator(createPcg64(3n));
  const value = rng.uniform(-1, 1);
  assert.ok(value >= -1 && value < 1);
  assert.equal(rng.choice(Float64Array.from([0, 0, 1])), 2);
});
