import { describe, expect, it, vi } from 'vitest';

import {
    COVERAGE_GATE_REPORT_FILE_NAME,
    boundedCoverageEnv,
    buildUncoveredFileDetails,
    runCoverageGate,
    summarizeExcludedRecords,
    summarizeFunctionGranularityExclusions,
} from '../../../../scripts/server-test/run-coverage-gate-cli.mjs';
import { NODE_MATRIX_MAX_WORKERS } from '../../../../scripts/server-test/node-matrix-worker-cap.mjs';
import { BELOW_FULL_COVERAGE_EXIT_CODE } from '../../../../scripts/server-test/run-tests.mjs';

/**
 * `run-coverage-gate-cli.mjs` is the outer, node-matrix-only gate and requires `src/**`'s C0/C1 to
 * both be 100%. This file pins that contract: a real test failure or a broken/zero-population
 * aggregation fails this command; a well-formed C0/C1 under 100% also fails it
 * (`status: 'below-full-coverage'`),
 * separately from those two, after still writing the full report (value + per-file uncovered
 * statement/branch counts + excluded-record and function-granularity diagnostics) to
 * `coverage-gate-report.json` so the shortfall is visible. This does not change
 * `evaluateConverterCoverageTerminal`'s own inner disposition for the plain `test:server:coverage`
 * command, which still treats a well-formed percent under 100 as inner success.
 */

function coverageMapFixture() {
    return {
        'src/fully-covered.ts': {
            s: { 0: 1, 1: 3 },
            b: { 0: [1, 1] },
        },
        'src/partially-covered.ts': {
            s: { 0: 1, 1: 0, 2: 0 },
            b: { 0: [1, 0] },
        },
        'src/branch-only-gap.ts': {
            s: { 0: 1 },
            b: { 0: [1, 0, 1] },
        },
    };
}

describe('buildUncoveredFileDetails', () => {
    it('GREEN: omits fully-covered files and reports per-file uncovered statement/branch counts', () => {
        const details = buildUncoveredFileDetails(coverageMapFixture());
        expect(details).toEqual([
            {
                file: 'src/branch-only-gap.ts',
                statementsUncovered: 0,
                statementsTotal: 1,
                branchesUncovered: 1,
                branchesTotal: 3,
            },
            {
                file: 'src/partially-covered.ts',
                statementsUncovered: 2,
                statementsTotal: 3,
                branchesUncovered: 1,
                branchesTotal: 2,
            },
        ]);
    });

    it('GREEN: an all-covered map yields no uncovered file entries', () => {
        expect(
            buildUncoveredFileDetails({
                'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
            }),
        ).toEqual([]);
    });
});

