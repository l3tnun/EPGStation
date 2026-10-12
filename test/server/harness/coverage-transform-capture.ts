import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// `vite` is a transitive dependency of `vitest` (present in node_modules), not a package.json dependency; see
// this file's own module doc below for why this exact import mirrors Vitest's own internal one.
import { ssrDynamicImportKey, ssrExportAllKey, ssrImportKey, ssrImportMetaKey, ssrModuleExportsKey } from 'vite/module-runner';

/**
 * Raw V8 offset drift under Vitest's SSR module transform.
 *
 * `scripts/server-test/compiled-snapshot-coverage.mjs` maps NODE_V8_COVERAGE raw byte offsets onto
 * the ON-DISK compiled-snapshot `dist/**\/*.js` + its `tsc`-emitted `.js.map`. That assumption holds
 * only when Vitest actually executed the on-disk bytes unchanged. It does not: Vitest's own
 * `VitestModuleEvaluator#_runInlinedModule` (`node_modules/vitest/dist/module-evaluator.js`, ~line
 * 218-256) always re-runs a compiled `dist/**\/*.js` module through Vite's SSR transform first, then
 * evaluates it via
 * `vm.runInThisContext(`'use strict';async (${argumentsList.join(',')})=>{{${code}\n}}`, { filename:
 * module.id, ... })` (same file, ~line 243-244) -- so every raw V8 byte offset this run's coverage
 * profile records for this script is an offset into that WRAPPED text
 * (`wrapperPrefixLength + code.length + '\n}}'.length`), never into the on-disk `dist` file the
 * converter reads. The converter never *assumes* which coordinate
 * space a given raw record's offsets live in from the mere presence or absence of a capture -- it
 * measures the record's own top-level function range end and compares it against both the on-disk
 * file's own length and every candidate capture's own reconstructed wrapped length, failing closed
 * (`unverified-raw-offset-space` / `ambiguous-raw-offset-space`) when neither is provably correct. This
 * file exists to supply those candidate captures as completely and honestly as possible; it is not
 * itself the source of truth for which one applies to which record.
 *
 * Capture loss under `vi.resetModules()`: Vite's own
 * `EvaluatedModules#invalidateModule` (`node_modules/vite/dist/node/module-runner.js`'s
 * `invalidateModule`) sets `node.meta = undefined` -- `vi.resetModules()` (used by 15+ test files in
 * this repository, e.g. `epg-update-executor-entry-seam.test.ts`) calls exactly this. A capture taken
 * only once, in a worker-final `afterAll`, would therefore silently lose every module whose test reset
 * modules at any point before that `afterAll` ran, even though that module's *earlier* transformed
 * `code` is exactly what a raw range recorded *during* that earlier test corresponds to. This setup
 * file is therefore registered from BOTH `afterEach` (catches a version about to be invalidated by the
 * very next test) and `afterAll` (catches whatever is still live at worker teardown) -- see
 * `coverage-raw-flush.ts`.
 *
 * Performance: `afterEach` runs on *every* test, so a content-keyed "new distinct version" check would
 * cost O(code.length) per loaded module per test -- building a string key out of the full transformed
 * `code` just to test Set membership, and re-reading + re-hashing the on-disk dist file for
 * `distSourceHash` on every single call regardless of whether anything changed. That cost is large for
 * the serialized real-process batch, whose rebuild/reload cycles (real `npm ci`, fresh compiled
 * snapshots) touch large numbers of modules repeatedly. `lastCapturedMetaByPath` below is therefore an
 * O(1) reference-equality check against Vite's own `node.meta` object: `EvaluatedModules#invalidateModule` always
 * assigns a *new* `meta` object on the next successful fetch (the old one is set to `undefined`, never
 * mutated in place), so "is this the exact same transform result as last observed for this path" is
 * exactly a pointer comparison, never a string comparison -- no `code` content ever needs to be read
 * merely to decide whether this is a new version. `distSourceHashCache` similarly memoizes the on-disk
 * hash per `distPath` for this worker's entire lifetime: every path this module ever reads is a
 * `mkdtemp`-style unique, content-addressed temp path or a run-scoped official snapshot path (this
 * repository's own established convention throughout `scripts/server-test/*.mjs`, e.g. the isolated-
 * runtime-identity registry's own digest-equality requirement) that is never rewritten in place once
 * created, so caching its hash for the worker's lifetime is safe, not merely an optimistic shortcut.
 * Together these mean a repeated `afterEach` call over an *unchanged* module population costs one `Map`
 * lookup per module and nothing else -- no file I/O, no hashing, no string building.
 *
 * The converter (`readTransformCaptures`) unions every capture file for a `(pid, resolvedPath)` pair
 * into an array of distinct candidate versions instead of treating more than one as a conflict, and
 * picks whichever one's own reconstructed wrapped length matches the raw record's own measured
 * top-level range end.
 *
 * `distSourceHash` (sha256 of the on-disk `dist/**\/*.js` file this capture's `code` was transformed
 * from, read directly from disk here, independent of whatever `node.meta`/`code` says) lets the
 * converter safely borrow a capture recorded by a *different* pid of the same run for a script this
 * worker's own pid has a raw record for but never itself captured (its own capture attempt raced a
 * reset, crashed, or the module was only ever loaded by a different worker in this run) -- but only
 * when that hash matches the exact on-disk bytes the converter is looking at *and* the wrapped length
 * also matches (Vite's SSR transform is deterministic for identical input, so identical on-disk bytes
 * plus an independently-matching wrapped length is strong, not merely correlational, evidence the same
 * transform output applies). This never widens to "any capture for this path is fine" -- see the
 * converter's own per-record dispatch for the exact rule.
 *
 * Writes are asynchronous and not awaited inline (`pendingTransformCaptureWrites` collects each one's
 * own promise instead) so a capture never blocks the test runner's own event loop waiting on disk I/O
 * -- but every pending write is still awaited exactly once, by `flushPendingTransformCaptureWrites`,
 * from the worker-final `afterAll` in `coverage-raw-flush.ts` (registered *after* the capture-triggering
 * `afterAll`), before the fork pool's own `kill()` can land; a write that raced that flush and lost is
 * exactly the same "this worker's own capture attempt failed" case `distSourceHash`'s own cross-pid
 * rescue already exists for, never a new failure mode.
 *
 * This setup file (guarded on the coverage-mode-only `EPGSTATION_COVERAGE_TRANSFORM_DIR` env var so a
 * non-coverage run never pays for it) captures, for every compiled-snapshot script this worker has
 * currently loaded, the *exact* `code` string Vitest fed to `vm.runInThisContext` (before the wrapper
 * prefix is added) plus its own composed inline source map (`code` -> original `src/**\/*.ts`,
 * extracted via Vite's own `EvaluatedModules#getModuleSourceMapById`), the wrapper prefix's own byte
 * length, and `distSourceHash` -- everything the converter needs to translate a raw offset into this
 * script's *actual* executed position instead of assuming it already indexes the on-disk `dist` file.
 * One JSON file per *newly observed distinct version*, written next to (not into) the raw
 * `NODE_V8_COVERAGE` dump directory, named `transform-<pid>-<timestamp>-<uuid>.json` so the converter
 * can bind it to the exact pid that wrote it (`readRawCoverageRecords`'s own dump files follow Node's
 * `coverage-<pid>-<timestamp>-<n>.json` convention) -- this is purely an additional, optional
 * per-script, per-pid lookup; a raw dump's own record association is unaffected.
 *
 * `globalThis.__vitest_worker__` (`state` below) is Vitest's own internal, untyped per-worker state
 * object (`node_modules/vitest/dist/chunks/utils.DYj33du9.js`'s `getWorkerState`/`NAME_WORKER_STATE`)
 * -- the same object `vitest`'s own built-in console/snapshot-path code already reads from a worker
 * context, so relying on it here is the same category of documented internal dependency
 * `coverage-raw-flush-guard.ts` already carries for the fork pool's own `stop()` behavior, not a new
 * kind of fragility. Every access below is defensive (optional-chained / try-caught): a shape change in
 * a future Vitest upgrade degrades to "no capture written for this worker at all", which the converter
 * already turns into a fail-closed `missing-transform-capture` (scoped to "the whole run's capture
 * directory is empty") or `unverified-raw-offset-space` (scoped to one record) rather than a silent
 * mismapping.
 */
