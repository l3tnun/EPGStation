import { stopCoverage, takeCoverage } from 'node:v8';

/**
 * Once-per-process guard for the listeners registered below. `flushWorkerRawCoverageIfEnabled` runs
 * from the sibling `coverage-raw-flush.ts` `afterAll`, which fires more than once in one worker
 * process, and the listeners must not pile up.
 */
let exitWriteSuppressionRegistered = false;

/**
 * Writes this worker's raw V8 dump (`NODE_V8_COVERAGE`) while the worker is still guaranteed to be
 * alive, and makes sure the process never writes another one afterwards.
 *
 * Where the dumps come from. With `NODE_V8_COVERAGE` set, Node writes a dump (a) on every
 * `v8.takeCoverage()` call and (b) once more at process exit, from `EndStartedProfilers` in
 * `src/inspector_profiler.cc`, registered with `AtExit`. Both write the whole file with one
 * synchronous `WriteFileSync` (`src/util.cc`: open with `O_TRUNC`, write, close) -- not atomic, so a
 * process killed during the write leaves a truncated `.json` that the converter rejects as
 * `malformed-raw-dump`.
 *
 * (a) is safe here. The `afterAll` call runs before the worker reports `testfileFinished`, and
 * Vitest's pool only asks a worker to stop after that message (`PoolRunner#stop()` sends `stop`,
 * waits for `stopped`, then `ForksPoolWorker#stop()` sends SIGTERM with a 500 ms SIGKILL behind it,
 * `node_modules/vitest/dist/chunks/index.*.js`). No signal can reach the worker during this write.
 *
 * (b) is what got cut. After the worker answers `stopped`, its teardown has removed its IPC
 * `message` listeners, so its event loop can drain and the process can start exiting on its own
 * before the parent's SIGTERM arrives. On that natural exit path Node runs `FreeEnvironment`
 * (`src/api/environment.cc`): `RunCleanup()` closes every handle, including the signal handle behind
 * the SIGTERM listener below, which restores SIGTERM's default disposition, and only then
 * `RunAtExit()` writes dump (b). A SIGTERM landing during that write therefore kills the process
 * immediately and leaves the file cut (observed: a third same-pid dump of 0 bytes or an exact
 * multiple of 32 KiB, written after the two `afterAll` dumps, from a worker that emitted `exit`
 * without ever running its SIGTERM listener; reproduced outside Vitest by sending SIGTERM to a
 * drained child the moment its exit-time dump appears).
 *
 * So (b) is suppressed on both exit paths by stopping precise coverage first; with coverage stopped,
 * the exit-time `Profiler.takePreciseCoverage` returns "Precise coverage has not been started." and
 * nothing is written.
 * - SIGTERM path: the listener stops coverage and exits.
 * - natural exit / `process.exit` path: the `exit` listener stops coverage. Node emits `exit` before
 *   `FreeEnvironment`/`RunAtExit`, so this always runs before the exit-time write would.
 * What (b) would have held is only code that ran after the last `afterAll` dump, i.e. Vitest's own
 * teardown; the last `afterAll` dump is the worker's final capture on every path.
 *
 * `stopCoverage()` is never called from the `afterAll` itself: that would disable block coverage for
 * everything the same process still loads (V8 falls back to function-level counts), and the
 * `afterAll` fires more than once per worker.
 */
export function flushWorkerRawCoverageIfEnabled(): void {
    if (process.env.NODE_V8_COVERAGE === undefined) {
        return;
    }
    if (!exitWriteSuppressionRegistered) {
        exitWriteSuppressionRegistered = true;
        process.once('SIGTERM', () => {
            stopCoverage();
            process.exit(0);
        });
        process.once('exit', () => {
            stopCoverage();
        });
    }
    takeCoverage();
}