describe('runCoverageGate', () => {
    it('RED-then-GREEN source: a real Vitest test failure rejects and never reads or writes a report', async () => {
        const runCoverageCommand = vi.fn().mockRejectedValue(new Error('npm exited with status 1'));
        const readCoverageFinal = vi.fn();
        const writeReport = vi.fn();

        await expect(
            runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport }),
        ).rejects.toThrow('npm exited with status 1');

        expect(readCoverageFinal).not.toHaveBeenCalled();
        expect(writeReport).not.toHaveBeenCalled();
    });

    it('RED: well-formed C0/C1 under 100% rejects (non-zero) after still writing the below-full-coverage report', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue(coverageMapFixture());
        const writeReport = vi.fn().mockResolvedValue(undefined);

        await expect(
            runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport }),
        ).rejects.toThrow(/both must be 100%/u);

        expect(writeReport).toHaveBeenCalledTimes(1);
        const report = writeReport.mock.calls[0][1];
        expect(report.status).toBe('below-full-coverage');
        expect(report.statementsPercent).toBeLessThan(100);
        expect(report.branchesPercent).toBeLessThan(100);
        expect(report.uncoveredFiles).toEqual([
            {
                file: 'src/branch-only-gap.ts',
                statementsUncovered: 0,
                statementsTotal: 1,
                branchesUncovered: 1,
                branchesTotal: 3,
            },
            {
                file: 'src/partially-covered.ts',
                statementsUncovered: 2,
                statementsTotal: 3,
                branchesUncovered: 1,
                branchesTotal: 2,
            },
        ]);
    });

    it('RED: a command that exits with the below-full-coverage status still gets its report written, then rejects', async () => {
        const runCoverageCommand = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error('npm exited with status 3'), { exitCode: BELOW_FULL_COVERAGE_EXIT_CODE }));
        const readCoverageFinal = vi.fn().mockResolvedValue(coverageMapFixture());
        const writeReport = vi.fn().mockResolvedValue(undefined);

        await expect(runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport })).rejects.toThrow(
            /both must be 100%/u,
        );

        expect(writeReport).toHaveBeenCalledTimes(1);
        expect(writeReport.mock.calls[0][1].status).toBe('below-full-coverage');
    });

    it('RED: a command failing with any other status (test failure, unexecuted script) writes no report', async () => {
        const runCoverageCommand = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error('npm exited with status 1'), { exitCode: 1 }));
        const readCoverageFinal = vi.fn();
        const writeReport = vi.fn();

        await expect(runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport })).rejects.toThrow(
            'npm exited with status 1',
        );
        expect(readCoverageFinal).not.toHaveBeenCalled();
        expect(writeReport).not.toHaveBeenCalled();
    });

    it('RED: a below-full-coverage exit status with a 100% coverage-final.json is an inconsistent measurement and writes no report', async () => {
        const runCoverageCommand = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error('npm exited with status 3'), { exitCode: BELOW_FULL_COVERAGE_EXIT_CODE }));
        const readCoverageFinal = vi.fn().mockResolvedValue({ 'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } } });
        const writeReport = vi.fn();

        await expect(runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport })).rejects.toThrow(
            /inconsistent measurement/u,
        );
        expect(writeReport).not.toHaveBeenCalled();
    });

    it('GREEN: C0/C1 both at 100% resolves as a complete report', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({
            'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
        });
        const writeReport = vi.fn().mockResolvedValue(undefined);

        const report = await runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport });

        expect(report.status).toBe('complete');
        expect(report.statementsPercent).toBe(100);
        expect(report.branchesPercent).toBe(100);
        expect(report.uncoveredFiles).toEqual([]);
        expect(writeReport).toHaveBeenCalledTimes(1);
    });

    it('RED-then-GREEN source: a zero-population coverage-final.json (broken aggregation) rejects and never writes a report', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({});
        const writeReport = vi.fn();

        await expect(
            runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport }),
        ).rejects.toThrow(/zero-population/u);

        expect(writeReport).not.toHaveBeenCalled();
    });

    it('RED-then-GREEN source: unreadable coverage-final.json rejects and never writes a report', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockRejectedValue(new Error('ENOENT: no such file'));
        const writeReport = vi.fn();

        await expect(
            runCoverageGate({ runCoverageCommand, readCoverageFinal, writeReport }),
        ).rejects.toThrow('ENOENT: no such file');

        expect(writeReport).not.toHaveBeenCalled();
    });

    it('GREEN: report file name is the canonical, stable coverage-gate-report.json', () => {
        expect(COVERAGE_GATE_REPORT_FILE_NAME).toBe('coverage-gate-report.json');
    });

    /**
     * Undercounting visibility: an excluded raw record contributes
     * nothing to `coverage-final.json`, so without a dedicated field the gate report alone could never
     * show that any evidence was dropped. `excludedRecordCount`/`excludedRecordsByScript` surface it,
     * without ever changing `status` on their own.
     */
    it('GREEN: excluded records are counted and broken down by script, without affecting status', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({
            'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
        });
        const readExcludedRecords = vi.fn().mockResolvedValue([
            { pid: 111, relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-111.json' },
            { pid: 222, relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-222.json' },
            { pid: 333, relativeScriptPath: 'model/Bar.js', sourceFile: 'coverage-333.json' },
        ]);
        const writeReport = vi.fn().mockResolvedValue(undefined);

        const report = await runCoverageGate({
            runCoverageCommand,
            readCoverageFinal,
            readExcludedRecords,
            writeReport,
        });

        expect(report.status).toBe('complete');
        expect(report.excludedRecordCount).toBe(3);
        expect(report.excludedRecordsByScript).toEqual([
            { script: 'model/Bar.js', count: 1 },
            { script: 'model/Foo.js', count: 2 },
        ]);
    });

    it('GREEN: no excluded-records sidecar (older coverage-final.json, or a run with zero exclusions) reports zero, never a failure', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({
            'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
        });
        const readExcludedRecords = vi.fn().mockResolvedValue([]);
        const writeReport = vi.fn().mockResolvedValue(undefined);

        const report = await runCoverageGate({
            runCoverageCommand,
            readCoverageFinal,
            readExcludedRecords,
            writeReport,
        });

        expect(report.excludedRecordCount).toBe(0);
        expect(report.excludedRecordsByScript).toEqual([]);
    });

    /**
     * A function-granularity-only-positive-count range inside an
     * otherwise-verified record contributes 0 for spans inside it (never fails the run, never inflates),
     * but the gap must stay visible -- mirrors the excluded-record reporting above, one level more
     * specific (script + function + dump, not just script).
     */
    it('GREEN: function-granularity exclusions are counted and broken down by function, without affecting status', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({
            'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
        });
        const readFunctionGranularityExclusions = vi.fn().mockResolvedValue([
            { functionName: 'ctor', relativeScriptPath: 'model/StartupStageObserver.js', sourceFile: 'coverage-1.json' },
            { functionName: 'ctor', relativeScriptPath: 'model/StartupStageObserver.js', sourceFile: 'coverage-2.json' },
            { functionName: 'run', relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-1.json' },
        ]);
        const writeReport = vi.fn().mockResolvedValue(undefined);

        const report = await runCoverageGate({
            runCoverageCommand,
            readCoverageFinal,
            readFunctionGranularityExclusions,
            writeReport,
        });

        expect(report.status).toBe('complete');
        expect(report.functionGranularityExclusionCount).toBe(3);
        expect(report.functionGranularityExclusionsByFunction).toEqual([
            { count: 1, dumps: ['coverage-1.json'], functionName: 'run', script: 'model/Foo.js' },
            {
                count: 2,
                dumps: ['coverage-1.json', 'coverage-2.json'],
                functionName: 'ctor',
                script: 'model/StartupStageObserver.js',
            },
        ]);
    });

    it('GREEN: no function-granularity exclusions (older sidecar, or a run with none) reports zero, never a failure', async () => {
        const runCoverageCommand = vi.fn().mockResolvedValue(undefined);
        const readCoverageFinal = vi.fn().mockResolvedValue({
            'src/fully-covered.ts': { s: { 0: 1 }, b: { 0: [1, 1] } },
        });
        const readFunctionGranularityExclusions = vi.fn().mockResolvedValue([]);
        const writeReport = vi.fn().mockResolvedValue(undefined);

        const report = await runCoverageGate({
            runCoverageCommand,
            readCoverageFinal,
            readFunctionGranularityExclusions,
            writeReport,
        });

        expect(report.functionGranularityExclusionCount).toBe(0);
        expect(report.functionGranularityExclusionsByFunction).toEqual([]);
    });
});

