import { getOrBuildCachedDist } from '../build-cache.mjs';
import { main } from './process.mjs';

// This does not `rm('dist')` or run `tsc` into the shared, mutable repository-root `dist/` directory:
// doing so would make `npm run test:server:build` unsafe to run concurrently with any other process
// reading root `dist/` (including a nested `run-tests.mjs` child process spawned by a test in the
// same full-suite run), failing with `ENOENT: lstat 'dist'` under contention.
// It only ensures a validated, immutable, content-addressed cache entry exists; every server
// test and coverage consumer reads that cache (directly or via a private copy) instead
// of root `dist/`. `npm run build-server` / `npm run compile` (plain `tsc`) are untouched and
// still populate root `dist/` for end users.
await main(async () => {
    await getOrBuildCachedDist();
});
