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
  knotTrajectory,
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

test('noise leaves endpoints and stationary paths where they were', () => {
  const paths: Point[][] = [
    [[10, 20]],
    [[10, 20], [10, 20], [10, 20], [10, 20]],
    [[0, 0], [0, 0], [25, 40], [50, 50], [50, 50]],
  ];
  for (const noise of ['jitter', 'knots']) {
    for (const points of paths) {
      const rng = defaultGenerator(1);
      const first = points[0];
      const last = points[points.length - 1];
      const output =
        noise === 'jitter'
          ? jitterTrajectory(points, 400, rng, 1)
          : knotTrajectory(points, first, last, rng);

      assert.deepEqual(output[0], first, `${noise} moved the start`);
      assert.deepEqual(output[output.length - 1], last, `${noise} moved the end`);
      assert.ok(output.flat().every(Number.isFinite));
      if (first[0] === last[0] && first[1] === last[1]) {
        assert.deepEqual(output, points, `${noise} moved a stationary path`);
      } else {
        assert.notDeepEqual(output[2], points[2], `${noise} left the middle untouched`);
      }
    }
  }
});

test('the shape does not depend on where on the screen the movement happens', () => {
  const offset: Point = [540.0, 360.0];
  const first = generateTrajectory([960.0, 540.0], [960.0, 240.0], { seed: 42 });
  const moved = generateTrajectory([1500.0, 900.0], [1500.0, 600.0], { seed: 42 });

  assert.deepEqual(moved.timings, first.timings);
  first.points.forEach((point, index) => {
    assert.ok(Math.abs(moved.points[index][0] - offset[0] - point[0]) < 1e-8);
    assert.ok(Math.abs(moved.points[index][1] - offset[1] - point[1]) < 1e-8);
  });
});

test('an upward move does not double back as it arrives', () => {
  const { points } = generateTrajectory([960.0, 540.0], [960.0, 240.0], { seed: 2000001 });
  const arc = [0];
  for (let i = 1; i < points.length; i += 1) {
    arc.push(arc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  // Compare directions over the final two 5-pixel stretches, ignoring sample
  // density and endpoint pauses.
  const at = (distance: number): Point => {
    const index = arc.findIndex((value) => value >= distance);
    if (index <= 0) {
      return points[Math.max(index, 0)];
    }
    const alpha = (distance - arc[index - 1]) / (arc[index] - arc[index - 1] || 1);
    return [
      points[index - 1][0] + alpha * (points[index][0] - points[index - 1][0]),
      points[index - 1][1] + alpha * (points[index][1] - points[index - 1][1]),
    ];
  };
  const total = arc[arc.length - 1];
  const [a, b, c] = [at(total - 10), at(total - 5), at(total)];
  const first = [b[0] - a[0], b[1] - a[1]];
  const second = [c[0] - b[0], c[1] - b[1]];
  const dot = first[0] * second[0] + first[1] * second[1];

  assert.ok(dot > 0.5 * Math.hypot(first[0], first[1]) * Math.hypot(second[0], second[1]));
});