describe('summarizeExcludedRecords', () => {
    it('GREEN: counts per script, sorted by script path, unknown relativeScriptPath falls back to "unknown"', () => {
        expect(
            summarizeExcludedRecords([
                { relativeScriptPath: 'model/B.js' },
                { relativeScriptPath: 'model/A.js' },
                { relativeScriptPath: 'model/A.js' },
                {},
            ]),
        ).toEqual([
            { script: 'model/A.js', count: 2 },
            { script: 'model/B.js', count: 1 },
            { script: 'unknown', count: 1 },
        ]);
    });

    it('GREEN: an empty array yields an empty breakdown', () => {
        expect(summarizeExcludedRecords([])).toEqual([]);
    });
});

describe('summarizeFunctionGranularityExclusions', () => {
    it('GREEN: groups by (script, function), sorted, with distinct dump files deduplicated and sorted', () => {
        expect(
            summarizeFunctionGranularityExclusions([
                { functionName: 'b', relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-2.json' },
                { functionName: 'a', relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-1.json' },
                { functionName: 'a', relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-1.json' },
                { relativeScriptPath: 'model/Foo.js', sourceFile: 'coverage-3.json' },
                {},
            ]),
        ).toEqual([
            { count: 1, dumps: ['coverage-3.json'], functionName: '<anonymous>', script: 'model/Foo.js' },
            { count: 2, dumps: ['coverage-1.json'], functionName: 'a', script: 'model/Foo.js' },
            { count: 1, dumps: ['coverage-2.json'], functionName: 'b', script: 'model/Foo.js' },
            { count: 1, dumps: ['unknown'], functionName: '<anonymous>', script: 'unknown' },
        ]);
    });

    it('GREEN: an empty array yields an empty breakdown', () => {
        expect(summarizeFunctionGranularityExclusions([])).toEqual([]);
    });
});

describe('boundedCoverageEnv', () => {
    /**
     * The Node 24 leg here and the Node 26 leg in `run-node-acceptance-matrix.mjs` both read the
     * same `NODE_MATRIX_MAX_WORKERS` constant from `node-matrix-worker-cap.mjs`, so neither leg
     * inherits the preflight's `availableParallelism()`-sized value uncapped.
     */
    it('GREEN: lowers a requested worker count above NODE_MATRIX_MAX_WORKERS to the shared cap', () => {
        const env = boundedCoverageEnv({ EPGSTATION_TEST_MAX_WORKERS: '16' });
        expect(env.EPGSTATION_TEST_MAX_WORKERS).toBe(String(NODE_MATRIX_MAX_WORKERS));
    });

    it('GREEN: an unset requested worker count defaults to the shared cap', () => {
        const env = boundedCoverageEnv({});
        expect(env.EPGSTATION_TEST_MAX_WORKERS).toBe(String(NODE_MATRIX_MAX_WORKERS));
    });

    it('GREEN: a requested worker count already below the shared cap is kept, never raised', () => {
        const env = boundedCoverageEnv({ EPGSTATION_TEST_MAX_WORKERS: '2' });
        expect(env.EPGSTATION_TEST_MAX_WORKERS).toBe('2');
    });

    it('GREEN: appends the coverage heap bound to any pre-existing NODE_OPTIONS', () => {
        const env = boundedCoverageEnv({ NODE_OPTIONS: '--some-flag' });
        expect(env.NODE_OPTIONS).toBe('--some-flag --max-old-space-size=8192');
    });
});
