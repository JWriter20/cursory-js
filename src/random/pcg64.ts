/**
 * PCG64 (XSL-RR 128/64), ported from numpy/random/src/pcg64/pcg64.h.
 *
 * © 2014 Melissa O'Neill, © 2015 Robert Kern. MIT licensed, as vendored by numpy.
 */

import { randomBytes } from 'node:crypto';

import { generateState64, intToUint32Array, mixEntropy } from './seedSequence';

const MASK64 = 0xffffffffffffffffn;
const MASK128 = (1n << 128n) - 1n;
const MULTIPLIER = (2549297995355413924n << 64n) + 4865540595714422341n;

/** 2**-53, numpy's uint64 -> double conversion factor. */
const DOUBLE_SCALE = 1.0 / 9007199254740992.0;

export class Pcg64 {
  private state = 0n;
  private readonly increment: bigint;

  // next_uint32 hands out a 64-bit draw in two halves; the unused half is held here.
  private hasSpareUint32 = false;
  private spareUint32 = 0;

  constructor(initialState: bigint, initialSequence: bigint) {
    this.increment = ((initialSequence << 1n) | 1n) & MASK128;
    this.step();
    this.state = (this.state + initialState) & MASK128;
    this.step();
  }

  private step(): void {
    this.state = (this.state * MULTIPLIER + this.increment) & MASK128;
  }

  nextUint64(): bigint {
    this.step();
    const state = this.state;
    const value = ((state >> 64n) ^ state) & MASK64;
    const rotation = (state >> 122n) & 63n;
    return ((value >> rotation) | (value << ((64n - rotation) & 63n))) & MASK64;
  }

  nextUint32(): number {
    if (this.hasSpareUint32) {
      this.hasSpareUint32 = false;
      return this.spareUint32;
    }
    const next = this.nextUint64();
    this.hasSpareUint32 = true;
    this.spareUint32 = Number(next >> 32n);
    return Number(next & 0xffffffffn);
  }

  nextDouble(): number {
    return Number(this.nextUint64() >> 11n) * DOUBLE_SCALE;
  }
}

/**
 * Build the bit generator `np.random.default_rng(seed)` would build.
 *
 * Passing no seed draws 128 bits of OS entropy, matching numpy's `randbits(128)`.
 */
export function createPcg64(seed?: number | bigint): Pcg64 {
  const entropy = intToUint32Array(seed === undefined ? randomEntropy() : toSeedInteger(seed));
  const state = generateState64(mixEntropy(entropy), 4);
  return new Pcg64((state[0] << 64n) | state[1], (state[2] << 64n) | state[3]);
}

function toSeedInteger(seed: number | bigint): bigint {
  if (typeof seed === 'bigint') {
    return seed;
  }
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(
      'seed must be a safe integer or a bigint; larger seeds lose precision as a number',
    );
  }
  return BigInt(seed);
}

function randomEntropy(): bigint {
  let value = 0n;
  for (const byte of randomBytes(16)) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}
