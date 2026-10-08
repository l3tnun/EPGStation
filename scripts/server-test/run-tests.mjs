import { execFile as execFileCallback } from 'node:child_process';
import { globSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
    coverageIdentityTreeDigest,
    scrubIsolatedRuntimeIdentityEnv,
    summarizeCoverage,
    writeCanonicalCoverageArtifacts,
} from './compiled-snapshot-coverage.mjs';
import { withCompiledSnapshot } from './compiled-snapshot.mjs';
import { main, run } from './process.mjs';
import { SERIALIZED_REAL_PROCESS_FILES } from './serialized-real-process-files.mjs';
import { snapshotWorktreeContent } from './worktree-content.mjs';
import { spawn as spawnChild } from 'node:child_process';

/** Run a command to completion and return its stdout (stderr passes through). */
function runCapture(command, arguments_, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnChild(command, arguments_, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            shell: false,
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        const chunks = [];
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (signal !== null) {
                reject(new Error(`${command} terminated by ${signal}`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`${command} exited with status ${code ?? 'unknown'}`));
                return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
}
import { classifyServerTestPath, recordingExecutionTestTargets } from './test-selection.mjs';

const execFile = promisify(execFileCallback);

const mode = process.argv[2];
const projects = {
    spec: 'spec',
    imp: 'imp',
    integration: 'integration',
};

const COVERAGE_MODE = 'coverage';
// Coverage is measured over these Vitest projects only (the unit tests).
const UNIT_COVERAGE_PROJECTS = Object.freeze(['spec', 'imp']);
const wholeLayerModes = ['spec', 'imp', 'integration', 'all'];
// SERIALIZED_REAL_PROCESS_FILES: files whose rows drive real Docker builds and containers against
// the daemon under fixed wall-clock budgets. A whole-layer run gives them a serialized invocation of
// their own rather than a place in the parallel batch. Single source of truth: `./serialized-real-process-files.mjs`.

// PR CI does not run the server suite, so there is no 4-CPU hosted-runner shape to size an unset
// `EPGSTATION_TEST_MAX_WORKERS` against. Left unset, a whole-layer run would fall through to
// Vitest's own CPU-derived default (15 on the 16-thread development host this repository runs its
// heavy server-test invocations on); this caps that default explicitly instead, matching the
// coverage batch's own calibrated 8-worker cap so an ordinary
// `npm run test:server` and `npm run test:server:coverage` run at the same concurrency. An
// explicitly set `EPGSTATION_TEST_MAX_WORKERS` is passed through unchanged, whether above or below
// this value -- this only bounds the "unset" case.
const DEFAULT_TEST_MAX_WORKERS = 8;

// node-matrix's Node 26 leg (`run-node-acceptance-matrix.mjs`'s `nodeMatrixCommandEnv`) sets
// `EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1` on its `npm run test:server` command only. That file's
// real Docker image build and start already runs on Node 24 (the coverage gate's integration run,
// which never sets this) and standalone in the `docker-gate-node24` preflight step, and the image is
// not Node-major-specific. Read only by the whole-layer (`all`/`spec`/`imp`/`integration`) dispatch
// below, where it drops this one file out of `pendingSerializedFiles` entirely -- it stays excluded
// from the parallel batch either way (that exclusion is keyed on the full
// `SERIALIZED_REAL_PROCESS_FILES` list, unconditionally), so setting this env var makes the file
// simply not run in this invocation, rather than moving it elsewhere. Unset (the default, including
// `--serialized-only`/`--shard` and every other CLI invocation), nothing changes.
const DOCKER_IMAGE_CHECK_LOCATOR = 'application-runtime/docker-image.integration.test.ts';

/** CI split options of the direct CLI run (`--shard`, `--serialized-only`); see parseRunArguments. */
let cliRunOptions = { shard: undefined, serializedOnly: false };

/**
 * Exit status `npm run test:server:coverage` ends with when the measurement is well-formed but C0 or C1
 * is under 100%. Distinct from a generic failure (1: a test failed, a script
 * was never executed, or the measurement itself broke), so `run-coverage-gate-cli.mjs` can record the
 * two cases differently.
 */
export const BELOW_FULL_COVERAGE_EXIT_CODE = 3;

/** C0 or C1 of a well-formed measurement is under 100%. */
export class BelowFullCoverageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BelowFullCoverageError';
        this.exitCode = BELOW_FULL_COVERAGE_EXIT_CODE;
    }
}

/**
 * The inner/public converter one-shot terminal.
 * C0 and C1 both 100% (well-formed, finite percent) → returned, exit 0.
 * Well-formed but C0 or C1 under 100% → throw `BelowFullCoverageError` (exit status 3).
 * Zero-population or malformed/incoherent summary → throw (nonzero).
 * Tree/input mismatch and real Vitest failure remain nonzero on their own paths.
 */