export const COVERAGE_TRANSFORM_CAPTURE_DIR_ENV = 'EPGSTATION_COVERAGE_TRANSFORM_DIR';

interface CapturedTransform {
    url: string;
    code: string;
    map: { mappings?: string; sources?: string[]; sourceRoot?: string } | null;
    wrapperPrefixLength: number;
    distSourceHash: string;
}

/**
 * Mirrors `VitestModuleEvaluator#_runInlinedModule`'s own `argumentsList`/`codeDefinition` construction
 * exactly (see module doc). That construction also conditionally appends
 * `this.compiledFunctionArgumentsNames` (module-evaluator.js ~line 233) -- an *evaluator-construction*
 * option, never a per-module or per-run `config` field this setup file could read from
 * `getWorkerState()`. Confirmed by inspecting `node_modules/vitest/dist/**\/*.js`: the only
 * place in Vitest's own source that ever sets `compiledFunctionArgumentsNames` on a
 * `VitestModuleEvaluator` instance is `module-evaluator.js` itself reading it back off `this.options` --
 * no pool/runner construction site anywhere in the package passes it in, for the `node` environment or
 * any other. It is a public-API extensibility hook for an embedder that constructs its own
 * `VitestModuleEvaluator`, which this repository's `vitest.server.config.ts` (default `forks` pool,
 * `environment: 'node'`, no custom runner/evaluator wiring) never does. If a future Vitest upgrade or
 * config change starts using it, `wrapperPrefixLength` below would under-count -- the converter's own
 * per-record wrapped-length verification fails that record closed
 * (`unverified-raw-offset-space`) rather than silently mismapping it, so this is not airtight against a
 * future config change, but it can no longer regress coverage correctness silently.
 */
