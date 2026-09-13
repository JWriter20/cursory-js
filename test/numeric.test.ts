/**
 * The numeric primitives stand in for numpy and CPython routines, so they are
 * checked against values those routines actually produced, not against a
 * hand-written expectation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { argSortTopN, hypot, rint, searchSortedRight, sum } from '../src/numeric';

interface NumericFixture {
  numeric: {
    sums: { values: number[]; sum: number }[];
    hypots: { x: number; y: number; hypot: number }[];
    rints: { value: number; rint: number }[];
  };
}

const { numeric } = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'parity.json'), 'utf8'),
) as NumericFixture;

test('sum reproduces numpy pairwise summation bit for bit', () => {
  for (const { values, sum: expected } of numeric.sums) {
    assert.equal(sum(Float64Array.from(values)), expected, `sum of ${values.length} values`);
  }
});

test('sum differs from a running total where numpy does', () => {
  // Guards against the pairwise blocking being quietly replaced by a simple loop.
  const blocked = numeric.sums.filter(({ values }) => {
    let running = 0;
    for (const value of values) {
      running += value;
    }
    return running !== sum(Float64Array.from(values));
  });
  assert.ok(blocked.length > 0, 'no fixture distinguishes pairwise summation from a running total');
});

test('hypot reproduces math.hypot bit for bit', () => {
  for (const { x, y, hypot: expected } of numeric.hypots) {
    assert.equal(hypot(x, y), expected, `hypot(${x}, ${y})`);
  }
});

test('rint rounds halves to even, as Python and numpy do', () => {
  for (const { value, rint: expected } of numeric.rints) {
    assert.equal(rint(value), expected, `rint(${value})`);
  }
});

test('searchSortedRight returns the index past any equal entries', () => {
  const sorted = [0.1, 0.2, 0.2, 0.2, 0.9];
  assert.equal(searchSortedRight(sorted, 0.0), 0);
  assert.equal(searchSortedRight(sorted, 0.1), 1);
  assert.equal(searchSortedRight(sorted, 0.2), 4);
  assert.equal(searchSortedRight(sorted, 0.5), 4);
  assert.equal(searchSortedRight(sorted, 0.9), 5);
  assert.equal(searchSortedRight(sorted, 1.0), 5);
  assert.equal(searchSortedRight([], 1.0), 0);
});

test('argSortTopN is ascending and breaks ties by index', () => {
  assert.deepEqual(argSortTopN([3, 1, 2], 2), [1, 2]);
  assert.deepEqual(argSortTopN([5, 5, 5, 1], 3), [3, 0, 1]);
  assert.deepEqual(argSortTopN([], 5), []);
  assert.deepEqual(argSortTopN([2, 1], 5), [1, 0], 'asking for more than there is');
});

test('argSortTopN agrees with a full stable sort, ties included', () => {
  // Selection is an optimisation; it must not change which candidates win.
  let state = 12345;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };

  for (let trial = 0; trial < 300; trial += 1) {
    const length = 1 + Math.floor(next() * 60);
    // Coarse values, so exact ties are common.
    const values = Array.from({ length }, () => Math.round(next() * 6));
    const reference = Array.from({ length }, (_unused, index) => index).sort(
      (left, right) => values[left] - values[right] || left - right,
    );
    for (const count of [1, 3, 5, 20]) {
      assert.deepEqual(
        argSortTopN(values, count),
        reference.slice(0, count),
        `top ${count} of ${JSON.stringify(values)}`,
      );
    }
  }
});
