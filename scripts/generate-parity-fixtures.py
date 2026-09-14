"""Record what the Python original produces, so the port can be tested against it.

    pip install "cursory==2.0.0" "numpy~=2.3"
    python scripts/generate-parity-fixtures.py [--cases N]

Writes test/fixtures/parity.json. Re-run it only to add cases or to move to a new
upstream release; the checked-in file is what CI compares against. --cases trades
repository size for confidence: the coordinate agreement quoted in README.md was
measured with several hundred, far more than is worth committing.

Cases where numpy's own candidate ordering is not reproducible are skipped. numpy
sorts the candidate scores with an unstable introsort whose SIMD kernel is chosen
at run time, so when two recordings score exactly the same, which one comes first
depends on the CPU that generated the fixture. Those cases are excluded here
rather than being baked in as if they were stable.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import numpy as np

import cursory.trajectory_selection as selection
from cursory import generate_trajectory

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "parity.json"
DEFAULT_CASE_COUNT = 150
# 2**160 exceeds SeedSequence's four-word pool, exercising its spill path.
RNG_SEEDS = [0, 1, 2, 42, 12345, 2**31, 2**32, 2**32 + 7, 2**53, 2**64 + 12345, 2**128 - 1, 2**160 + 12345]
INTEGER_RANGES = [1, 2, 3, 5, 86, 255, 256, 1000, 2357, 65535, 65536, 2**32, 10**6]
NORMAL_STREAM_SEED = 7
NORMAL_STREAM_LENGTH = 200_000


class TieDetector:
    """Wraps find_nearest_trajectory to flag queries numpy cannot order stably."""

    def __init__(self) -> None:
        self.original = selection.find_nearest_trajectory
        self.tie_seen = False

    def __enter__(self) -> "TieDetector":
        selection.find_nearest_trajectory = self._wrapper
        return self

    def __exit__(self, *_exc: object) -> None:
        selection.find_nearest_trajectory = self.original

    def _wrapper(self, target_start, target_end, direction_weight=0.8, length_weight=0.2, top_n=5):
        dx = target_end[0] - target_start[0]
        dy = target_end[1] - target_start[1]
        length = math.hypot(dx, dy)
        if length != 0:
            displacements = selection.TRAJECTORIES_DISPLACEMENTS
            norm_dx = np.divide(
                selection.TRAJECTORIES_DX, displacements,
                out=np.zeros_like(selection.TRAJECTORIES_DX, dtype=float), where=displacements != 0,
            )
            norm_dy = np.divide(
                selection.TRAJECTORIES_DY, displacements,
                out=np.zeros_like(selection.TRAJECTORIES_DY, dtype=float), where=displacements != 0,
            )
            direction_distance = 1 - (norm_dx * (dx / length) + norm_dy * (dy / length))
            length_diff_ratio = np.abs(displacements - length) / max(length, 1)
            scores = direction_weight * direction_distance + length_weight * length_diff_ratio
        else:
            scores = np.array([trajectory["length"] for trajectory in selection.LOADED_TRAJECTORIES])

        cut = np.sort(scores)[: top_n + 1]
        if len(set(cut.tolist())) < len(cut):
            self.tie_seen = True
        return self.original(target_start, target_end, direction_weight, length_weight, top_n)


def build_cases(case_count: int) -> list[dict]:
    random.seed(20260913)
    cases = [
        {"start": [0, 0], "end": [1, 0], "frequency": 60, "frequencyRandomizer": 1, "seed": 1, "directness": 0.65},
        {"start": [10, 10], "end": [10, 11], "frequency": 60, "frequencyRandomizer": 0, "seed": 2, "directness": 0.65},
        {"start": [500, 500], "end": [500, 100], "frequency": 500, "frequencyRandomizer": 0, "seed": 3, "directness": 0.65},
        {"start": [0, 0], "end": [1919, 1079], "frequency": 1, "frequencyRandomizer": 0, "seed": 4, "directness": 1.0},
        {"start": [3.5, 2.25], "end": [-800.125, -400.75], "frequency": 60, "frequencyRandomizer": 3, "seed": 5, "directness": 0.0},
        {"start": [100.0, 100.0], "end": [100.0, 100.0], "frequency": 60, "frequencyRandomizer": 1, "seed": 6, "directness": 0.65},
        {"start": [0, 0], "end": [5000, 3000], "frequency": 60, "frequencyRandomizer": 1, "seed": 2**39, "directness": 0.5},
    ]
    while len(cases) < case_count:
        cases.append({
            "start": [random.uniform(0, 1920), random.uniform(0, 1080)],
            "end": [random.uniform(0, 1920), random.uniform(0, 1080)],
            "frequency": random.choice([20, 60, 100, 144, 250]),
            "frequencyRandomizer": random.choice([0, 1, 2, 10]),
            "seed": random.randrange(0, 2**40),
            "directness": random.choice([0.0, 0.25, 0.65, 1.0]),
        })
    return cases[:case_count] if case_count < len(cases) else cases


def record_trajectories(case_count: int) -> tuple[list[dict], int]:
    recorded, skipped = [], 0
    for case in build_cases(case_count):
        with TieDetector() as detector:
            points, timings = generate_trajectory(
                (case["start"][0], case["start"][1]),
                (case["end"][0], case["end"][1]),
                frequency=case["frequency"],
                frequency_randomizer=case["frequencyRandomizer"],
                seed=case["seed"],
                directness=case["directness"],
            )
        if detector.tie_seen:
            skipped += 1
            continue
        recorded.append({
            "case": case,
            "timings": [int(timing) for timing in timings],
            "points": [[float(point[0]), float(point[1])] for point in points],
        })
    return recorded, skipped


def record_rng() -> dict:
    import hashlib

    vectors = {}
    for seed in RNG_SEEDS:
        generator = np.random.default_rng(seed)
        raw = [str(int(value)) for value in generator.bit_generator.random_raw(16)]
        generator = np.random.default_rng(seed)
        doubles = [float(value) for value in generator.random(16)]
        generator = np.random.default_rng(seed)
        normals = [float(value) for value in generator.normal(size=64)]
        generator = np.random.default_rng(seed)
        integers = [int(generator.integers(n)) for n in INTEGER_RANGES]
        generator = np.random.default_rng(seed)
        # A range whose Lemire threshold rejects roughly 30% of draws, so the
        # rejection loop is covered rather than assumed.
        rejecting = [int(generator.integers(3_000_000_000)) for _ in range(500)]
        generator = np.random.default_rng(seed)
        uniforms = [float(value) for value in generator.uniform(-3.5, 7.25, size=8)]
        generator = np.random.default_rng(seed)
        weights = np.arange(1, 106, dtype=float)
        weights /= weights.sum()
        choices = [int(generator.choice(len(weights), p=weights)) for _ in range(8)]
        vectors[str(seed)] = {
            "raw": raw, "doubles": doubles, "normals": normals,
            "integers": integers, "rejectingIntegers": rejecting,
            "uniforms": uniforms, "choices": choices,
        }

    generator = np.random.default_rng(NORMAL_STREAM_SEED)
    stream = generator.normal(size=NORMAL_STREAM_LENGTH).astype("<f8").tobytes()
    return {
        "vectors": vectors,
        "normalStream": {
            "seed": NORMAL_STREAM_SEED,
            "length": NORMAL_STREAM_LENGTH,
            "sha256": hashlib.sha256(stream).hexdigest(),
        },
    }


def record_numeric() -> dict:
    """Reference values for the numpy and CPython primitives the port reimplements."""
    rng = np.random.default_rng(4242)
    sums = []
    for size in (0, 1, 2, 7, 8, 9, 16, 100, 128, 129, 256, 1000, 4097):
        values = rng.uniform(-1e6, 1e6, size=size)
        sums.append({"values": values.tolist(), "sum": float(values.sum())})
    # Sizes where numpy's pairwise blocking differs most from a running total.
    for size in (8, 128, 129, 1000):
        values = np.full(size, 0.1) + rng.uniform(-1e-9, 1e-9, size=size)
        sums.append({"values": values.tolist(), "sum": float(values.sum())})

    pairs = [(3.0, 4.0), (0.0, 0.0), (1e-320, 1e-320), (1e308, 1e308), (5e-324, 0.0),
             (1.0, 1e-200), (-1920.0, 1080.0), (2.2250738585072014e-308, 1.0)]
    pairs += [(float(x), float(y)) for x, y in rng.uniform(-3000, 3000, size=(64, 2))]
    hypots = [{"x": x, "y": y, "hypot": math.hypot(x, y)} for x, y in pairs]

    rints = [{"value": value, "rint": round(value)} for value in
             (0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 0.49999999999999994, 2.675,
              1e15 + 0.5, -1e15 - 0.5, 0.0, -0.0, 123.0)]
    return {"sums": sums, "hypots": hypots, "rints": rints}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cases", type=int, default=DEFAULT_CASE_COUNT,
        help=f"how many trajectories to record (default: {DEFAULT_CASE_COUNT})",
    )
    arguments = parser.parse_args()

    trajectories, skipped = record_trajectories(arguments.cases)
    fixture = {
        "source": "https://github.com/Vinyzu/cursory",
        "cursoryVersion": "2.0.0",
        "numpyVersion": np.__version__,
        "skippedTiedCases": skipped,
        "rng": record_rng(),
        "numeric": record_numeric(),
        "trajectories": trajectories,
    }
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"wrote {FIXTURE_PATH} - {len(trajectories)} trajectories, {skipped} tied cases skipped")


if __name__ == "__main__":
    main()
