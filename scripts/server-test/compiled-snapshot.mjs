import { cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { getOrBuildCachedDist } from '../build-cache.mjs';

// `withCompiledSnapshot` does not read the mutable repository-root `dist/` by default. When a caller does not pass an explicit
// `source`, the compiled snapshot comes from the immutable, content-addressed build cache
// (see build-cache.mjs) instead, keyed on the actual on-disk bytes under `repositoryRoot`. Callers
// that pass an explicit `source` (every synthetic/isolated test fixture in this repository does)
// are completely unaffected: this never touches the build cache in that case.
async function resolveDefaultSource(repositoryRoot, cacheOptions) {
    return getOrBuildCachedDist({ repositoryRoot, ...cacheOptions });
}

const errorCode = error => (error instanceof Error && 'code' in error ? String(error.code) : undefined);

// A caller (e.g. the coverage-mode branch of run-tests.mjs) may already own a run-scoped raw
// V8 coverage directory it populates during `action` and still needs after this call returns, for a
// separate post-action converter to consume. This lifecycle never creates, populates, or removes that
// directory itself -- ownership stays with the caller -- but it does verify, after `action` settles,
// that its own temp-directory bookkeeping did not strand it, so a future change to this file cannot
// silently break that handoff.
//
// `run-tests.mjs`'s own `runAgainstCompiledSnapshot` reads AND reclaims (removes) its self-owned
// `rawCoverageDirectory` entirely inside its own `try`/`finally`, which runs to completion before
// `action` returns control here -- there is no separate post-action converter for that case; the
// conversion already happened, and the directory's own disappearance right after is the intended, successful outcome, not
// a stranding bug. Asserting observability unconditionally in that case makes every non-shard,
// non-`EPGSTATION_COVERAGE_KEEP_RAW=1` coverage run throw
// "Run-scoped raw V8 coverage directory is unreachable" right after a fully successful conversion --
// this is not a race (this whole sequence is a single serial `await` chain within one process), it is
// deterministic on every such run. The caller says so explicitly via
// `rawCoverageDirectoryConsumedInsideAction`; the check below still runs for every other case (a shard
// child, whose raw directory is parent-owned and must outlive this process, and
// `EPGSTATION_COVERAGE_KEEP_RAW=1`, which keeps it for post-mortem debugging), so an accidental
// disappearance in those cases is still caught.
async function assertRawCoverageDirectoryObservable(rawCoverageDirectory) {
    let info;
    try {
        info = await stat(rawCoverageDirectory);
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            throw new Error(`Run-scoped raw V8 coverage directory is unreachable: ${rawCoverageDirectory}`);
        }
        throw error;
    }
    if (!info.isDirectory()) {
        throw new Error(`Run-scoped raw V8 coverage directory is not a directory: ${rawCoverageDirectory}`);
    }
}

export async function withCompiledSnapshot(action, options = {}) {
    const copyDirectory = options.copy ?? cp;
    const repositoryRoot = resolve(options.repositoryRoot ?? '.');
    const source =
        options.source !== undefined ? options.source : await resolveDefaultSource(repositoryRoot, options.cache);
    const rawCoverageDirectory =
        options.rawCoverageDirectory !== undefined ? resolve(repositoryRoot, options.rawCoverageDirectory) : undefined;
    // See `assertRawCoverageDirectoryObservable`'s own doc: true when the caller's `action` already
    // owns removing `rawCoverageDirectory` itself once consumed (the non-shard,
    // non-`EPGSTATION_COVERAGE_KEEP_RAW=1` coverage run), so this function must not require it to
    // still exist after `action` returns.
    const rawCoverageDirectoryConsumedInsideAction = options.rawCoverageDirectoryConsumedInsideAction === true;

    const artifactRoot = options.artifactRoot ?? resolve('test/server/.artifacts/runtime');
    await mkdir(artifactRoot, { recursive: true });
    const snapshotRoot = await mkdtemp(join(artifactRoot, 'compiled-dist-'));
    const compiledSnapshot = join(snapshotRoot, 'dist');
    let actionError;
    let result;
    try {
        await copyDirectory(source, compiledSnapshot, { recursive: true });
        result = await action(compiledSnapshot);
    } catch (error) {
        actionError = error;
    }
    let handoffError;
    if (rawCoverageDirectory !== undefined && !rawCoverageDirectoryConsumedInsideAction) {
        try {
            await assertRawCoverageDirectoryObservable(rawCoverageDirectory);
        } catch (error) {
            handoffError = error;
        }
    }
    await rm(snapshotRoot, { recursive: true, force: true });
    if (actionError !== undefined) throw actionError;
    if (handoffError !== undefined) throw handoffError;
    return result;
}
