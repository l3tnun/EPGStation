import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
    CANONICAL_COVERAGE_DIRECTORY_SEGMENTS,
    COVERAGE_EXCLUDED_RECORDS_FILE_NAME,
    COVERAGE_FINAL_FILE_NAME,
    summarizeCoverage,
} from './compiled-snapshot-coverage.mjs';
import { boundedNodeMatrixWorkerCount } from './node-matrix-worker-cap.mjs';
import { run } from './process.mjs';
import {
    BELOW_FULL_COVERAGE_EXIT_CODE,
    BelowFullCoverageError,
    evaluateConverterCoverageTerminal,
} from './run-tests.mjs';

/**
 * Coverage is judged by running the unit tests (spec and imp) once with coverage instrumentation and
 * checking the result.
 *
 * This CLI runs `npm run test:server:coverage` (one invocation of the spec and imp tests; integration
 * tests are not part of it) and then reports that same run's canonical `coverage-final.json` C0
 * (statements) / C1 (branches). `src/**`'s C0 and C1 must both be 100%. The run measures the worktree's
 * content as it is (uncommitted changes included); that content is recorded, not a condition. A real
 * Vitest test failure, a script no test executed (`missing-raw-record`) or a zero-population/malformed
 * `coverage-final.json` fails this command (via `runCoverageCommand()` or
 * `evaluateConverterCoverageTerminal` below); a well-formed C0/C1 under 100% also fails it
 * (`status: 'below-full-coverage'`), separately from those. The plain `test:server:coverage` command
 * itself also exits non-zero under 100% (`BELOW_FULL_COVERAGE_EXIT_CODE`, pinned by
 * `test/server/application-runtime/spec/coverage-command-terminal.test.ts`); this gate recognizes that
 * exit status, still reads the canonical `coverage-final.json`, and records the shortfall. A test
 * failure, an unexecuted script or a broken measurement ends the command with another
 * status and writes no report. The C0/C1 numbers and a
 * per-file breakdown of uncovered statements/branches are always written to
 * `coverage-gate-report.json` next to `coverage-final.json` (and printed to stdout), including on a
 * below-100% failure, so the shortfall is visible without having to reproduce the run. The only
 * sanctioned way to shrink the measured population is the reviewed `COVERAGE_EXCLUSION_AUTHORIZATIONS`
 * table in `compiled-snapshot-coverage.mjs` (plus that module's statement basis, which omits
 * syntax-only spans such as a bare `{`, `}`, or `else` with no executable token); this gate itself
 * performs no exclusion of its own.
 *
 * `coverage-gate-report.json` also carries `excludedRecordCount` and `excludedRecordsByScript` -- the
 * count and per-script breakdown of raw V8 records `discoverCompiledSnapshotCoverage` excluded as
 * unverifiable during this run (see `COVERAGE_EXCLUDED_RECORDS_FILE_NAME`'s own doc in
 * `compiled-snapshot-coverage.mjs`). An excluded record never changes this gate's `status` by itself --
 * the script it belongs to already has other, verified evidence, or the whole run would already have
 * failed closed as `unverified-raw-offset-space` -- so this is reported exactly like `uncoveredFiles`,
 * purely diagnostic; only the measured C0/C1 percentages decide `status`.
 *
 * `EPGSTATION_TEST_MAX_WORKERS` and `NODE_OPTIONS` below bound the instrumented run's concurrency and
 * heap (`--max-old-space-size=8192`); both can only lower `run-tests.mjs`'s own 8-worker ceiling,
 * never raise it, so a caller that already set a stricter cap keeps it. The worker cap
 * (`boundedNodeMatrixWorkerCount`) is shared with the Node 24 integration command and the Node 26
 * command in `run-node-acceptance-matrix.mjs`; see `node-matrix-worker-cap.mjs`.
 */

const COVERAGE_GATE_NODE_OPTIONS = '--max-old-space-size=8192';
export const COVERAGE_GATE_REPORT_FILE_NAME = 'coverage-gate-report.json';

export function boundedCoverageEnv(baseEnv) {
    const workers = boundedNodeMatrixWorkerCount(baseEnv);
    const nodeOptions = [baseEnv.NODE_OPTIONS, COVERAGE_GATE_NODE_OPTIONS].filter(Boolean).join(' ');
    return {
        ...baseEnv,
        EPGSTATION_TEST_MAX_WORKERS: String(workers),
        NODE_OPTIONS: nodeOptions,
    };
}