export function computeWrapperPrefixLength(injectCjsGlobals: boolean): number {
    const argumentsList = [
        ssrModuleExportsKey,
        ssrImportMetaKey,
        ssrImportKey,
        ssrDynamicImportKey,
        ssrExportAllKey,
        '__vite_ssr_exportName__',
    ];
    if (injectCjsGlobals) {
        argumentsList.push('__filename', '__dirname', 'module', 'exports', 'require');
    }
    const codeDefinition = `'use strict';async (${argumentsList.join(',')})=>{{`;
    return codeDefinition.length;
}

/**
 * The `dist/**\/*.js` path a capturable `evaluatedModules.idToModuleMap` key names, or `null` if `id`
 * is not one worth capturing at all (`node_modules`, a virtual/test module). A `vi.mock(..., { spy:
 * true })`-spied module's id carries a `mock:` prefix (`module-evaluator.js`'s own
 * `_runInlinedModule`: `options.filename = module.id.startsWith('mock:') ? module.id.slice(5) :
 * module.id` -- the *raw V8 dump's own* `result[].url` is therefore always the de-prefixed real path,
 * never the `mock:`-prefixed id) -- stripped here so this capture's `url` matches that same de-prefixed
 * path the raw dump and the converter's `resolvedPath` both use, instead of silently producing a
 * `mock:`-prefixed URL `scriptPathFromUrl` can never resolve to a real file (which would make this
 * capture invisible to the converter, silently reverting a mocked script to the legacy, wrong
 * raw-offset-is-a-dist-offset path).
 */
function capturableDistPath(id: string): string | null {
    const unprefixed = id.startsWith('mock:') ? id.slice(5) : id;
    if (!unprefixed.endsWith('.js') || !unprefixed.includes('/dist/') || unprefixed.includes('/node_modules/')) {
        return null;
    }
    return unprefixed;
}

/**
 * Module-scope (this worker process's own): the last `node.meta` object reference this module has
 * already captured for a given `distPath`, across every `afterEach`/`afterAll` invocation in this
 * worker's lifetime. `undefined` (the `Map` has no entry) means "never captured"; a present entry
 * compared via `===` against the module's *current* `node.meta` is an O(1) test for "is this the exact
 * same transform result as last time" -- see module doc for why reference equality is sound here.
 */
const lastCapturedMetaByPath = new Map<string, unknown>();

/** Module-scope (this worker process's own) memoization of `distPath -> sha256(on-disk bytes)` for this worker's entire lifetime. See module doc for why this is safe, not merely an optimistic cache. `null` means an earlier read attempt failed (deleted mid-run, permissions, etc.); also memoized so a persistently-unreadable path is not retried every call. */
const distSourceHashCache = new Map<string, string | null>();

function cachedDistSourceHash(distPath: string): string | null {
    const cached = distSourceHashCache.get(distPath);
    if (cached !== undefined) {
        return cached;
    }
    let hash: string | null;
    try {
        hash = createHash('sha256').update(readFileSync(distPath, 'utf8')).digest('hex');
    } catch {
        hash = null;
    }
    distSourceHashCache.set(distPath, hash);
    return hash;
}

/**
 * Every write's own promise, so `flushPendingTransformCaptureWrites` can await them all exactly once
 * before this worker's own teardown -- see module doc.
 */
const pendingTransformCaptureWrites: Promise<void>[] = [];