export function evaluateConverterCoverageTerminal(summary) {
    if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) {
        throw new Error('coverage terminal schema-mismatch: summary must be a plain object');
    }
    const fields = [
        'statementsCovered',
        'statementsTotal',
        'statementsPercent',
        'branchesCovered',
        'branchesTotal',
        'branchesPercent',
    ];
    for (const field of fields) {
        const value = summary[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`coverage terminal malformed: ${field} must be a finite number`);
        }
    }
    for (const field of ['statementsCovered', 'statementsTotal', 'branchesCovered', 'branchesTotal']) {
        if (!Number.isSafeInteger(summary[field])) {
            throw new Error(`coverage terminal malformed: ${field} must be a Number.isSafeInteger`);
        }
        if (summary[field] < 0) {
            throw new Error(`coverage terminal malformed: ${field} must be non-negative`);
        }
    }
    if (summary.statementsTotal < 1 || summary.branchesTotal < 1) {
        throw new Error(
            `coverage terminal zero-population: statementsTotal=${summary.statementsTotal} branchesTotal=${summary.branchesTotal} (vacuous 100 is not success)`,
        );
    }
    if (
        summary.statementsCovered > summary.statementsTotal ||
        summary.branchesCovered > summary.branchesTotal
    ) {
        throw new Error('coverage terminal malformed: covered must be <= total (incoherent coverage)');
    }
    const statementsPercent = (summary.statementsCovered / summary.statementsTotal) * 100;
    const branchesPercent = (summary.branchesCovered / summary.branchesTotal) * 100;
    if (!Number.isFinite(statementsPercent) || !Number.isFinite(branchesPercent)) {
        throw new Error('coverage terminal malformed: derived percent must be finite');
    }
    if (
        summary.statementsPercent !== statementsPercent ||
        summary.branchesPercent !== branchesPercent
    ) {
        throw new Error(
            `coverage terminal percent inconsistency: reported statements=${summary.statementsPercent} branches=${summary.branchesPercent} recomputed statements=${statementsPercent} branches=${branchesPercent}`,
        );
    }
    if (
        statementsPercent < 0 ||
        statementsPercent > 100 ||
        branchesPercent < 0 ||
        branchesPercent > 100
    ) {
        throw new Error('coverage terminal malformed: percent must be within 0..100');
    }
    if (statementsPercent < 100 || branchesPercent < 100) {
        const uncoveredFiles = Array.isArray(summary.uncoveredFiles) ? summary.uncoveredFiles : [];
        throw new BelowFullCoverageError(
            `coverage terminal below-full-coverage: statements ${statementsPercent}% (${summary.statementsCovered}/${summary.statementsTotal}), ` +
                `branches ${branchesPercent}% (${summary.branchesCovered}/${summary.branchesTotal}); both must be 100%` +
                (uncoveredFiles.length > 0
                    ? `\nfiles with uncovered statements or branches (${uncoveredFiles.length}):\n${uncoveredFiles
                          .map(file => `  - ${file}`)
                          .join('\n')}`
                    : ''),
        );
    }
    return Object.freeze({
        exitCode: 0,
        ok: true,
        statementsPercent,
        branchesPercent,
        disposition: 'measurement-success',
    });
}

/**
 * Sets the exit status the coverage command ends with for an error that ended the run: a
 * `BelowFullCoverageError` (well-formed measurement under 100%) ends with
 * `BELOW_FULL_COVERAGE_EXIT_CODE` after its message is printed and the error is consumed; any other
 * error ends with status 1 and is rethrown.
 */
export function exitStatusForCoverageError(error, processLike = process, log = console.error) {
    if (error instanceof BelowFullCoverageError) {
        log(error.message);
        processLike.exitCode = BELOW_FULL_COVERAGE_EXIT_CODE;
        return;
    }
    processLike.exitCode = 1;
    throw error;
}

/**
 * Ownership rule shared between `runAgainstCompiledSnapshot`'s own `finally` and the `isDirectRun` call
 * site that decides whether `withCompiledSnapshot` may still require its `rawCoverageDirectory` to
 * exist once this run's `action` returns (`rawCoverageDirectoryConsumedInsideAction`, see
 * `compiled-snapshot.mjs#assertRawCoverageDirectoryObservable`). True unless
 * `EPGSTATION_COVERAGE_KEEP_RAW=1` (kept for post-mortem inspection): the run owns
 * `rawCoverageDirectory` and its own `finally` removes it once the converter has read it.
 */
export function rawCoverageDirectoryReclaimedByThisRun(processEnv) {
    return processEnv.EPGSTATION_COVERAGE_KEEP_RAW !== '1';
}

/**
 * Production child-env construction for server test runs. Scrubs hostile registry/run/tree vars
 * first; coverage mode re-assigns all three plus NODE_V8_COVERAGE / converter flag. Exported as the
 * minimal test seam so the actual wiring probe exercises this same function (not a reimplementation).
 */