/**
 * Per-file uncovered statement/branch counts (not just the bare `uncoveredFiles` name list
 * `summarizeCoverage` already returns -- that shape is pinned by
 * `test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` and
 * `coverage-command-terminal.test.ts`, so it is left unchanged). Sorted by file path so the report
 * and stdout output are stable across runs of the same coverage-final.json.
 */
export function buildUncoveredFileDetails(coverageMap) {
    const details = [];
    for (const [sourcePath, fileCoverage] of Object.entries(coverageMap)) {
        const statementCounts = Object.values(fileCoverage.s ?? {});
        const statementsTotal = statementCounts.length;
        const statementsCovered = statementCounts.filter(count => count > 0).length;

        const branchOutcomeCounts = Object.values(fileCoverage.b ?? {}).flat();
        const branchesTotal = branchOutcomeCounts.length;
        const branchesCovered = branchOutcomeCounts.filter(count => count > 0).length;

        const statementsUncovered = statementsTotal - statementsCovered;
        const branchesUncovered = branchesTotal - branchesCovered;
        if (statementsUncovered > 0 || branchesUncovered > 0) {
            details.push({
                file: sourcePath,
                statementsUncovered,
                statementsTotal,
                branchesUncovered,
                branchesTotal,
            });
        }
    }
    return details.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * Reads back the `coverage-excluded-records.json` sidecar `writeCanonicalCoverageArtifacts` (via the
 * inner `npm run test:server:coverage` this gate just ran) writes next to `coverage-final.json` --
 * undercounting visibility (see that constant's own doc): a raw record excluded as unverifiable
 * contributes nothing to `coverage-final.json`, so without this sidecar the gate report alone could not
 * show that any evidence was dropped. Missing/unreadable/malformed is treated as "zero exclusions", not
 * a gate failure -- a `coverage-final.json` produced without this sidecar is exactly as trustworthy
 * as one produced with it, and this gate does not require the sidecar to run at all.
 */
async function readExcludedRecordsSidecar(repositoryRoot) {
    try {
        return JSON.parse(
            await readFile(
                resolve(repositoryRoot, ...CANONICAL_COVERAGE_DIRECTORY_SEGMENTS, COVERAGE_EXCLUDED_RECORDS_FILE_NAME),
                'utf8',
            ),
        );
    } catch {
        return null;
    }
}

async function defaultReadExcludedRecords(repositoryRoot) {
    const payload = await readExcludedRecordsSidecar(repositoryRoot);
    return Array.isArray(payload?.excludedRecords) ? payload.excludedRecords : [];
}

/**
 * Reads the SAME `coverage-excluded-records.json` sidecar's own `functionGranularityExclusions` field
 * (see that constant's own doc in `compiled-snapshot-coverage.mjs`) -- one specific
 * `isBlockCoverage: false`-with-positive-count range inside an otherwise-verified record, undercounting
 * spans that fall inside it while the rest of that record still counts normally. Same best-effort
 * contract as `defaultReadExcludedRecords`: missing/unreadable/malformed sidecar means zero, never a gate
 * failure.
 */
async function defaultReadFunctionGranularityExclusions(repositoryRoot) {
    const payload = await readExcludedRecordsSidecar(repositoryRoot);
    return Array.isArray(payload?.functionGranularityExclusions) ? payload.functionGranularityExclusions : [];
}

/**
 * Per-script exclusion counts from `excludedRecords` (each entry's own `relativeScriptPath`), sorted by
 * script path so the report and stdout output are stable across runs -- mirrors
 * `buildUncoveredFileDetails`'s own "count + name, sorted" shape.
 */
export function summarizeExcludedRecords(excludedRecords) {
    const countsByScript = new Map();
    for (const record of excludedRecords) {
        const script = typeof record?.relativeScriptPath === 'string' ? record.relativeScriptPath : 'unknown';
        countsByScript.set(script, (countsByScript.get(script) ?? 0) + 1);
    }
    return [...countsByScript.entries()]
        .map(([script, count]) => ({ script, count }))
        .sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0));
}

/**
 * Per-(script, function) breakdown of `functionGranularityExclusions`, each with the count of distinct
 * offending ranges and the sorted, deduplicated dump files they came from -- naming script, function, and
 * dump together, rather than collapsing to a bare count like
 * `summarizeExcludedRecords` does for whole-record exclusions.
 */
