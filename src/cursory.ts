/** Port of `cursory/cursory.py`. */

import { EPSILON, hypot, rint, sum } from './numeric';
import { defaultGenerator, Generator } from './random/generator';
import {
  findTrajectory,
  jitterTrajectory,
  knotTrajectory,
  morphTrajectory,
  Point,
} from './trajectorySelection';

export interface GenerateTrajectoryOptions {
  /** Samples per second. Defaults to 60. */
  frequency?: number;
  /** Largest jitter, in milliseconds, applied to each sample time. Defaults to 1. */
  frequencyRandomizer?: number;
  /** Seed for a reproducible trajectory. Defaults to OS entropy. */
  seed?: number | bigint;
  /** Relative preference for shorter, straighter paths, from 0 to 1. Defaults to 0.65. */
  directness?: number;
}

export interface GeneratedTrajectory {
  /** Cursor positions to move through. */
  points: Point[];
  /** Milliseconds since the start of the movement, one per point. */
  timings: number[];
}

/**
 * Resample a recording's timing pattern to the requested rate.
 *
 * The gaps between samples come from the recording rather than from a constant
 * interval, so the result keeps a real hand's hesitations instead of looking
 * like a metronome.
 */
function sampleTimings(
  timings: readonly number[],
  frequency: number,
  frequencyRandomizer: number,
  rng: Generator,
): number[] {
  const totalTime = Math.max(1, rint(timings[timings.length - 1] - timings[0]));
  const intervalCount = Math.max(1, rint((totalTime * frequency) / 1000));

  let recordedIntervals: number[] = [];
  for (let i = 1; i < timings.length; i += 1) {
    const interval = timings[i] - timings[i - 1];
    if (interval > 0) {
      recordedIntervals.push(interval);
    }
  }
  if (recordedIntervals.length === 0) {
    recordedIntervals = [1];
  }

  // Time-warp the recording's interval sequence onto the requested sample count,
  // starting from a random offset so the same recording does not always hesitate
  // in the same place.
  const rollBy = rng.integers(recordedIntervals.length);
  const sampledIntervals = new Float64Array(intervalCount);
  for (let i = 0; i < intervalCount; i += 1) {
    const sourceIndex = Math.floor(((i + 0.5) * recordedIntervals.length) / intervalCount);
    sampledIntervals[i] = recordedIntervals[(sourceIndex + rollBy) % recordedIntervals.length];
  }
  rescaleToTotal(sampledIntervals, totalTime);

  if (frequencyRandomizer) {
    const noise = rng.uniformArray(-frequencyRandomizer, frequencyRandomizer, intervalCount);
    for (let i = 0; i < intervalCount; i += 1) {
      sampledIntervals[i] = Math.max(sampledIntervals[i] + noise[i], EPSILON);
    }
    rescaleToTotal(sampledIntervals, totalTime);
  }

  const sampledTimings = [0];
  let elapsed = 0;
  for (let i = 0; i < intervalCount; i += 1) {
    elapsed += sampledIntervals[i];
    sampledTimings.push(rint(elapsed));
  }
  sampledTimings[sampledTimings.length - 1] = totalTime;
  return sampledTimings;
}

function rescaleToTotal(intervals: Float64Array, totalTime: number): void {
  const factor = totalTime / sum(intervals);
  for (let i = 0; i < intervals.length; i += 1) {
    intervals[i] *= factor;
  }
}

/**
 * Generate a human-realistic mouse trajectory from one point to another.
 *
 * @param targetStart Where the cursor starts.
 * @param targetEnd Where the cursor ends up.
 * @returns The positions to move through, and the millisecond offset of each.
 */
export function generateTrajectory(
  targetStart: Point,
  targetEnd: Point,
  options: GenerateTrajectoryOptions = {},
): GeneratedTrajectory {
  const { frequency = 60, frequencyRandomizer = 1, seed, directness = 0.65 } = options;

  if (frequency <= 0) {
    throw new RangeError('frequency must be greater than zero');
  }
  if (frequencyRandomizer < 0) {
    throw new RangeError('frequencyRandomizer must not be negative');
  }
  if (!(directness >= 0 && directness <= 1)) {
    throw new RangeError('directness must be between zero and one');
  }
  if (targetStart[0] === targetEnd[0] && targetStart[1] === targetEnd[1]) {
    return { points: [[targetStart[0], targetStart[1]]], timings: [0] };
  }

  const rng = defaultGenerator(seed);

  const found = findTrajectory(targetStart, targetEnd, rng, directness);
  const trajectoryPoints = found.points;
  const startTime = found.timings[0];
  const timings = found.timings.map((timing) => timing - startTime);

  const sampledTimings = sampleTimings(timings, frequency, frequencyRandomizer, rng);

  // Read the path's position at each sample time, interpolating between the
  // recording's own keyframes.
  const sampledPoints: Point[] = sampledTimings.map((sampleTime) => {
    let previousIndex = 0;
    for (let i = 0; i < timings.length; i += 1) {
      if (timings[i] <= sampleTime) {
        previousIndex = i;
      }
    }
    const nextIndex = Math.min(previousIndex + 1, timings.length - 1);

    const previousPoint = trajectoryPoints[previousIndex];
    const previousTime = timings[previousIndex];
    const nextPoint = trajectoryPoints[nextIndex];
    const nextTime = timings[nextIndex];

    const alpha = nextTime !== previousTime ? (sampleTime - previousTime) / (nextTime - previousTime) : 0.0;
    return [
      previousPoint[0] + alpha * (nextPoint[0] - previousPoint[0]),
      previousPoint[1] + alpha * (nextPoint[1] - previousPoint[1]),
    ];
  });

  const dxTarget = targetEnd[0] - targetStart[0];
  const dyTarget = targetEnd[1] - targetStart[1];
  const trajectoryLength = Math.sqrt(dxTarget * dxTarget + dyTarget * dyTarget);

  // Re-roughen the resampled path, which interpolation has smoothed, then put it
  // back on the requested endpoints.
  const knotted = knotTrajectory(sampledPoints, targetStart, targetEnd, rng);
  const jittered = jitterTrajectory(knotted, trajectoryLength, rng);
  const points = morphTrajectory(
    jittered,
    targetStart,
    targetEnd,
    dxTarget,
    dyTarget,
    hypot(dxTarget, dyTarget),
  );

  return { points, timings: sampledTimings };
}
