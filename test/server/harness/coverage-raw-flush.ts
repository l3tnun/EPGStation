import { afterAll, afterEach } from 'vitest';

/**
 * Deferred to a dynamic import inside the callback (rather than a static top-level import) so
 * `./coverage-raw-flush-guard.ts` is not resolved during this file's synchronous `setupFiles`
 * execution. A static import here would cache the guard module bound to the real `node:v8`
 * before a test file's own `vi.mock('node:v8')` registers, making that mock unobservable.
 */
afterAll(async () => {
    const { flushWorkerRawCoverageIfEnabled } = await import('./coverage-raw-flush-guard.ts');
    flushWorkerRawCoverageIfEnabled();
});

/**
 * Captures this worker's own Vitest SSR-transformed module bodies (see
 * `coverage-transform-capture.ts`'s own module doc) before the fork pool's `kill()` above ever lands.
 * Runs before the raw flush is unnecessary (the two capture different, independent data), but must
 * still happen in this same worker-alive window; ordering relative to the callback above does not
 * matter, so it is registered as its own `afterAll` for readability. No-ops (see that file) unless
 * `EPGSTATION_COVERAGE_TRANSFORM_DIR` is set, so a non-coverage run pays nothing for this.
 *
 * Capture loss under `vi.resetModules()`: also registered on
 * `afterEach`, not only this worker-final `afterAll` -- `vi.resetModules()` (Vite's own
 * `EvaluatedModules#invalidateModule`, `node_modules/vite/dist/node/module-runner.js`) clears
 * `node.meta` for every currently-loaded module, so a capture taken only at worker teardown would
 * silently lose any module whose owning test reset modules at any point before then, even though that
 * module's own transformed `code` at that earlier moment is exactly what a raw range recorded *during*
 * that test corresponds to. `coverage-transform-capture.ts`'s own module-scope dedup keeps this
 * additional per-test call from multiplying file count/disk use by the number of tests -- only a
 * genuinely new distinct transformed version is ever written.
 */
afterEach(async () => {
    const { captureWorkerTransformedModulesIfEnabled } = await import('./coverage-transform-capture.ts');
    captureWorkerTransformedModulesIfEnabled();
});

afterAll(async () => {
    const { captureWorkerTransformedModulesIfEnabled } = await import('./coverage-transform-capture.ts');
    captureWorkerTransformedModulesIfEnabled();
});

/**
 * Performance: capture writes are asynchronous and not awaited inline
 * (see `coverage-transform-capture.ts`'s own module doc) so a slow disk never blocks a test's own
 * `afterEach`. Registered after the worker-final `captureWorkerTransformedModulesIfEnabled` call above
 * (Vitest runs `afterAll` hooks in registration order), so every write that call could possibly queue is
 * already in the pending list by the time this runs -- awaiting them here, still inside this same
 * worker-alive window, before the fork pool's own `kill()` can land.
 */
afterAll(async () => {
    const { flushPendingTransformCaptureWrites } = await import('./coverage-transform-capture.ts');
    await flushPendingTransformCaptureWrites();
});
