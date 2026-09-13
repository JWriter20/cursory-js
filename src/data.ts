import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** One recorded human mouse movement. */
export interface Trajectory {
  /** Recorded cursor positions, in screen pixels. */
  readonly points: readonly (readonly [number, number])[];
  /** Timestamp of each point, in milliseconds. */
  readonly timing: readonly number[];
  /** Distance travelled along the path, in pixels. */
  readonly length: number;
}

/**
 * Every recorded trajectory Cursory picks from. The file is the one shipped with
 * the Python original, byte for byte.
 */
export const LOADED_TRAJECTORIES: readonly Trajectory[] = JSON.parse(
  gunzipSync(readFileSync(join(__dirname, 'trajectories.json.gz'))).toString('utf8'),
) as Trajectory[];