export function summarizeFunctionGranularityExclusions(exclusions) {
    const bucketsByKey = new Map();
    for (const exclusion of exclusions) {
        const script = typeof exclusion?.relativeScriptPath === 'string' ? exclusion.relativeScriptPath : 'unknown';
        const functionName =
            typeof exclusion?.functionName === 'string' && exclusion.functionName.length > 0
                ? exclusion.functionName
                : '<anonymous>';
        const key = `${script}\u0000${functionName}`;
        const bucket = bucketsByKey.get(key) ?? { count: 0, dumps: new Set(), functionName, script };
        bucket.count += 1;
        bucket.dumps.add(typeof exclusion?.sourceFile === 'string' ? exclusion.sourceFile : 'unknown');
        bucketsByKey.set(key, bucket);
    }
    return [...bucketsByKey.values()]
        .map(bucket => ({
            count: bucket.count,
            dumps: [...bucket.dumps].sort(),
            functionName: bucket.functionName,
            script: bucket.script,
        }))
        .sort((a, b) =>
            a.script === b.script
                ? a.functionName < b.functionName
                    ? -1
                    : a.functionName > b.functionName
                      ? 1
                      : 0
                : a.script < b.script
                  ? -1
                  : 1,
        );
}

async function defaultWriteReport(repositoryRoot, report) {
    const directory = resolve(repositoryRoot, ...CANONICAL_COVERAGE_DIRECTORY_SEGMENTS);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, COVERAGE_GATE_REPORT_FILE_NAME), `${JSON.stringify(report, null, 4)}\n`, 'utf8');
}

function formatUncoveredFileLine(detail) {
    return (
        `  - ${detail.file}: statements ${detail.statementsUncovered} uncovered ` +
        `(${detail.statementsTotal - detail.statementsUncovered}/${detail.statementsTotal}), ` +
        `branches ${detail.branchesUncovered} uncovered (${detail.branchesTotal - detail.branchesUncovered}/${detail.branchesTotal})`
    );
}

