# Contributing

## Getting set up

```bash
npm install
npm test
```

`npm test` compiles `src/` and `test/` into `.test-build/` and runs them with
node's built-in test runner. `npm run coverage` adds a coverage report.

## The one rule that is different here

**This is a port. Matching the Python original beats improving on it.**

Cursory's output for a given seed is a contract: someone who tunes a seed in
Python should get the same movement here. Anything that changes which random
numbers get drawn, or in what order, breaks that — including changes that look
like pure cleanups. If you find something in `src/trajectorySelection.ts` or
`src/cursory.ts` that looks wrong, check
[the original](https://github.com/Vinyzu/cursory) before changing it: it is
probably faithful on purpose, and `README.md` explains the one quirk that is
reproduced deliberately.

Improvements to the algorithms themselves belong upstream first.

## Parity fixtures

`test/fixtures/parity.json` holds output recorded from Python Cursory 2.0.0. To
regenerate it:

```bash
pip install "cursory==2.0.0" "numpy~=2.3"
python scripts/generate-parity-fixtures.py
```

The generator skips cases where numpy's own candidate ordering is not
reproducible across CPUs, so do not remove that check to make a case pass.

## Code

- **Less code.** More code is a cost, not an achievement.
- **Fail loudly.** A fallback turns a loud failure into a silently wrong
  trajectory. The RNG raises on inputs it cannot handle exactly, and that is
  deliberate.
- **Comments say why.** The numeric code looks strange in places because it
  reproduces a specific evaluation order; say which one and leave it alone.
- **Every README snippet runs**, and `test/readme.test.ts` proves it. Update the
  README in the same change as the code.

## Tests

- Every bug gets a regression test: reproduce it with a failing test, fix it,
  watch it pass.
- No flaky tests. An intermittent failure means something is non-deterministic;
  fix the behaviour rather than retrying or loosening the assertion.
- Run the failing test rather than the whole suite while iterating; CI runs
  everything on Node 18, 20, 22 and 24.

## Releasing

1. Bump `version` in `package.json` on `dev`, and merge to `main`.
2. Publish a GitHub release tagged `vX.Y.Z`.
3. The `Publish to npm` workflow checks the tag against `package.json`, runs the
   tests, and publishes.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers):
the workflow authenticates with its own OIDC identity, so there is no npm token
in this repository to leak or rotate, and provenance is attached automatically.
The package's trusted publisher on npmjs.com is this repository, the workflow
`.github/workflows/publish.yml`, and the `npm` environment.
