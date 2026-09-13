/** Behaviour of the public API, following the Python original's own test suite. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTrajectory } from '../src/cursory';
import { defaultGenerator } from '../src/random/generator';
import {
  findClosestTrajectory,
  findNearestTrajectory,
  findTrajectory,
  jitterTrajectory,
  LOADED_TRAJECTORIES,
  Point,
} from '../src/trajectorySelection';

const START: Point = [167.5, 805.25];
const END: Point = [1473.0, 18.75];

function isNonDecreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

test('sampling far above the recording rate still produces one point per timing', () => {
  const { points, timings } = generateTrajectory(START, END, { frequency: 2000, seed: 1 });

  assert.equal(points.length, timings.length);
  assert.ok(isNonDecreasing(timings));
  // Sampling faster than the recording changed position leaves the cursor still.
  assert.ok(
    points.some((point, index) => {
      const previous = points[index - 1];
      return previous !== undefined && previous[0] === point[0] && previous[1] === point[1];
    }),
    'no repeated position at 2000Hz',
  );
});

test('timings never go backwards under large jitter', () => {
  const { timings } = generateTrajectory(START, END, {
    frequency: 1000,
    frequencyRandomizer: 10,
    seed: 1,
  });

  assert.equal(timings[0], 0);
  assert.ok(isNonDecreasing(timings));
});

test('resampling does not force points onto a half-pixel grid', () => {
  const { points } = generateTrajectory(START, END, {
    frequency: 70,
    frequencyRandomizer: 0,
    seed: 1,
  });

  const interior = points.slice(1, -1);
  assert.ok(
    interior.some((point) => point.some((coordinate) => coordinate * 2 !== Math.round(coordinate * 2))),
    'every interior coordinate landed on a half pixel',
  );
});

test('a seed reproduces the trajectory and the endpoints are exact', () => {
  const start: Point = [0.1, 0.1];
  const end: Point = [258.2, 100.3];

  const first = generateTrajectory(start, end, { frequency: 100, seed: 42 });
  const second = generateTrajectory(start, end, { frequency: 100, seed: 42 });

  assert.deepEqual(first, second);
  assert.deepEqual(first.points[0], [start[0], start[1]]);
  assert.deepEqual(first.points[first.points.length - 1], [end[0], end[1]]);
});

test('different seeds produce different trajectories', () => {
  const first = generateTrajectory(START, END, { seed: 1 });
  const second = generateTrajectory(START, END, { seed: 2 });
  assert.notDeepEqual(first.points, second.points);
});

test('an unseeded call still lands on both endpoints', () => {
  const { points, timings } = generateTrajectory(START, END);
  assert.deepEqual(points[0], [START[0], START[1]]);
  assert.deepEqual(points[points.length - 1], [END[0], END[1]]);
  assert.equal(points.length, timings.length);
});

test('a zero-distance move is one stationary point', () => {
  assert.deepEqual(generateTrajectory([100, 100], [100, 100]), {
    points: [[100, 100]],
    timings: [0],
  });
});

test('out-of-range arguments are rejected', () => {
  for (const directness of [-0.01, 1.01, NaN]) {
    assert.throws(() => generateTrajectory(START, END, { directness }), /directness/);
  }
  assert.throws(() => generateTrajectory(START, END, { frequency: 0 }), /frequency/);
  assert.throws(() => generateTrajectory(START, END, { frequency: -1 }), /frequency/);
  assert.throws(
    () => generateTrajectory(START, END, { frequencyRandomizer: -1 }),
    /frequencyRandomizer/,
  );
});

test('the requested sampling rate is what comes back', () => {
  for (const frequency of [20, 60, 144, 250]) {
    const { timings } = generateTrajectory(START, END, { frequency, frequencyRandomizer: 0, seed: 7 });
    const span = timings[timings.length - 1] - timings[0];
    const measured = ((timings.length - 1) / span) * 1000;
    assert.ok(
      Math.abs(measured - frequency) < 1,
      `asked for ${frequency}Hz, sampled at ${measured.toFixed(2)}Hz`,
    );
  }
});

test('a movement shorter than its recording takes proportionally less time', () => {
  // Duration scales by sqrt(distance ratio) when a recording is replayed over a
  // shorter distance, and is left alone otherwise.
  let scaledSeen = 0;
  let unscaledSeen = 0;

  for (let seed = 0; seed < 40; seed += 1) {
    for (const end of [[START[0] + 30, START[1]], END] as Point[]) {
      const chosen = findClosestTrajectory(START, end, defaultGenerator(seed));
      const { timings } = findTrajectory(START, end, defaultGenerator(seed));

      const recorded = chosen.trajectory.timing;
      const recordedSpan = recorded[recorded.length - 1] - recorded[0];
      const span = timings[timings.length - 1] - timings[0];

      if (chosen.lengthTarget < chosen.trajectory.length) {
        const ratio = Math.sqrt(chosen.lengthTarget / chosen.trajectory.length);
        assert.ok(Math.abs(span - recordedSpan * ratio) < 1e-9, 'duration did not scale by sqrt');
        scaledSeen += 1;
      } else {
        assert.equal(span, recordedSpan, 'duration changed for a long-enough movement');
        unscaledSeen += 1;
      }
    }
  }
  assert.ok(scaledSeen > 0 && unscaledSeen > 0, 'both branches were exercised');
});

test('candidate recordings head the same way as the requested movement', () => {
  for (const end of [[500, 0], [-500, 0], [0, 500], [0, -500]] as Point[]) {
    const target: Point = [end[0], end[1]];
    for (const candidate of findNearestTrajectory([0, 0], target)) {
      const points = candidate.points;
      const dx = points[points.length - 1][0] - points[0][0];
      const dy = points[points.length - 1][1] - points[0][1];
      const length = Math.hypot(dx, dy);
      const targetLength = Math.hypot(target[0], target[1]);
      const cosine = (dx * target[0] + dy * target[1]) / (length * targetLength);
      assert.ok(cosine > 0.9, `candidate heads ${cosine} away from the target direction`);
    }
  }
});

test('directness shifts selection towards straighter recordings without excluding the rest', () => {
  const efficiencyOf = (directness: number, seed: number): number => {
    const { trajectory } = findClosestTrajectory(START, END, defaultGenerator(seed), {
      randomSampleIterations: 0,
      directness,
    });
    const points = trajectory.points;
    const displacement = Math.hypot(
      points[points.length - 1][0] - points[0][0],
      points[points.length - 1][1] - points[0][1],
    );
    return displacement / trajectory.length;
  };

  let directTotal = 0;
  let wanderingTotal = 0;
  const defaultChoices = new Set<number>();
  for (let seed = 0; seed < 300; seed += 1) {
    directTotal += efficiencyOf(1.0, seed);
    wanderingTotal += efficiencyOf(0.0, seed);
    const { trajectory } = findClosestTrajectory(START, END, defaultGenerator(seed), {
      randomSampleIterations: 0,
    });
    defaultChoices.add(LOADED_TRAJECTORIES.indexOf(trajectory));
  }

  assert.ok(directTotal > wanderingTotal, 'directness 1 did not favour straighter recordings');
  assert.ok(defaultChoices.size > 1, 'the default directness always picked the same recording');
});

test('jitter is lateral and not forced to alternate', () => {
  const points: Point[] = Array.from({ length: 20 }, (_unused, index) => [index, 0]);
  const jittered = jitterTrajectory(points, 400.0, defaultGenerator(1), 1.0);

  assert.deepEqual(
    jittered.map((point) => point[0]),
    points.map((point) => point[0]),
    'jitter moved points along the path instead of across it',
  );
  assert.ok(
    jittered.some((point, index) => index > 0 && point[1] * jittered[index - 1][1] > 0),
    'every consecutive offset flipped sign',
  );
});