export function buildServerTestChildEnvironment({
    mode: runMode,
    compiledSnapshot,
    rawCoverageDirectory,
    transformCaptureDirectory,
    processEnv = process.env,
    treeDigest,
} = {}) {
    const testEnvironment = scrubIsolatedRuntimeIdentityEnv({
        ...processEnv,
        EPGSTATION_SERVER_COMPILED_SNAPSHOT: compiledSnapshot,
    });
    // Always scrubbed first, regardless of mode -- a stale value inherited
    // from `processEnv` (e.g. a parent coverage invocation's own environment) must never leak into a
    // non-coverage or nested child run, the same leak class `scrubIsolatedRuntimeIdentityEnv` above
    // already exists to close for the other coverage-identity env vars. Re-assigned below only inside
    // the coverage-mode branch, and only when the caller actually supplied a directory.
    delete testEnvironment.EPGSTATION_COVERAGE_TRANSFORM_DIR;
    let identityRegistryDir;
    let coverageRunScope;
    let coverageTreeDigest;
    if (runMode === COVERAGE_MODE) {
        if (typeof rawCoverageDirectory !== 'string' || rawCoverageDirectory.length === 0) {
            throw new Error('rawCoverageDirectory is required in coverage mode');
        }
        testEnvironment.NODE_V8_COVERAGE = rawCoverageDirectory;
        identityRegistryDir = join(rawCoverageDirectory, 'isolated-runtime-identity');
        coverageRunScope = basename(rawCoverageDirectory);
        coverageTreeDigest = treeDigest;
        testEnvironment.EPGSTATION_ISOLATED_RUNTIME_IDENTITY_REGISTRY = identityRegistryDir;
        testEnvironment.EPGSTATION_COVERAGE_RUN_SCOPE = coverageRunScope;
        testEnvironment.EPGSTATION_COVERAGE_TREE_DIGEST = coverageTreeDigest;
        // Tells vitest.server.config.ts's built-in v8 provider that a downstream converter -- not this
        // provider's own threshold -- judges coverage-final.json.
        testEnvironment.EPGSTATION_COVERAGE_CONVERTER = '1';
        // Tells `test/server/harness/coverage-transform-capture.ts`'s
        // `afterAll` where to write this worker's own captured Vitest-transformed module bodies. The
        // literal env var name here must stay in sync with that file's own exported
        // `COVERAGE_TRANSFORM_CAPTURE_DIR_ENV` constant (not imported directly: that file is TypeScript,
        // loaded only inside a Vitest worker, not from this plain `.mjs` script). Left scrubbed (see
        // above) when the caller has no directory for this run -- the harness setup file itself no-ops
        // without it.
        if (typeof transformCaptureDirectory === 'string' && transformCaptureDirectory.length > 0) {
            testEnvironment.EPGSTATION_COVERAGE_TRANSFORM_DIR = transformCaptureDirectory;
        }
    }
    return { testEnvironment, identityRegistryDir, coverageRunScope, coverageTreeDigest };
}