export async function runCoverageGate({
    repositoryRoot = process.cwd(),
    runCoverageCommand = () =>
        run('npm', ['run', 'test:server:coverage'], {
            cwd: repositoryRoot,
            env: boundedCoverageEnv(process.env),
        }),
    readCoverageFinal = async () =>
        JSON.parse(
            await readFile(
                resolve(repositoryRoot, ...CANONICAL_COVERAGE_DIRECTORY_SEGMENTS, COVERAGE_FINAL_FILE_NAME),
                'utf8',
            ),
        ),
    readExcludedRecords = defaultReadExcludedRecords,
    readFunctionGranularityExclusions = defaultReadFunctionGranularityExclusions,
    summarize = summarizeCoverage,
    evaluateTerminal = evaluateConverterCoverageTerminal,
    buildUncoveredDetails = buildUncoveredFileDetails,
    summarizeExcluded = summarizeExcludedRecords,
    summarizeFunctionGranularity = summarizeFunctionGranularityExclusions,
    writeReport = defaultWriteReport,
} = {}) {
    // `npm run test:server:coverage` fails closed on a real Vitest test failure, a
    // script no test executed, or a zero-population/malformed coverage-final.json (see
    // `evaluateConverterCoverageTerminal` in `run-tests.mjs`); this call surfaces those failures
    // unchanged, without a report. It also exits non-zero when the measurement is well-formed but under
    // 100% (`BELOW_FULL_COVERAGE_EXIT_CODE`): that case still reads the canonical `coverage-final.json`
    // below so the report records the shortfall.
    let commandBelowFullCoverage = false;
    try {
        await runCoverageCommand();
    } catch (error) {
        if (error?.exitCode !== BELOW_FULL_COVERAGE_EXIT_CODE) {
            throw error;
        }
        commandBelowFullCoverage = true;
    }

    const coverageMap = await readCoverageFinal();
    const summary = summarize(coverageMap);
    // Same fail-closed measurement check `run-tests.mjs` already applies to this file when it is
    // first written: zero-population or an internally inconsistent summary is this gate's own
    // aggregation being broken, not a coverage shortfall, so it throws rather than being recorded as
    // backlog.
    let belowFullCoverage = false;
    try {
        evaluateTerminal(summary);
    } catch (error) {
        if (!(error instanceof BelowFullCoverageError)) {
            throw error;
        }
        belowFullCoverage = true;
    }
    if (commandBelowFullCoverage && !belowFullCoverage) {
        throw new Error(
            'coverage gate: the coverage command reported below-full-coverage but coverage-final.json is at 100%/100% (inconsistent measurement)',
        );
    }
    const uncoveredFiles = buildUncoveredDetails(coverageMap);
    // Undercounting visibility (see `COVERAGE_EXCLUDED_RECORDS_FILE_NAME`'s own doc): an excluded raw
    // record never failed this gate on its own (this run already proved OTHER evidence for its script,
    // or the whole run would already have failed closed as `unverified-raw-offset-space`) -- it is
    // reported here so the shortfall stays visible, exactly like `uncoveredFiles` below, never a reason
    // to change `status`.
    const excludedRecords = await readExcludedRecords(repositoryRoot);
    const excludedRecordsByScript = summarizeExcluded(excludedRecords);
    // Same undercounting-visibility contract as `excludedRecords` above, for the finer-grained
    // function-granularity-only-positive-count case (see `makeFunctionGranularityExclusionReporter` in
    // `compiled-snapshot-coverage.mjs`): never a `status` change on its own.
    const functionGranularityExclusions = await readFunctionGranularityExclusions(repositoryRoot);
    const functionGranularityExclusionsByFunction = summarizeFunctionGranularity(functionGranularityExclusions);
    // C0/C1 must both be 100%. A broken measurement already threw above; a well-formed shortfall is
    // recorded here as `below-full-coverage`.
    const status = belowFullCoverage ? 'below-full-coverage' : 'complete';
    const report = Object.freeze({
        status,
        statementsCovered: summary.statementsCovered,
        statementsTotal: summary.statementsTotal,
        statementsPercent: summary.statementsPercent,
        branchesCovered: summary.branchesCovered,
        branchesTotal: summary.branchesTotal,
        branchesPercent: summary.branchesPercent,
        uncoveredFiles: Object.freeze(uncoveredFiles.map(detail => Object.freeze({ ...detail }))),
        excludedRecordCount: excludedRecords.length,
        excludedRecordsByScript: Object.freeze(excludedRecordsByScript.map(detail => Object.freeze({ ...detail }))),
        functionGranularityExclusionCount: functionGranularityExclusions.length,
        functionGranularityExclusionsByFunction: Object.freeze(
            functionGranularityExclusionsByFunction.map(detail =>
                Object.freeze({ ...detail, dumps: Object.freeze([...detail.dumps]) }),
            ),
        ),
    });

    await writeReport(repositoryRoot, report);

    console.log(
        `coverage gate: statements ${report.statementsPercent}% (${report.statementsCovered}/${report.statementsTotal}), ` +
            `branches ${report.branchesPercent}% (${report.branchesCovered}/${report.branchesTotal}) -- ${
                status === 'complete' ? 'complete (100%/100%)' : 'BELOW FULL COVERAGE (must be 100%/100%)'
            }`,
    );
    if (report.excludedRecordCount > 0) {
        console.log(
            `coverage gate: ${report.excludedRecordCount} raw record(s) excluded as unverifiable (not a status change):\n` +
                report.excludedRecordsByScript.map(detail => `  - ${detail.script}: ${detail.count}`).join('\n'),
        );
    }
    if (report.functionGranularityExclusionCount > 0) {
        console.log(
            `coverage gate: ${report.functionGranularityExclusionCount} function-granularity-only exclusion(s) (not a status change):\n` +
                report.functionGranularityExclusionsByFunction
                    .map(
                        detail =>
                            `  - ${detail.script}#${detail.functionName}: ${detail.count} (${detail.dumps.join(', ')})`,
                    )
                    .join('\n'),
        );
    }
    if (status === 'below-full-coverage') {
        const detail =
            report.uncoveredFiles.length > 0
                ? `\nuncovered files (${report.uncoveredFiles.length}):\n${report.uncoveredFiles.map(formatUncoveredFileLine).join('\n')}`
                : '';
        throw new Error(
            `coverage gate failed: statements ${report.statementsPercent}% branches ${report.branchesPercent}% ` +
                `(both must be 100%)${detail}`,
        );
    }

    return report;
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
    try {
        await runCoverageGate();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