export function captureWorkerTransformedModulesIfEnabled(): void {
    const transformCaptureDir = process.env[COVERAGE_TRANSFORM_CAPTURE_DIR_ENV];
    if (typeof transformCaptureDir !== 'string' || transformCaptureDir.length === 0) {
        return;
    }
    try {
        const state = (globalThis as { __vitest_worker__?: unknown }).__vitest_worker__ as
            | {
                  config?: { injectCjsGlobals?: boolean };
                  evaluatedModules?: { idToModuleMap?: Map<string, unknown> };
              }
            | undefined;
        const idToModuleMap = state?.evaluatedModules?.idToModuleMap;
        if (idToModuleMap === undefined) {
            return;
        }
        const injectCjsGlobalsDefault = state?.config?.injectCjsGlobals !== false;
        const evaluatedModules = state?.evaluatedModules as {
            getModuleSourceMapById(id: string): { map?: CapturedTransform['map'] } | null;
        };
        const captures: CapturedTransform[] = [];
        for (const [id, nodeUnknown] of idToModuleMap) {
            const distPath = capturableDistPath(id);
            if (distPath === null) {
                continue;
            }
            const node = nodeUnknown as { meta?: { code?: unknown; moduleType?: unknown } };
            const meta = node.meta;
            if (lastCapturedMetaByPath.get(distPath) === meta) {
                // Same transform result as the last time this path was seen (the common case on every
                // `afterEach` call for every module a test did not reset) -- no string comparison, no
                // file I/O, no hashing.
                continue;
            }
            const code = meta?.code;
            if (typeof code !== 'string') {
                // Invalidated (`vi.resetModules()`) since this module was last loaded, externalized, or
                // never actually inlined -- nothing to capture right now. An earlier `afterEach` call may
                // already have captured this exact version before it was invalidated; this is not itself
                // a loss. Deliberately does NOT update `lastCapturedMetaByPath` (there is nothing captured
                // to remember), so a later re-fetch that restores a meta this exact process already saw
                // once (unusual, but possible) is still recognized as unchanged next time.
                continue;
            }
            const distSourceHash = cachedDistSourceHash(distPath);
            if (distSourceHash === null) {
                continue;
            }
            const injectCjsGlobals = injectCjsGlobalsDefault || node.meta?.moduleType === 'cjs';
            const wrapperPrefixLength = computeWrapperPrefixLength(injectCjsGlobals);
            let map: CapturedTransform['map'] = null;
            try {
                // Looked up by the module's own (possibly `mock:`-prefixed) id -- `getModuleSourceMapById`
                // indexes the same `idToModuleMap` this loop is iterating, not the de-prefixed path.
                const extracted = evaluatedModules.getModuleSourceMapById(id);
                map = extracted?.map ?? null;
            } catch {
                map = null;
            }
            lastCapturedMetaByPath.set(distPath, meta);
            captures.push({
                url: pathToFileURL(distPath).href,
                code,
                distSourceHash,
                map,
                wrapperPrefixLength,
            });
        }
        if (captures.length === 0) {
            return;
        }
        mkdirSync(transformCaptureDir, { recursive: true });
        const filePath = join(transformCaptureDir, `transform-${process.pid}-${Date.now()}-${randomUUID()}.json`);
        const payload = JSON.stringify({ captures });
        pendingTransformCaptureWrites.push(
            writeFile(filePath, payload, 'utf8').catch(error => {
                process.stderr.write(
                    `coverage-transform-capture: failed to write transform capture "${filePath}": ${String(error)}\n`,
                );
            }),
        );
    } catch (error) {
        // Best-effort: a capture-writing failure must not fail the test run itself. The converter's
        // own `missing-transform-capture`/`unverified-raw-offset-space` fail-closed checks
        // (compiled-snapshot-coverage.mjs) are what surface a systematically-missing capture, not this
        // catch.
        process.stderr.write(
            `coverage-transform-capture: failed to write transform capture: ${String(error)}\n`,
        );
    }
}

/**
 * Awaits every capture write this worker has queued so far (see module doc), then clears the queue.
 * Must run, once, from the worker-final `afterAll` -- after the last `captureWorkerTransformedModulesIfEnabled`
 * call that could possibly queue a new write, and before the fork pool's own `kill()` can land (matching
 * `flushWorkerRawCoverageIfEnabled`'s own timing requirement in `coverage-raw-flush-guard.ts`).
 */
export async function flushPendingTransformCaptureWrites(): Promise<void> {
    const writes = pendingTransformCaptureWrites.splice(0, pendingTransformCaptureWrites.length);
    await Promise.allSettled(writes);
}
