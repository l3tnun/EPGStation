/**
 * Files whose rows drive real processes against fixed wall-clock budgets: real Docker builds and
 * containers against the daemon, and a real package install plus compile in a clean directory.
 * `run-tests.mjs` keeps every one of these files out of a whole-layer run's parallel batch: they run
 * alone, afterward, `--maxWorkers 1 --no-file-parallelism` (the serialized dispatch in
 * `run-tests.mjs`) -- the image builds and containers hold the daemon for the duration, which the
 * MySQL fixture teardown of the other files depends on, and the install and compile take several
 * times longer when they compete with a parallel batch for CPU and disk. The coverage run measures unit tests only and rejects any of these files.
 *
 * Paths are relative to `test/server/` (the exact convention `run-tests.mjs`'s CLI filters already
 * use: `normalizeFilter` strips that prefix from every locator before comparing).
 */
export const SERIALIZED_REAL_PROCESS_FILES = Object.freeze([
    // Builds and starts the Debian and Alpine production images against a prepared dependency
    // image and a real Docker daemon, then removes everything the run created.
    'application-runtime/docker-image.integration.test.ts',
    // Runs a real install and compile in a clean directory with the dedicated tuner client package
    // absent, under a per-child budget that a contended parallel batch can exceed.
    'tuner-access/clean-install.integration.test.ts',
]);