function normalizeFilter(filter) {
    if (
        typeof filter !== 'string' ||
        filter.startsWith('-') ||
        filter.startsWith('/') ||
        filter.includes('\\') ||
        filter.includes('..') ||
        filter.startsWith('!') ||
        !filter.startsWith('test/server/') ||
        !filter.endsWith('.test.ts') ||
        !/^[A-Za-z0-9_./*{},-]+$/u.test(filter)
    ) {
        throw new Error(`Unsafe server test locator: ${filter}`);
    }
    const braceGroups = [...filter.matchAll(/\{([^{}]+)\}/gu)];
    const withoutGroups = filter.replace(/\{[^{}]+\}/gu, '');
    if (withoutGroups.includes('{') || withoutGroups.includes('}') || withoutGroups.includes(',')) {
        throw new Error(`Unsafe server test locator: ${filter}`);
    }
    for (const [, group] of braceGroups) {
        if (group.split(',').some(part => part.length === 0 || !/^[A-Za-z0-9_./*-]+$/u.test(part))) {
            throw new Error(`Unsafe server test locator: ${filter}`);
        }
    }
    return filter.slice('test/server/'.length);
}

/** Every test file of one Vitest project (relative to test/server, sorted as Vitest lists them). */
async function enumerateLayerFiles(project, environment) {
    const listed = await runCapture(process.execPath, [
        'node_modules/vitest/vitest.mjs',
        'list',
        '--config',
        'vitest.server.config.ts',
        '--project',
        project,
        '--filesOnly',
    ], { env: environment });
    return listed
        .split('\n')
        .map(line => line.replace(/^\[[^\]]+\]\s*/u, '').trim())
        .filter(line => line.startsWith('test/server/'))
        .map(line => line.slice('test/server/'.length));
}

/**
 * Whole-layer CI split options. `--shard index/count` runs that slice of a layer's parallel batch
 * (Vitest's own sharding); `--serialized-only` runs just the layer's serialized real-process files.
 * Both are whole-layer options: they reject explicit locators and each other, and `allowOptions`
 * (false for coverage / recording-execution modes) rejects them outright. Locators are returned
 * unnormalized so the caller keeps its own `normalizeFilter` step.
 */
export function parseRunArguments(rawArguments, { allowOptions = true } = {}) {
    const locatorArguments = [];
    let shard;
    let serializedOnly = false;
    for (let index = 0; index < rawArguments.length; index += 1) {
        const argument = rawArguments[index];
        if (argument === '--serialized-only') {
            serializedOnly = true;
            continue;
        }
        if (argument === '--shard' || argument.startsWith('--shard=')) {
            const value = argument === '--shard' ? rawArguments[(index += 1)] : argument.slice('--shard='.length);
            if (typeof value !== 'string' || !/^[1-9][0-9]*\/[1-9][0-9]*$/u.test(value)) {
                throw new Error(`Invalid --shard value: ${value ?? '(missing)'} (expected index/count)`);
            }
            const [shardIndex, shardCount] = value.split('/').map(Number);
            if (shardIndex > shardCount) {
                throw new Error(`Invalid --shard value: ${value} (index exceeds count)`);
            }
            shard = value;
            continue;
        }
        locatorArguments.push(argument);
    }
    const optionsGiven = shard !== undefined || serializedOnly;
    if (optionsGiven && !allowOptions) {
        throw new Error('--shard and --serialized-only apply to whole-layer runs only');
    }
    if (shard !== undefined && locatorArguments.length > 0) {
        throw new Error('--shard does not accept explicit locators');
    }
    if (shard !== undefined && serializedOnly) {
        throw new Error('--shard and --serialized-only are mutually exclusive');
    }
    return { locatorArguments, runOptions: { shard, serializedOnly } };
}

/**
 * Vitest CLI extra args are filename/name filters, not glob expansion. Unique-child
 * descriptor selectors use recursive globs under test/server, so a raw star-star
 * filter collects 0 files under --project spec. Expand globs against cwd's test/server
 * and keep only paths classified for the active layer.
 */
export function expandFiltersForLayer(filters, layer, options = {}) {
    if (!Array.isArray(filters)) {
        throw new Error('filters must be an array');
    }
    const serverRoot = resolve(options.serverRoot ?? 'test/server');
    const expanded = [];
    const seen = new Set();
    for (const filter of filters) {
        if (typeof filter !== 'string' || filter.length === 0) {
            throw new Error(`Unsafe server test locator: ${filter}`);
        }
        const hasGlob = /[*{?]/.test(filter);
        const matches = hasGlob ? globSync(filter, { cwd: serverRoot }) : [filter];
        for (const match of matches) {
            const posix = String(match).replaceAll('\\', '/');
            if (!posix.endsWith('.test.ts') || posix.includes('\0') || posix.split('/').includes('..')) {
                continue;
            }
            if (!classifyServerTestPath(`test/server/${posix}`).includes(layer)) {
                continue;
            }
            if (seen.has(posix)) {
                continue;
            }
            seen.add(posix);
            expanded.push(posix);
        }
    }
    return expanded.sort();
}

/**
 * Runs this invocation's selected `mode` against the one already-established `compiledSnapshot`,
 * shared by every layer in the run. Coverage mode additionally converts and writes the canonical
 * coverage artifacts while
 * `compiledSnapshot`/`rawCoverageDirectory` are both still live -- before `withCompiledSnapshot`'s own
 * cleanup (its caller, below) removes the snapshot.
 *
 * Exported so the runner-callsite probe can execute this production path with injected `run` /
 * conversion deps. Removing the `buildServerTestChildEnvironment` call below must
 * make that probe RED.
 */
export async function runAgainstCompiledSnapshot({
    compiledSnapshot,
    filters,
    rawCoverageDirectory,
    transformCaptureDirectory,
    worktreeContent,
    dependencies = {},
} = {}) {
    const runOptions = dependencies.runOptions ?? cliRunOptions;
    const runMode = dependencies.mode ?? mode;
    const processEnv = dependencies.processEnv ?? process.env;
    const runImpl = dependencies.run ?? run;
    const mkdirImpl = dependencies.mkdir ?? mkdir;
    const writeCanonical = dependencies.writeCanonicalCoverageArtifacts ?? writeCanonicalCoverageArtifacts;
    const summarize = dependencies.summarizeCoverage ?? summarizeCoverage;

    // Production connection: builder → child env + conversion identity triple.
    // Do not bypass this call with a local unsanitized env construction.
    const coverageTreeDigestForEnv =
        runMode === COVERAGE_MODE ? coverageIdentityTreeDigest(worktreeContent) : undefined;
    const {
        testEnvironment,
        identityRegistryDir,
        coverageRunScope,
    } = buildServerTestChildEnvironment({
        mode: runMode,
        compiledSnapshot,
        rawCoverageDirectory,
        transformCaptureDirectory,
        processEnv,
        treeDigest: coverageTreeDigestForEnv,
    });
    if (runMode === COVERAGE_MODE) {
        // This invocation always owns `transformCaptureDirectory` and `rawCoverageDirectory` (both
        // mkdtemp'd fresh by the `isDirectRun` caller on every coverage-mode invocation), so it reclaims
        // both below on success and on failure alike. `EPGSTATION_COVERAGE_KEEP_RAW=1` keeps them for
        // post-mortem debugging.
        const rmImpl = dependencies.rm ?? rm;
        const keepRaw = processEnv.EPGSTATION_COVERAGE_KEEP_RAW === '1';
        try {
            // Lifecycle-safe identity registry directory under the raw V8 dump root.
            await mkdirImpl(identityRegistryDir, { recursive: true });
            // Coverage mode caps Vitest worker concurrency at 8 (the worker count the coverage-instrumented
            // suite was calibrated against). `EPGSTATION_TEST_MAX_WORKERS` narrows the pool for a host with
            // fewer CPUs; it can only lower the count, never raise it.
            const coverageWorkerCap = Number.parseInt(processEnv.EPGSTATION_TEST_MAX_WORKERS ?? '', 10);
            const coverageWorkers = String(
                Number.isInteger(coverageWorkerCap) && coverageWorkerCap > 0 ? Math.min(coverageWorkerCap, 8) : 8,
            );
            // Coverage is measured over the unit tests (spec and imp) only, in one Vitest invocation.
            // Integration tests are never part of the measured population.
            let unitFiles;
            if (filters.length === 0) {
                const enumerate = dependencies.enumerateLayerFiles ?? enumerateLayerFiles;
                // `vitest list` loads no source under test; keep its own V8 dump out of the raw directory.
                const listEnvironment = { ...testEnvironment };
                delete listEnvironment.NODE_V8_COVERAGE;
                unitFiles = [];
                for (const project of UNIT_COVERAGE_PROJECTS) {
                    unitFiles.push(...(await enumerate(project, listEnvironment)));
                }
                if (unitFiles.length === 0) {
                    throw new Error('No unit tests (spec, imp) enumerated for coverage');
                }
            } else {
                unitFiles = [];
                for (const filter of filters) {
                    const matched = UNIT_COVERAGE_PROJECTS.flatMap(project => expandFiltersForLayer([filter], project));
                    if (matched.length === 0) {
                        throw new Error(
                            `coverage measures unit tests (spec, imp) only; no unit test matches locator: test/server/${filter}`,
                        );
                    }
                    unitFiles.push(...matched);
                }
            }
            unitFiles = [...new Set(unitFiles)].sort();
            // A real-process file needs its own serialized invocation, which this single measured
            // invocation does not give it; none may be part of the unit population.
            const realProcessFiles = unitFiles.filter(file => SERIALIZED_REAL_PROCESS_FILES.includes(file));
            if (realProcessFiles.length > 0) {
                throw new Error(`coverage unit tests include real-process files: ${realProcessFiles.join(', ')}`);
            }
            // `@vitest/coverage-v8` -- enabled by `--coverage.enabled true` -- runs its OWN, independent
            // `node:inspector` session against the SAME per-isolate V8 Profiler state this run's
            // `NODE_V8_COVERAGE` raw dumps read via `v8.takeCoverage()`.
            // `Profiler.takePreciseCoverage` resets execution counters on every call, so a second
            // collector silently consumed calls the raw dump then never saw: an undercount invisible to
            // this repository's converter. Vitest's own provider output is never this mode's source of
            // truth (`EPGSTATION_COVERAGE_CONVERTER=1` narrows its reporter to json-only and skips its
            // threshold, because the converter's output overwrites `coverage-final.json` right after),
            // so it stays disabled here, explicitly. `NODE_V8_COVERAGE`'s own Node-level collection is a
            // separate mechanism and stays untouched.
            await runImpl(
                process.execPath,
                [
                    'node_modules/vitest/vitest.mjs',
                    'run',
                    '--config',
                    'vitest.server.config.ts',
                    '--root',
                    '.',
                    ...UNIT_COVERAGE_PROJECTS.flatMap(project => ['--project', project]),
                    '--coverage.enabled',
                    'false',
                    '--maxWorkers',
                    coverageWorkers,
                    ...unitFiles,
                ],
                { env: testEnvironment },
            );

            const { coverageMap } = await writeCanonical({
                rawCoverageDir: rawCoverageDirectory,
                repositoryRoot: resolve('.'),
                snapshotRoots: [compiledSnapshot],
                testRoster: unitFiles.map(file => `test/server/${file}`),
                worktreeContent,
                identityRegistryDir,
                runScope: coverageRunScope,
                transformCaptureDir: transformCaptureDirectory,
            });
            // Judge the converter's own output -- the same basis the canonical coverage-final.json and
            // its sidecars were just written from. C0 and C1 must both be 100%; under 100% throws
            // `BelowFullCoverageError`, and zero-population and malformed/incoherent summaries throw.
            // `run-coverage-gate-cli.mjs` records the result from this command's own canonical
            // `coverage-final.json`.
            const summary = summarize(coverageMap);
            // Tree/input mismatch already failed inside writeCanonical; Vitest test failure already nonzero.
            evaluateConverterCoverageTerminal(summary);
            return;
        } finally {
            // Reclaim the directories this run owns, on success and on failure alike, unless the caller
            // opted out for post-mortem debugging.
            if (!keepRaw) {
                if (transformCaptureDirectory !== undefined) {
                    await rmImpl(transformCaptureDirectory, { force: true, recursive: true }).catch(() => {});
                }
                if (rawCoverageDirectory !== undefined) {
                    await rmImpl(rawCoverageDirectory, { force: true, recursive: true }).catch(() => {});
                }
            }
        }
    }

    const layers = runMode === 'all' || runMode === 'recording-execution' ? ['spec', 'imp', 'integration'] : [runMode];
    // Files whose rows drive real Docker builds and containers against the daemon (their own leaf
    // command runs them with `--maxWorkers 1 --no-file-parallelism`). Inside a whole-layer run they
    // would share the worker pool with the other files and the daemon with their MySQL fixture
    // teardown, so a whole-layer run keeps them out of the parallel batch and gathers them, across
    // every layer this call runs, into `pendingSerializedFiles` below -- dispatched once, after every
    // requested layer's own parallel batch has run. Explicit locators keep the
    // single-invocation-per-layer behavior (`splitLayer` stays false for them, so nothing is
    // deferred).
    // `EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1` additionally drops
    // `docker-image.integration.test.ts` out of that gathering step entirely (see
    // `DOCKER_IMAGE_CHECK_LOCATOR`'s own doc) -- node-matrix's Node 26 leg is the only caller that sets it.
    const serializedLayerFiles = {
        integration: SERIALIZED_REAL_PROCESS_FILES.filter(file => file.endsWith('.integration.test.ts')),
    };
    const { shard, serializedOnly } = runOptions;
    // A whole-layer run (`all`) must not `throw` out of this loop on the first layer that failed:
    // that would discard every layer after it -- a spec failure would mean imp and integration never
    // ran, so a single preflight pass could not collect every failure the tree actually has (the
    // caller would have to fix, re-run the whole suite, fix, re-run again). `layerFailures` collects each
    // layer's own error instead of letting it escape the loop, so every layer still runs exactly
    // once even when an earlier one failed; the aggregated failure is thrown once, after the loop,
    // below. Exit-code semantics are unchanged: any failure still ends this call non-zero.
    const layerFailures = [];
    // Real-process files deferred out of each layer's own iteration (see `splitLayer` below),
    // dispatched together once every requested layer's parallel batch has run.
    const pendingSerializedFiles = [];
    for (const layer of layers) {
        const layerFilters =
            runMode === 'recording-execution'
                ? recordingExecutionTestTargets
                      .filter(target => target.layer === layer)
                      .map(target => normalizeFilter(target.path))
                : filters;
        const expandedFilters = expandFiltersForLayer(layerFilters, layer);
        if (layerFilters.length > 0 && expandedFilters.length === 0) {
            throw new Error(`No ${layer} tests match locators`);
        }
        // Vitest sizes its worker pool from the host's CPU count, which does not account for a CPU
        // affinity mask. A run pinned to 4 CPUs still started 10 workers, and their combined memory
        // took the whole run past its ceiling. `EPGSTATION_TEST_MAX_WORKERS` caps the pool for such a
        // run and is passed through unchanged, whatever its value. Left unset, it would fall
        // through to Vitest's own CPU-derived default (15 on this repository's 16-thread development
        // host) -- `DEFAULT_TEST_MAX_WORKERS` caps that unset case explicitly instead (see that
        // constant's own doc).
        const maxWorkers = processEnv.EPGSTATION_TEST_MAX_WORKERS;
        const arguments_ = [
            'node_modules/vitest/vitest.mjs',
            'run',
            '--config',
            'vitest.server.config.ts',
            '--project',
            projects[layer],
            '--maxWorkers',
            maxWorkers === undefined || maxWorkers === '' ? String(DEFAULT_TEST_MAX_WORKERS) : maxWorkers,
            ...expandedFilters,
        ];
        const serialized = serializedLayerFiles[layer] ?? [];
        const splitLayer = serialized.length > 0 && layerFilters.length === 0;
        try {
            if (serializedOnly) {
                // CI split: only this layer's serialized files (or the given subset of them), in the
                // same single-worker invocation the whole-layer run uses for them below. Layers
                // without serialized files run nothing.
                const selected =
                    layerFilters.length === 0 ? serialized : serialized.filter(file => layerFilters.includes(file));
                if (layerFilters.length > 0 && selected.length !== layerFilters.length) {
                    throw new Error(`--serialized-only accepts only serialized ${layer} files: ${serialized.join(', ')}`);
                }
                if (selected.length === 0) {
                    continue;
                }
                await runImpl(
                    process.execPath,
                    [
                        'node_modules/vitest/vitest.mjs',
                        'run',
                        '--config',
                        'vitest.server.config.ts',
                        '--project',
                        projects[layer],
                        '--maxWorkers',
                        '1',
                        '--no-file-parallelism',
                        ...selected,
                    ],
                    { env: testEnvironment },
                );
                continue;
            }
            if (shard !== undefined) {
                // CI split: a round-robin slice of the layer's enumerated file list. Vitest's own
                // `--shard` cuts the sorted list into contiguous blocks, which puts the long-running
                // files into the same block; taking every n-th file spreads them. The serialized
                // files are never part of a shard;
                // `--serialized-only` runs them.
                const [shardIndex, shardCount] = shard.split('/').map(Number);
                const enumerated = (await enumerateLayerFiles(projects[layer], testEnvironment)).filter(
                    file => !serialized.includes(file),
                );
                const slice = enumerated.filter((_, index) => index % shardCount === shardIndex - 1);
                if (slice.length === 0) {
                    throw new Error(`No ${layer} tests enumerated for shard ${shard}`);
                }
                arguments_.push(...slice);
                await runImpl(process.execPath, arguments_, { env: testEnvironment });
                continue;
            }
            if (splitLayer) {
                // Project-level `exclude` wins over the CLI `--exclude`, so enumerate the layer with
                // `vitest list --filesOnly` and pass every non-serialized file as an explicit locator.
                const batchFiles = (await enumerateLayerFiles(projects[layer], testEnvironment)).filter(
                    file => !serialized.includes(file),
                );
                if (batchFiles.length === 0) {
                    throw new Error(`No ${layer} tests enumerated for the parallel batch`);
                }
                arguments_.push(...batchFiles);
            }
            await runImpl(process.execPath, arguments_, { env: testEnvironment });
            if (splitLayer) {
                // Deferred rather than run here (see `pendingSerializedFiles`'s own declaration and the
                // post-loop dispatch below): `shard` is always undefined at this point (the `shard !==
                // undefined` branch above already `continue`d), so every whole-layer run that reaches
                // here gathers this layer's own real-process files instead of dispatching them
                // per-layer. `EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1` (node-matrix's Node 26 leg only;
                // see `DOCKER_IMAGE_CHECK_LOCATOR`'s own doc) drops that one file here rather than in
                // `serialized`/`batchFiles` above, so it is excluded from the parallel batch the same
                // way it always is and simply never runs, instead of falling into the batch.
                pendingSerializedFiles.push(
                    ...(processEnv.EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK === '1'
                        ? serialized.filter(file => file !== DOCKER_IMAGE_CHECK_LOCATOR)
                        : serialized),
                );
            }
        } catch (error) {
            // Record this layer's failure and keep going: a whole-layer run must collect every
            // layer's failures in one pass instead of stopping at the first one (see the comment on
            // `layerFailures` above the loop).
            layerFailures.push({ layer, error });
            console.error(`FAILED-LAYER: ${layer}: ${error instanceof Error ? error.message : error}`);
        }
    }
    // Dispatched once, after every requested layer's own parallel batch has run (see
    // `pendingSerializedFiles`'s declaration above): the real-process files gathered across layers run
    // in a dedicated invocation of their own, without `--project` (each file's own project is
    // resolved from `vitest.server.config.ts`'s per-project `include` pattern), one at a time with
    // `--maxWorkers 1 --no-file-parallelism`, so their real Docker work never overlaps the MySQL
    // fixture teardown of the parallel batch. A failure here is recorded the same way a layer's own
    // failure is, so it never escapes this function silently and never discards an earlier layer's
    // own result.
    if (pendingSerializedFiles.length > 0) {
        try {
            await runImpl(
                process.execPath,
                [
                    'node_modules/vitest/vitest.mjs',
                    'run',
                    '--config',
                    'vitest.server.config.ts',
                    '--maxWorkers',
                    '1',
                    '--no-file-parallelism',
                    ...pendingSerializedFiles,
                ],
                { env: testEnvironment },
            );
        } catch (error) {
            layerFailures.push({ layer: 'serialized', error });
            console.error(`FAILED-LAYER: serialized: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (layerFailures.length > 0) {
        const detail = layerFailures
            .map(({ layer, error }) => `  - ${layer}: ${error instanceof Error ? error.message : error}`)
            .join('\n');
        throw new Error(`server test layer(s) failed:\n${detail}`);
    }
}

// Import-safe: only the direct CLI entry runs main. Wiring probes import this module for
// buildServerTestChildEnvironment without starting a run.
const isDirectRun =
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) await main(async () => {
    if (!['spec', 'imp', 'integration', 'all', 'coverage', 'recording-execution'].includes(mode)) {
        throw new Error(`Unknown server test mode: ${mode ?? '(missing)'}`);
    }
    const { locatorArguments, runOptions } = parseRunArguments(process.argv.slice(3), {
        allowOptions: wholeLayerModes.includes(mode),
    });
    const filters = locatorArguments.map(normalizeFilter);
    cliRunOptions = runOptions;
    if (mode === 'recording-execution' && filters.length > 0) {
        throw new Error('recording-execution does not accept additional test locators');
    }

    // Recorded here, before any build/test work begins, so the record states the content the run starts
    // from. It only says which content was measured; the verdict never depends on it.
    const worktreeContent = mode === COVERAGE_MODE ? await snapshotWorktreeContent(resolve('.')) : undefined;

    await run('npm', ['run', 'test:server:build']);

    // Fresh, run-specific raw V8 coverage directory (coverage mode only): mkdtemp
    // guarantees a directory this invocation has never seen before, so a later reader can never
    // observe a previous run's leftover artifact. Created here, before withCompiledSnapshot, because
    // that option is read from withCompiledSnapshot's own arguments before its action callback ever
    // runs -- it cannot be created from inside that callback and still reach this call. Not cleaned up
    // here: `runAgainstCompiledSnapshot`'s own `finally` (below, via `withCompiledSnapshot`'s action)
    // removes this run's own directory once the converter has read it, unless
    // `EPGSTATION_COVERAGE_KEEP_RAW=1` asks to keep it for post-mortem debugging. Without that
    // removal, test/server/.artifacts/coverage-raw would accumulate one directory per coverage
    // invocation forever.
    const rawCoverageDirectory =
        mode === COVERAGE_MODE
            ? await (async () => {
                  const coverageRoot = resolve('test/server/.artifacts/coverage-raw');
                  await mkdir(coverageRoot, { recursive: true });
                  return mkdtemp(join(coverageRoot, 'v8-'));
              })()
            : undefined;

    // A fresh, run-specific directory for
    // `test/server/harness/coverage-transform-capture.ts`'s per-worker captures of the Vitest
    // SSR-transformed module bodies actually executed (see that file's own module doc for why the
    // converter cannot trust raw V8 offsets to index the on-disk compiled-snapshot `dist/**\/*.js`
    // text directly). Always mkdtemp'd fresh by this process itself in coverage mode. Gated on `rawCoverageDirectory` being
    // set rather than a second comparison against COVERAGE_MODE: that value is defined if and only if
    // this run is in coverage mode (see its own ternary just above), so this is the same condition,
    // not a new one, and does not add another mode-comparison site.
    // Disk-leak fix: always removed by
    // `runAgainstCompiledSnapshot`'s own `finally` once consumed, unless
    // `EPGSTATION_COVERAGE_KEEP_RAW=1` (see that function's own ownership comment).
    const transformCaptureDirectory =
        rawCoverageDirectory !== undefined
            ? (await (async () => {
                  const transformCaptureRoot = resolve('test/server/.artifacts/coverage-transform-capture');
                  await mkdir(transformCaptureRoot, { recursive: true });
                  return mkdtemp(join(transformCaptureRoot, 'capture-'));
              })())
            : undefined;

    try {
        // Raw-dump disk-leak fix follow-up: tells `withCompiledSnapshot` not to require
        // `rawCoverageDirectory` to still exist once `runAgainstCompiledSnapshot` (called from the
        // `action` below) returns, for the one case where that function's own `finally` has already
        // removed it -- see `rawCoverageDirectoryReclaimedByThisRun`'s own doc.
        const rawCoverageDirectoryConsumedInsideAction =
            rawCoverageDirectory !== undefined && rawCoverageDirectoryReclaimedByThisRun(process.env);
        const snapshotOptions = { rawCoverageDirectory, rawCoverageDirectoryConsumedInsideAction };
        await withCompiledSnapshot(async compiledSnapshot => {
            return runAgainstCompiledSnapshot({
                compiledSnapshot,
                filters,
                rawCoverageDirectory,
                transformCaptureDirectory,
                worktreeContent,
            });
        }, snapshotOptions);
    } catch (error) {
        if (error instanceof BelowFullCoverageError) {
            // The run reached its terminal and cleaned up; only the exit status differs.
            exitStatusForCoverageError(error);
            return;
        }
        // Disk-leak guard for the raw-dump/capture directories: rawCoverageDirectory
        // and transformCaptureDirectory are both created before withCompiledSnapshot runs, so if
        // withCompiledSnapshot itself throws before its action ever ran (e.g. the compiled snapshot
        // copy fails), `runAgainstCompiledSnapshot`'s own ownership-aware `finally` never gets a
        // chance to reclaim either one -- this is the only remaining path that has to. Once the
        // action DID run, that `finally` has already reclaimed both (or intentionally kept them, when
        // `EPGSTATION_COVERAGE_KEEP_RAW=1`), so the `rm`/`readdir` below observe an already-removed directory and no-op
        // via `force`/the caught ENOENT. `EPGSTATION_COVERAGE_KEEP_RAW=1` skips this block entirely so
        // a genuine coverage-run failure that did populate real raw V8 data before failing is never
        // touched here, matching that env var's own "keep for post-mortem" intent.
        //
        // This cleanup is wrapped in its own try/catch
        // so a cleanup failure can never mask `error` above. This is not theoretical: the exact
        // ENOENT `withCompiledSnapshot` reports when rawCoverageDirectory is unreachable
        // (`compiled-snapshot.mjs#assertRawCoverageDirectoryObservable`) makes `readdir` on that same
        // missing path throw too -- without this inner try/catch, that readdir failure would replace
        // the original diagnostic instead of this block ever reaching `throw error;`.
        try {
            if (process.env.EPGSTATION_COVERAGE_KEEP_RAW !== '1') {
                if (transformCaptureDirectory !== undefined) {
                    await rm(transformCaptureDirectory, { force: true, recursive: true });
                }
                if (rawCoverageDirectory !== undefined && (await readdir(rawCoverageDirectory)).length === 0) {
                    await rm(rawCoverageDirectory, { force: true, recursive: true });
                }
            }
        } catch {
            // Best-effort cleanup only -- its own failure must never replace the real error below.
        }
        throw error;
    }
});
