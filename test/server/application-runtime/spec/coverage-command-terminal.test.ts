import { access, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { withCompiledSnapshot } from '../../../../scripts/server-test/compiled-snapshot.mjs';
import {
    commandsForMajor,
    nodeMatrixCommandEnv,
    parseNodeAcceptanceMatrixArguments,
    runNodeAcceptanceMatrix,
    runNodeAcceptanceMatrixCli,
    writeNodeAcceptanceArtifact,
} from '../../../../scripts/server-test/run-node-acceptance-matrix.mjs';
import {
    BELOW_FULL_COVERAGE_EXIT_CODE,
    BelowFullCoverageError,
    evaluateConverterCoverageTerminal,
    exitStatusForCoverageError,
    rawCoverageDirectoryReclaimedByThisRun,
    runAgainstCompiledSnapshot,
} from '../../../../scripts/server-test/run-tests.mjs';
import { SERIALIZED_REAL_PROCESS_FILES } from '../../../../scripts/server-test/serialized-real-process-files.mjs';

/**
 * Leaf 38 inner/public converter one-shot terminal.
 * Public argv is `npm run test:server:coverage -- <files>` (the filter-free public invocation uses the
 * same runner and measures the unit tests, spec and imp, in one Vitest invocation).
 *
 * Helper unit matrix remains, and child-path probes drive `runAgainstCompiledSnapshot` (production
 * coverage path) with injected run/write/summarize deps so unplugging the terminal evaluator or
 * swallowing Vitest/writeCanonical failures turns RED.
 */

/** A clean worktree: the content tree is HEAD's tree. */
const CLEAN_WORKTREE_CONTENT = {
    contentTree: 'a'.repeat(40),
    headTree: 'a'.repeat(40),
    uncommittedChanges: false,
};
/** A worktree with uncommitted changes: the content tree differs from HEAD's tree. */
const UNCOMMITTED_WORKTREE_CONTENT = {
    contentTree: 'b'.repeat(40),
    headTree: 'a'.repeat(40),
    uncommittedChanges: true,
};
/** Git was unavailable: nothing could be recorded. */
const UNRECORDED_WORKTREE_CONTENT = { contentTree: null, headTree: null, uncommittedChanges: null };

function summary(overrides: Record<string, unknown> = {}) {
    return {
        statementsCovered: 100,
        statementsTotal: 100,
        statementsPercent: 100,
        branchesCovered: 100,
        branchesTotal: 100,
        branchesPercent: 100,
        uncoveredFiles: Object.freeze([] as string[]),
        ...overrides,
    };
}

function wellFormed(counts: {
    statementsCovered: number;
    statementsTotal: number;
    branchesCovered: number;
    branchesTotal: number;
}) {
    return summary({
        ...counts,
        statementsPercent: (counts.statementsCovered / counts.statementsTotal) * 100,
        branchesPercent: (counts.branchesCovered / counts.branchesTotal) * 100,
        uncoveredFiles:
            counts.statementsCovered < counts.statementsTotal || counts.branchesCovered < counts.branchesTotal
                ? Object.freeze(['src/example.ts'])
                : Object.freeze([] as string[]),
    });
}

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) {
            await rm(dir, { recursive: true, force: true });
        }
    }
});

async function probeCoverageCommandPath(options: {
    summarizeCoverage?: (map: unknown) => unknown;
    writeCanonicalCoverageArtifacts?: (args: unknown) => Promise<{ coverageMap: unknown }>;
    run?: (...args: unknown[]) => Promise<unknown>;
    enumerateLayerFiles?: (project: string, environment: NodeJS.ProcessEnv) => Promise<string[]>;
    filters?: string[];
    worktreeContent?: Record<string, unknown>;
}): Promise<void> {
    const rawCoverageDirectory = await mkdtemp(join(tmpdir(), 'leaf5-coverage-terminal-'));
    tempDirs.push(rawCoverageDirectory);
    await runAgainstCompiledSnapshot({
        compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
        filters: options.filters ?? [],
        rawCoverageDirectory,
        worktreeContent: options.worktreeContent ?? CLEAN_WORKTREE_CONTENT,
        dependencies: {
            mode: 'coverage',
            processEnv: { ...process.env },
            mkdir: async () => undefined,
            enumerateLayerFiles:
                options.enumerateLayerFiles ?? (async (project: string) => [`${project}/synthetic.test.ts`]),
            run:
                options.run ??
                (async () => {
                    /* vitest child success */
                }),
            writeCanonicalCoverageArtifacts:
                options.writeCanonicalCoverageArtifacts ??
                (async () => ({ coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } } })),
            summarizeCoverage:
                options.summarizeCoverage ??
                (() =>
                    wellFormed({
                        statementsCovered: 1,
                        statementsTotal: 1,
                        branchesCovered: 1,
                        branchesTotal: 1,
                    })),
        },
    });
}

describe('inner/public converter helper matrix', () => {
    it('GREEN: C0 and C1 both 100% is command success (exit 0)', () => {
        const result = evaluateConverterCoverageTerminal(
            wellFormed({ statementsCovered: 10, statementsTotal: 10, branchesCovered: 4, branchesTotal: 4 }),
        );
        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);
        expect(result.disposition).toBe('measurement-success');
    });

    it.each([
        { name: '0', statementsCovered: 0, statementsTotal: 10, branchesCovered: 0, branchesTotal: 5 },
        { name: '1', statementsCovered: 1, statementsTotal: 100, branchesCovered: 1, branchesTotal: 100 },
        { name: '<100', statementsCovered: 50, statementsTotal: 100, branchesCovered: 99, branchesTotal: 100 },
        { name: 'statements only', statementsCovered: 9, statementsTotal: 10, branchesCovered: 4, branchesTotal: 4 },
        { name: 'branches only', statementsCovered: 10, statementsTotal: 10, branchesCovered: 3, branchesTotal: 4 },
    ])('RED: well-formed percent $name (under 100% for C0 or C1) is command nonzero', ({ name: _n, ...counts }) => {
        let thrown: unknown;
        try {
            evaluateConverterCoverageTerminal(wellFormed(counts));
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(BelowFullCoverageError);
        expect((thrown as BelowFullCoverageError).exitCode).toBe(BELOW_FULL_COVERAGE_EXIT_CODE);
        expect((thrown as Error).message).toMatch(/below-full-coverage/u);
        expect((thrown as Error).message).toContain('src/example.ts');
    });

    it('the below-100% status differs from the generic failure status 1', () => {
        expect(BELOW_FULL_COVERAGE_EXIT_CODE).not.toBe(0);
        expect(BELOW_FULL_COVERAGE_EXIT_CODE).not.toBe(1);
    });

    it.each([
        {
            label: 'zero-population statements',
            overrides: {
                statementsCovered: 0,
                statementsTotal: 0,
                statementsPercent: 0,
                branchesCovered: 1,
                branchesTotal: 1,
                branchesPercent: 100,
            },
            reason: /zero-population/u,
        },
        {
            label: 'zero-population branches',
            overrides: {
                statementsCovered: 1,
                statementsTotal: 1,
                statementsPercent: 100,
                branchesCovered: 0,
                branchesTotal: 0,
                branchesPercent: 0,
            },
            reason: /zero-population/u,
        },
        {
            label: 'malformed non-integer covered',
            overrides: {
                statementsCovered: 0.5,
                statementsTotal: 1,
                statementsPercent: 50,
            },
            reason: /malformed|schema-mismatch|safe integer|integer/u,
        },
        {
            label: 'malformed covered > total',
            overrides: {
                statementsCovered: 5,
                statementsTotal: 4,
                statementsPercent: 125,
                branchesCovered: 1,
                branchesTotal: 1,
                branchesPercent: 100,
            },
            reason: /malformed|incoherent|covered|schema-mismatch/u,
        },
        {
            label: 'malformed NaN percent',
            overrides: {
                statementsCovered: 1,
                statementsTotal: 1,
                statementsPercent: Number.NaN,
            },
            reason: /malformed|finite|schema-mismatch/u,
        },
        {
            label: 'percent inconsistency',
            overrides: {
                statementsCovered: 1,
                statementsTotal: 2,
                statementsPercent: 100,
                branchesCovered: 1,
                branchesTotal: 1,
                branchesPercent: 100,
            },
            reason: /malformed|incoherent|percent|inconsistency/u,
        },
    ])('RED: $label is command nonzero', ({ overrides, reason }) => {
        expect(() => evaluateConverterCoverageTerminal(summary(overrides))).toThrow(reason);
    });
});

describe('inner converter child-path terminal probes', () => {
    it('GREEN child-path: C0 and C1 both 100% reaches evaluateConverterCoverageTerminal and exits 0', async () => {
        let summarizeCalls = 0;
        await probeCoverageCommandPath({
            summarizeCoverage: map => {
                summarizeCalls += 1;
                expect(map).toBeDefined();
                return wellFormed({ statementsCovered: 10, statementsTotal: 10, branchesCovered: 4, branchesTotal: 4 });
            },
        });
        expect(summarizeCalls).toBe(1);
    });

    it.each([
        { name: '0', counts: { statementsCovered: 0, statementsTotal: 10, branchesCovered: 0, branchesTotal: 5 } },
        { name: '1', counts: { statementsCovered: 1, statementsTotal: 100, branchesCovered: 1, branchesTotal: 100 } },
        {
            name: '<100',
            counts: { statementsCovered: 50, statementsTotal: 100, branchesCovered: 99, branchesTotal: 100 },
        },
    ])(
        'RED child-path: well-formed percent $name makes the coverage path nonzero (below-full-coverage)',
        async ({ counts }) => {
            await expect(
                probeCoverageCommandPath({ summarizeCoverage: () => wellFormed(counts) }),
            ).rejects.toBeInstanceOf(BelowFullCoverageError);
        },
    );

    it('RED child-path: a below-100% run still removes the raw and capture directories it owns', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await mkdtemp(join(tmpdir(), 'leaf5-below-')).then(
            async raw => [raw, await mkdtemp(join(tmpdir(), 'leaf5-below-capture-'))] as const,
        );
        tempDirs.push(rawCoverageDirectory, transformCaptureDirectory);
        await expect(
            runAgainstCompiledSnapshot({
                compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
                filters: [],
                rawCoverageDirectory,
                transformCaptureDirectory,
                worktreeContent: CLEAN_WORKTREE_CONTENT,
                dependencies: {
                    mode: 'coverage',
                    processEnv: { ...process.env, EPGSTATION_COVERAGE_KEEP_RAW: undefined },
                    mkdir: async () => undefined,
                    enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                    run: async () => undefined,
                    writeCanonicalCoverageArtifacts: async () => ({
                        coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } },
                    }),
                    summarizeCoverage: () =>
                        wellFormed({ statementsCovered: 1, statementsTotal: 2, branchesCovered: 1, branchesTotal: 1 }),
                },
            }),
        ).rejects.toBeInstanceOf(BelowFullCoverageError);
        await expect(access(rawCoverageDirectory)).rejects.toThrow();
        await expect(access(transformCaptureDirectory)).rejects.toThrow();
    });

    it('RED child-path: zero-population summary after vitest makes coverage path nonzero', async () => {
        await expect(
            probeCoverageCommandPath({
                summarizeCoverage: () =>
                    summary({
                        statementsCovered: 0,
                        statementsTotal: 0,
                        statementsPercent: 0,
                        branchesCovered: 1,
                        branchesTotal: 1,
                        branchesPercent: 100,
                    }),
            }),
        ).rejects.toThrow(/zero-population/u);
    });

    it('RED child-path: malformed/incoherent summary makes coverage path nonzero', async () => {
        await expect(
            probeCoverageCommandPath({
                summarizeCoverage: () =>
                    summary({
                        statementsCovered: 5,
                        statementsTotal: 4,
                        statementsPercent: 125,
                        branchesCovered: 1,
                        branchesTotal: 1,
                        branchesPercent: 100,
                    }),
            }),
        ).rejects.toThrow(/malformed|incoherent|covered/u);
    });

    it('RED child-path: percent mismatch makes coverage path nonzero', async () => {
        await expect(
            probeCoverageCommandPath({
                summarizeCoverage: () =>
                    summary({
                        statementsCovered: 1,
                        statementsTotal: 2,
                        statementsPercent: 100,
                        branchesCovered: 1,
                        branchesTotal: 1,
                        branchesPercent: 100,
                    }),
            }),
        ).rejects.toThrow(/percent|inconsistency/u);
    });

    it('RED child-path: tree/input mismatch from writeCanonical propagates nonzero', async () => {
        await expect(
            probeCoverageCommandPath({
                writeCanonicalCoverageArtifacts: async () => {
                    throw new Error('tree/input mismatch reported by the converter');
                },
            }),
        ).rejects.toThrow(/tree\/input mismatch/u);
    });

    it.each([
        ['uncommitted changes', UNCOMMITTED_WORKTREE_CONTENT],
        ['an unavailable git (every field null)', UNRECORDED_WORKTREE_CONTENT],
    ])(
        'RED child-path: a coverage run with %s still runs, and the converter receives the record as is',
        async (_label, worktreeContent) => {
            const received: unknown[] = [];
            let summarizeCalls = 0;
            await probeCoverageCommandPath({
                worktreeContent,
                writeCanonicalCoverageArtifacts: async (args: unknown) => {
                    received.push((args as { worktreeContent?: unknown }).worktreeContent);
                    return { coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } } };
                },
                summarizeCoverage: () => {
                    summarizeCalls += 1;
                    return wellFormed({
                        statementsCovered: 1,
                        statementsTotal: 1,
                        branchesCovered: 1,
                        branchesTotal: 1,
                    });
                },
            });
            expect(received).toEqual([worktreeContent]);
            expect(summarizeCalls).toBe(1);
        },
    );

    it('RED child-path: the verdict is the converter summary alone -- below 100% fails whatever the worktree record says', async () => {
        for (const worktreeContent of [
            CLEAN_WORKTREE_CONTENT,
            UNCOMMITTED_WORKTREE_CONTENT,
            UNRECORDED_WORKTREE_CONTENT,
        ]) {
            await expect(
                probeCoverageCommandPath({
                    worktreeContent,
                    summarizeCoverage: () =>
                        wellFormed({ statementsCovered: 1, statementsTotal: 2, branchesCovered: 1, branchesTotal: 1 }),
                }),
            ).rejects.toBeInstanceOf(BelowFullCoverageError);
        }
    });

    it('RED child-path: actual vitest/test failure propagates nonzero before terminal evaluate', async () => {
        let summarizeCalls = 0;
        await expect(
            probeCoverageCommandPath({
                run: async () => {
                    const error = new Error('Vitest failed with exit code 1');
                    (error as { code?: number }).code = 1;
                    throw error;
                },
                summarizeCoverage: () => {
                    summarizeCalls += 1;
                    return wellFormed({
                        statementsCovered: 1,
                        statementsTotal: 1,
                        branchesCovered: 1,
                        branchesTotal: 1,
                    });
                },
            }),
        ).rejects.toThrow(/Vitest failed|exit code 1/u);
        expect(summarizeCalls).toBe(0);
    });
});

/**
 * Disk-leak fix: `test/server/.artifacts/coverage-raw/v8-*` (this run's own mkdtemp'd raw V8 dump
 * directory) and `test/server/.artifacts/coverage-transform-capture/capture-*` must not survive a
 * coverage invocation on success, nor a real Vitest/converter failure
 * whatever the raw dump holds. These probes drive `runAgainstCompiledSnapshot` with real,
 * pre-created temporary directories standing in for those two mkdtemp'd roots and assert they are
 * gone afterward -- on success, on a failing vitest child, and on a failing converter -- unless
 * `EPGSTATION_COVERAGE_KEEP_RAW=1` asks to keep them.
 */
describe('coverage-raw / coverage-transform-capture disk-leak fix', () => {
    async function pathExists(path: string): Promise<boolean> {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    // Returned as a tuple (not `{ rawCoverageDirectory, transformCaptureDirectory }`): the fixture
    // safety scan resolves array elements by tracing each identifier back to its own declaration,
    // but a shorthand object property whose name ends in `Directory` is treated as a storage-path
    // key on the property name alone, independent of whether the value resolves. A tuple keeps
    // these mkdtemp-produced paths inspectable without weakening that scanner rule.
    async function makeDirectories(): Promise<[rawCoverageDirectory: string, transformCaptureDirectory: string]> {
        const rawCoverageDirectory = await mkdtemp(join(tmpdir(), 'leaf5-coverage-terminal-raw-'));
        const transformCaptureDirectory = await mkdtemp(join(tmpdir(), 'leaf5-coverage-terminal-capture-'));
        tempDirs.push(rawCoverageDirectory, transformCaptureDirectory);
        return [rawCoverageDirectory, transformCaptureDirectory];
    }

    async function probeWithBothDirectories(options: {
        run?: (...args: unknown[]) => Promise<unknown>;
        writeCanonicalCoverageArtifacts?: (args: unknown) => Promise<{ coverageMap: unknown }>;
        processEnvOverrides?: Record<string, string | undefined>;
    }): Promise<[rawCoverageDirectory: string, transformCaptureDirectory: string]> {
        const [rawCoverageDirectory, transformCaptureDirectory] = await makeDirectories();
        await runAgainstCompiledSnapshot({
            compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
            filters: [],
            rawCoverageDirectory,
            transformCaptureDirectory,
            worktreeContent: CLEAN_WORKTREE_CONTENT,
            dependencies: {
                mode: 'coverage',
                // Isolate from any inherited keep-raw env, exactly like probeCoverageCommandPath.
                processEnv: {
                    ...process.env,
                    EPGSTATION_COVERAGE_KEEP_RAW: undefined,
                    ...options.processEnvOverrides,
                },
                mkdir: async () => undefined,
                enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                run: options.run ?? (async () => undefined),
                writeCanonicalCoverageArtifacts:
                    options.writeCanonicalCoverageArtifacts ??
                    (async () => ({ coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } } })),
                summarizeCoverage: () =>
                    wellFormed({
                        statementsCovered: 1,
                        statementsTotal: 1,
                        branchesCovered: 1,
                        branchesTotal: 1,
                    }),
            },
        });
        return [rawCoverageDirectory, transformCaptureDirectory];
    }

    it('GREEN: removes both the raw V8 dump directory and the transform-capture directory after a successful coverage run', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await probeWithBothDirectories({});
        expect(await pathExists(rawCoverageDirectory)).toBe(false);
        expect(await pathExists(transformCaptureDirectory)).toBe(false);
    });

    it('RED: removes both directories even when the underlying vitest child fails', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await makeDirectories();
        await expect(
            runAgainstCompiledSnapshot({
                compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
                filters: [],
                rawCoverageDirectory,
                transformCaptureDirectory,
                worktreeContent: CLEAN_WORKTREE_CONTENT,
                dependencies: {
                    mode: 'coverage',
                    processEnv: {
                        ...process.env,
                        EPGSTATION_COVERAGE_KEEP_RAW: undefined,
                    },
                    mkdir: async () => undefined,
                    enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                    run: async () => {
                        const error = new Error('Vitest failed with exit code 1');
                        (error as { code?: number }).code = 1;
                        throw error;
                    },
                },
            }),
        ).rejects.toThrow(/Vitest failed/u);
        expect(await pathExists(rawCoverageDirectory)).toBe(false);
        expect(await pathExists(transformCaptureDirectory)).toBe(false);
    });

    it('RED: removes both directories even when writeCanonical (the converter) throws after a real coverage run', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await makeDirectories();
        await expect(
            runAgainstCompiledSnapshot({
                compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
                filters: [],
                rawCoverageDirectory,
                transformCaptureDirectory,
                worktreeContent: CLEAN_WORKTREE_CONTENT,
                dependencies: {
                    mode: 'coverage',
                    processEnv: {
                        ...process.env,
                        EPGSTATION_COVERAGE_KEEP_RAW: undefined,
                    },
                    mkdir: async () => undefined,
                    enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                    run: async () => undefined,
                    writeCanonicalCoverageArtifacts: async () => {
                        throw new Error('tree/input mismatch reported by the converter');
                    },
                },
            }),
        ).rejects.toThrow(/tree\/input mismatch/u);
        expect(await pathExists(rawCoverageDirectory)).toBe(false);
        expect(await pathExists(transformCaptureDirectory)).toBe(false);
    });

    it('EPGSTATION_COVERAGE_KEEP_RAW=1 keeps both directories after a successful coverage run', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await probeWithBothDirectories({
            processEnvOverrides: { EPGSTATION_COVERAGE_KEEP_RAW: '1' },
        });
        expect(await pathExists(rawCoverageDirectory)).toBe(true);
        expect(await pathExists(transformCaptureDirectory)).toBe(true);
    });

    it('EPGSTATION_COVERAGE_KEEP_RAW=1 keeps both directories after a failing coverage run', async () => {
        const [rawCoverageDirectory, transformCaptureDirectory] = await makeDirectories();
        await expect(
            runAgainstCompiledSnapshot({
                compiledSnapshot: join(rawCoverageDirectory, 'snapshot'),
                filters: [],
                rawCoverageDirectory,
                transformCaptureDirectory,
                worktreeContent: CLEAN_WORKTREE_CONTENT,
                dependencies: {
                    mode: 'coverage',
                    processEnv: {
                        ...process.env,
                        EPGSTATION_COVERAGE_KEEP_RAW: '1',
                    },
                    mkdir: async () => undefined,
                    enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                    run: async () => {
                        throw new Error('Vitest failed with exit code 1');
                    },
                },
            }),
        ).rejects.toThrow(/Vitest failed/u);
        expect(await pathExists(rawCoverageDirectory)).toBe(true);
        expect(await pathExists(transformCaptureDirectory)).toBe(true);
    });
});

/**
 * `npm run test:server:coverage` (the plain command this file's own module doc describes)
 * never calls `runAgainstCompiledSnapshot` on its own: `run-tests.mjs`'s `isDirectRun` entry point
 * always calls it as the `action` of a `withCompiledSnapshot(...)` call, and that composition is what
 * a real invocation -- one coverage run over the unit tests (spec and imp) -- actually exercises. Every probe above calls `runAgainstCompiledSnapshot` directly,
 * which is exactly why this file's own suite never caught the regression where `withCompiledSnapshot`
 * (`compiled-snapshot.mjs#assertRawCoverageDirectoryObservable`) required `rawCoverageDirectory` to
 * still exist immediately after `action` returns, while `runAgainstCompiledSnapshot`'s own disk-leak-fix
 * `finally` (this same file, above) had already removed that same directory before returning --
 * deterministically, on every non-`EPGSTATION_COVERAGE_KEEP_RAW=1` run, not as a race. These
 * probes wire the two together exactly as `isDirectRun` does, `rawCoverageDirectoryReclaimedByThisRun`
 * included, and assert the raw directory is present while the converter runs and absent, with no error
 * surfaced through `withCompiledSnapshot`, once the whole composed call returns.
 */
describe('withCompiledSnapshot + runAgainstCompiledSnapshot composition (raw-dir handoff regression)', () => {
    async function pathExists(path: string): Promise<boolean> {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    // Returned as a tuple (not an object with shorthand `rawCoverageDirectory`/
    // `transformCaptureDirectory` properties): the fixture safety scan's `isStoragePathKey` treats a
    // shorthand property ending in "directory" as a storage-path key on the name alone, and these two
    // values come from `mkdtemp(...)` -- not a literal the scanner can resolve -- so it would fail
    // closed as `uninspectable`, exactly as it would for this same file's
    // `makeDirectories`/`probeWithBothDirectories` helpers above.
    async function probeComposedRun(processEnvOverrides: Record<string, string | undefined>): Promise<{
        result: unknown;
        directories: [rawCoverageDirectory: string, transformCaptureDirectory: string];
        rawDirectoryExistedDuringConversion: boolean | undefined;
    }> {
        const rawCoverageDirectory = await mkdtemp(join(tmpdir(), 'leaf5-coverage-composed-raw-'));
        const transformCaptureDirectory = await mkdtemp(join(tmpdir(), 'leaf5-coverage-composed-capture-'));
        const source = await mkdtemp(join(tmpdir(), 'leaf5-coverage-composed-source-'));
        tempDirs.push(rawCoverageDirectory, transformCaptureDirectory, source);
        const processEnv = {
            ...process.env,
            EPGSTATION_COVERAGE_KEEP_RAW: undefined,
            ...processEnvOverrides,
        };
        let rawDirectoryExistedDuringConversion: boolean | undefined;

        const result = await withCompiledSnapshot(
            compiledSnapshot =>
                runAgainstCompiledSnapshot({
                    compiledSnapshot,
                    filters: [],
                    rawCoverageDirectory,
                    transformCaptureDirectory,
                    worktreeContent: CLEAN_WORKTREE_CONTENT,
                    dependencies: {
                        mode: 'coverage',
                        processEnv,
                        mkdir: async () => undefined,
                        enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                        run: async () => undefined,
                        writeCanonicalCoverageArtifacts: async () => {
                            // The converter's own read happens here, still inside `action` -- prove the
                            // directory this whole probe is about is observable at exactly this point.
                            rawDirectoryExistedDuringConversion = await pathExists(rawCoverageDirectory);
                            return { coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } } };
                        },
                        summarizeCoverage: () =>
                            wellFormed({
                                statementsCovered: 1,
                                statementsTotal: 1,
                                branchesCovered: 1,
                                branchesTotal: 1,
                            }),
                    },
                }),
            {
                source,
                rawCoverageDirectory,
                rawCoverageDirectoryConsumedInsideAction: rawCoverageDirectoryReclaimedByThisRun(processEnv),
            },
        );

        return {
            result,
            directories: [rawCoverageDirectory, transformCaptureDirectory],
            rawDirectoryExistedDuringConversion,
        };
    }

    it('non-KEEP_RAW: raw dir is observable while the converter reads it and gone afterward, with no error from withCompiledSnapshot', async () => {
        const { directories, rawDirectoryExistedDuringConversion } = await probeComposedRun({});
        const [rawCoverageDirectory, transformCaptureDirectory] = directories;
        expect(rawDirectoryExistedDuringConversion).toBe(true);
        expect(await pathExists(rawCoverageDirectory)).toBe(false);
        expect(await pathExists(transformCaptureDirectory)).toBe(false);
    });

    it('EPGSTATION_COVERAGE_KEEP_RAW=1: raw dir stays observable through withCompiledSnapshot after a successful run', async () => {
        const { directories, rawDirectoryExistedDuringConversion } = await probeComposedRun({
            EPGSTATION_COVERAGE_KEEP_RAW: '1',
        });
        const [rawCoverageDirectory] = directories;
        expect(rawDirectoryExistedDuringConversion).toBe(true);
        expect(await pathExists(rawCoverageDirectory)).toBe(true);
    });
});

describe('inner/public converter one-shot terminal', () => {
    const packageJsonUrl = new URL('../../../../package.json', import.meta.url);
    const runTestsUrl = new URL('../../../../scripts/server-test/run-tests.mjs', import.meta.url);
    const vitestConfigUrl = new URL('../../../../vitest.server.config.ts', import.meta.url);

    it('public inner argv is npm run test:server:coverage [-- <files>]', async () => {
        const pkg = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
            scripts?: Record<string, string>;
        };
        expect(pkg.scripts?.['test:server:coverage']).toBe('node scripts/server-test/run-tests.mjs coverage');
        const runTests = await readFile(runTestsUrl, 'utf8');
        expect(runTests).toMatch(/parseRunArguments\(process\.argv\.slice\(3\), \{/u);
        expect(runTests).toMatch(/const filters = locatorArguments\.map\(normalizeFilter\);/u);
    });

    it('a below-100% error ends the command with the below-100% exit status and is consumed', () => {
        const processLike: { exitCode?: number } = {};
        const logged: string[] = [];
        const error = new BelowFullCoverageError('coverage terminal below-full-coverage: example');
        expect(() =>
            exitStatusForCoverageError(error, processLike, (message: string) => logged.push(message)),
        ).not.toThrow();
        expect(processLike.exitCode).toBe(BELOW_FULL_COVERAGE_EXIT_CODE);
        expect(logged).toEqual(['coverage terminal below-full-coverage: example']);
    });

    it('any other error ends the command with status 1 and is rethrown', () => {
        const processLike: { exitCode?: number } = {};
        const logged: string[] = [];
        const error = new Error('Vitest failed with exit code 1');
        expect(() => exitStatusForCoverageError(error, processLike, (message: string) => logged.push(message))).toThrow(
            error,
        );
        expect(processLike.exitCode).toBe(1);
        expect(logged).toEqual([]);
    });

    it('the vitest provider threshold stays skipped under the converter', async () => {
        const vitestConfig = await readFile(vitestConfigUrl, 'utf8');
        expect(vitestConfig).toMatch(
            /process\.env\.EPGSTATION_COVERAGE_CONVERTER === '1'[\s\S]{0,120}\?\s*\{\}\s*:\s*\{\s*thresholds:/u,
        );
    });

    it('ordinary non-coverage spec still keeps the 100/100 Vitest threshold behind the converter skip', async () => {
        const vitestConfig = await readFile(vitestConfigUrl, 'utf8');
        expect(vitestConfig).toMatch(
            /\?\s*\{\}\s*:\s*\{\s*thresholds:\s*\{\s*statements:\s*100,\s*branches:\s*100\s*\}\s*\}/u,
        );
    });

    // `@vitest/coverage-v8` (enabled by `--coverage.enabled true`) runs its own independent
    // `node:inspector` session against the SAME per-isolate V8 Profiler state `NODE_V8_COVERAGE`'s own raw
    // dumps read via `v8.takeCoverage()` -- confirmed by direct reproduction that
    // `Profiler.takePreciseCoverage` resets execution counters shared across sessions, silently
    // undercounting this run's own raw dumps. `@vitest/coverage-v8`'s own output was never this mode's
    // source of truth anyway (the converter overwrites `coverage-final.json` right after it runs), so it
    // must stay disabled here.
    it("GREEN child-path: inner coverage argv disables Vitest's own coverage-v8 provider and does not pass a 100 threshold", async () => {
        let captured: unknown[] | undefined;
        await probeCoverageCommandPath({
            run: async (_command, args) => {
                captured = args as unknown[];
            },
        });
        expect(captured).toEqual(
            expect.arrayContaining(['--coverage.enabled', 'false', '--config', 'vitest.server.config.ts']),
        );
        expect(captured?.join(' ')).not.toMatch(/thresholds/u);
    });
});

/**
 * The coverage population is the unit tests (spec and imp) only, run in one Vitest invocation. The
 * integration tests are never enumerated, never passed to Vitest, and never part of the roster the
 * canonical coverage binding records.
 */
describe('coverage command: unit tests (spec and imp) in one invocation', () => {
    it('filter-free coverage enumerates only the spec and imp projects and runs one Vitest invocation over exactly those files', async () => {
        const invocations: string[][] = [];
        const listedProjects: string[] = [];
        const listEnvironments: NodeJS.ProcessEnv[] = [];
        let roster: unknown;
        await probeCoverageCommandPath({
            enumerateLayerFiles: async (project, environment) => {
                listedProjects.push(project);
                listEnvironments.push(environment);
                if (project === 'integration') {
                    return ['persistence/queries.integration.test.ts'];
                }
                return project === 'spec'
                    ? ['persistence/implementation.test.ts']
                    : ['persistence/repositories.imp.test.ts'];
            },
            run: async (_command, args) => {
                invocations.push(args as string[]);
            },
            writeCanonicalCoverageArtifacts: async args => {
                roster = (args as { testRoster: unknown }).testRoster;
                return { coverageMap: { 'src/x.ts': { s: { '0': 1 }, b: {} } } };
            },
        });

        expect(listedProjects).toEqual(['spec', 'imp']);
        for (const environment of listEnvironments) {
            expect(environment.NODE_V8_COVERAGE).toBeUndefined();
        }
        expect(invocations).toHaveLength(1);
        const [invocation] = invocations;
        expect(invocation).toEqual(
            expect.arrayContaining([
                '--coverage.enabled',
                'false',
                'persistence/implementation.test.ts',
                'persistence/repositories.imp.test.ts',
            ]),
        );
        expect(invocation).not.toContain('persistence/queries.integration.test.ts');
        expect(invocation.filter(argument => argument === '--project')).toHaveLength(2);
        const projectNames = invocation.flatMap((argument, index) =>
            argument === '--project' ? [invocation[index + 1]] : [],
        );
        expect(projectNames).toEqual(['spec', 'imp']);
        expect(invocation).not.toContain('--no-file-parallelism');
        expect(Number(invocation[invocation.indexOf('--maxWorkers') + 1])).toBeLessThanOrEqual(8);
        expect(roster).toEqual([
            'test/server/persistence/implementation.test.ts',
            'test/server/persistence/repositories.imp.test.ts',
        ]);
    });

    it('filter-free coverage with no spec or imp test enumerated is nonzero and never runs Vitest', async () => {
        let runs = 0;
        await expect(
            probeCoverageCommandPath({
                enumerateLayerFiles: async () => [],
                run: async () => {
                    runs += 1;
                },
            }),
        ).rejects.toThrow(/No unit tests \(spec, imp\) enumerated for coverage/u);
        expect(runs).toBe(0);
    });

    it('filtered coverage accepts spec and imp locators and passes exactly those to the one Vitest invocation', async () => {
        const invocations: string[][] = [];
        await probeCoverageCommandPath({
            filters: ['persistence/implementation.test.ts', 'persistence/repositories.imp.test.ts'],
            run: async (_command, args) => {
                invocations.push(args as string[]);
            },
        });
        expect(invocations).toHaveLength(1);
        expect(invocations[0]).toEqual(
            expect.arrayContaining(['persistence/implementation.test.ts', 'persistence/repositories.imp.test.ts']),
        );
    });

    it('filtered coverage rejects an integration locator and never runs Vitest', async () => {
        let runs = 0;
        await expect(
            probeCoverageCommandPath({
                filters: ['persistence/queries.integration.test.ts'],
                run: async () => {
                    runs += 1;
                },
            }),
        ).rejects.toThrow(/coverage measures unit tests \(spec, imp\) only/u);
        expect(runs).toBe(0);
    });

    it('a real-process file in the unit population is nonzero and never runs Vitest', async () => {
        let runs = 0;
        const [realProcessFile] = SERIALIZED_REAL_PROCESS_FILES;
        await expect(
            probeCoverageCommandPath({
                enumerateLayerFiles: async project => (project === 'spec' ? [realProcessFile] : []),
                run: async () => {
                    runs += 1;
                },
            }),
        ).rejects.toThrow(/coverage unit tests include real-process files/u);
        expect(runs).toBe(0);
    });
});

/**
 * node-matrix's Node 26 leg (`run-node-acceptance-matrix.mjs`'s `nodeMatrixCommandEnv`) sets
 * `EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1` on its `npm run test:server` command only -- that
 * file's real Docker image build and start already runs in Node 24's integration command (which never
 * sets this) and standalone in the `docker-gate-node24` preflight step. This drives the whole-layer
 * (`all`) dispatch directly (the plain `npm run test:server` path, `mode: 'all'`), not through the
 * coverage branch.
 */
describe('whole-layer (`all`) dispatch: EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK', () => {
    async function probeWholeLayerCommandPath(options: {
        run?: (...args: unknown[]) => Promise<unknown>;
        skipDockerImageCheck?: boolean;
    }): Promise<void> {
        await runAgainstCompiledSnapshot({
            compiledSnapshot: 'unused-snapshot',
            filters: [],
            dependencies: {
                mode: 'all',
                processEnv: {
                    ...process.env,
                    EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK: options.skipDockerImageCheck ? '1' : undefined,
                },
                enumerateLayerFiles: async (project: string) =>
                    project === 'integration'
                        ? ['persistence/queries.integration.test.ts', ...SERIALIZED_REAL_PROCESS_FILES]
                        : project === 'spec'
                          ? ['persistence/implementation.test.ts']
                          : ['persistence/repositories.imp.test.ts'],
                run: options.run ?? (async () => undefined),
            },
        });
    }

    const dockerImageFile = 'application-runtime/docker-image.integration.test.ts';

    it('the serialized real-process files are exactly the Docker image check', () => {
        expect(SERIALIZED_REAL_PROCESS_FILES).toEqual([dockerImageFile]);
    });

    it('GREEN: unset (default) runs docker-image.integration.test.ts alone after the parallel batches, never inside one', async () => {
        const invocations: string[][] = [];
        await probeWholeLayerCommandPath({
            run: async (_command, args) => {
                invocations.push(args as string[]);
            },
        });
        const withDockerImage = invocations.filter(invocation => invocation.includes(dockerImageFile));
        expect(withDockerImage).toHaveLength(1);
        expect(withDockerImage[0]).toContain('--no-file-parallelism');
        expect(withDockerImage[0]).toEqual(expect.arrayContaining(['--maxWorkers', '1']));
        expect(withDockerImage[0]).not.toContain('--project');
        expect(invocations[invocations.length - 1]).toBe(withDockerImage[0]);
    });

    it('GREEN: EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1 drops docker-image.integration.test.ts from every invocation', async () => {
        const invocations: string[][] = [];
        await probeWholeLayerCommandPath({
            skipDockerImageCheck: true,
            run: async (_command, args) => {
                invocations.push(args as string[]);
            },
        });
        expect(invocations.length).toBeGreaterThan(0);
        for (const invocation of invocations) {
            expect(invocation).not.toContain(dockerImageFile);
        }
    });
});

/**
 * Node.js acceptance matrix: the Node 24 cell is "unit coverage once + integration once" (two commands
 * after install and build), the Node 26 cell is the whole server suite once. A failure of either Node 24
 * command fails the cell, and no test runs twice.
 */
describe('node acceptance matrix commands', () => {
    const coverageGateCommand = 'node scripts/server-test/run-coverage-gate-cli.mjs';
    const integrationCommand = 'npm run test:server:integration';
    const candidateDigest = 'c'.repeat(40);

    it('Node 24 runs install, build, the unit coverage gate once, then the integration tests once', () => {
        expect(commandsForMajor(24)).toEqual([
            'npm ci',
            'npm run build-server',
            coverageGateCommand,
            integrationCommand,
        ]);
    });

    it('Node 26 runs install, build, then the whole server suite once', () => {
        expect(commandsForMajor(26)).toEqual(['npm ci', 'npm run build-server', 'npm run test:server']);
    });

    it('no command appears twice in a cell and Node 24 never runs the whole-suite command', () => {
        for (const major of [24, 26]) {
            const commands = commandsForMajor(major);
            expect(new Set(commands).size).toBe(commands.length);
        }
        expect(commandsForMajor(24)).not.toContain('npm run test:server');
        expect(commandsForMajor(24)).not.toContain('npm run test:server:coverage');
    });

    it('both Node 24 test commands and the Node 26 test command share the worker cap; install and build keep the base env', () => {
        const base = { EPGSTATION_TEST_MAX_WORKERS: '16', KEEP: 'yes' };
        for (const command of [coverageGateCommand, integrationCommand]) {
            const environment = nodeMatrixCommandEnv(24, command, base);
            expect(environment.EPGSTATION_TEST_MAX_WORKERS).toBe('8');
            expect(environment.KEEP).toBe('yes');
            expect(environment.EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK).toBeUndefined();
        }
        expect(
            nodeMatrixCommandEnv(24, integrationCommand, { EPGSTATION_TEST_MAX_WORKERS: '2' })
                .EPGSTATION_TEST_MAX_WORKERS,
        ).toBe('2');
        const node26 = nodeMatrixCommandEnv(26, 'npm run test:server', base);
        expect(node26.EPGSTATION_TEST_MAX_WORKERS).toBe('8');
        expect(node26.EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK).toBe('1');
        for (const command of ['npm ci', 'npm run build-server']) {
            expect(nodeMatrixCommandEnv(24, command, base)).toBe(base);
            expect(nodeMatrixCommandEnv(26, command, base)).toBe(base);
        }
    });

    async function runMatrix(failing: ReadonlySet<string>) {
        const executed: Array<[number, string]> = [];
        let published:
            | {
                  cells: Record<
                      number,
                      { status: string; commandTerminals: Array<{ command: string; status: string }> }
                  >;
              }
            | undefined;
        const outcome = await runNodeAcceptanceMatrix({
            candidateDigest,
            nodeVersionForMajor: (major: number) => `${major}.0.0`,
            createWorkspace: (major: number) => `workspace-${major}`,
            runCommand: (major: number, command: string) => {
                executed.push([major, command]);
                return { exitCode: failing.has(`${major}:${command}`) ? 1 : 0 };
            },
            cleanupWorkspace: () => undefined,
            writeArtifact: (payload: unknown) => {
                published = payload as typeof published;
            },
        }).then(
            () => 'success',
            () => 'failure',
        );
        return { executed, outcome, published };
    }

    it('all commands succeeding runs each command once per cell and succeeds', async () => {
        const { executed, outcome, published } = await runMatrix(new Set());
        expect(outcome).toBe('success');
        expect(executed).toEqual([
            ...commandsForMajor(24).map(command => [24, command]),
            ...commandsForMajor(26).map(command => [26, command]),
        ]);
        expect(published?.cells[24].status).toBe('success');
        expect(published?.cells[26].status).toBe('success');
    });

    it('a failing Node 24 coverage gate fails the cell, publishes it, and does not run the integration command', async () => {
        const { executed, outcome, published } = await runMatrix(new Set([`24:${coverageGateCommand}`]));
        expect(outcome).toBe('failure');
        expect(executed).not.toContainEqual([24, integrationCommand]);
        expect(published?.cells[24].status).toBe('failure');
        expect(published?.cells[24].commandTerminals.find(entry => entry.command === integrationCommand)?.status).toBe(
            'NOT RUN',
        );
        expect(published?.cells[26].status).toBe('success');
    });

    it('a failing Node 24 integration command fails the cell even though the coverage gate passed', async () => {
        const { outcome, published } = await runMatrix(new Set([`24:${integrationCommand}`]));
        expect(outcome).toBe('failure');
        expect(published?.cells[24].status).toBe('failure');
        expect(published?.cells[24].commandTerminals.find(entry => entry.command === coverageGateCommand)?.status).toBe(
            'success',
        );
        expect(published?.cells[24].commandTerminals.find(entry => entry.command === integrationCommand)?.status).toBe(
            'failure',
        );
    });

    it('a failing Node 26 whole-suite command fails the matrix', async () => {
        const { outcome, published } = await runMatrix(new Set(['26:npm run test:server']));
        expect(outcome).toBe('failure');
        expect(published?.cells[24].status).toBe('success');
        expect(published?.cells[26].status).toBe('failure');
    });
});

/**
 * `runNodeAcceptanceMatrixCli` decides what to verify from the worktree's content (or `--candidate`) and
 * records it. Neither uncommitted changes nor a tree that differs from HEAD's fails the run.
 */
describe('node acceptance matrix CLI: the candidate comes from the worktree content', () => {
    const headTree = 'a'.repeat(40);
    const contentTree = 'b'.repeat(40);
    const argumentTree = 'd'.repeat(40);

    /** Git as it looks with (or without) uncommitted changes; HEAD's tree is `headTree`. */
    const gitReporting = (status: string) => async (arguments_: readonly string[]) => {
        if (arguments_[0] === 'status') {
            return status;
        }
        if (arguments_[0] === 'rev-parse') {
            return headTree;
        }
        return '';
    };

    async function runCli(options: {
        candidateDigest?: string;
        worktreeContent: Record<string, unknown>;
        failing?: ReadonlySet<string>;
        gitStatus?: string;
    }) {
        const executed: Array<[number, string]> = [];
        const materialized: string[] = [];
        const artifacts: Array<Record<string, unknown>> = [];
        const outcome = await runNodeAcceptanceMatrixCli({
            candidateDigest: options.candidateDigest,
            repositoryRoot: 'synthetic-repository',
            git: gitReporting(options.gitStatus ?? ' M src/example.ts'),
            snapshotWorktree: async () => options.worktreeContent,
            createAdapters: (input: { candidateDigest: string }) => {
                materialized.push(input.candidateDigest);
                return {
                    nodeVersionForMajor: (major: number) => `${major}.0.0`,
                    createWorkspace: (major: number) => `workspace-${major}`,
                    runCommand: (major: number, command: string) => {
                        executed.push([major, command]);
                        return { exitCode: options.failing?.has(`${major}:${command}`) ? 1 : 0 };
                    },
                    cleanupWorkspace: () => undefined,
                };
            },
            writeEvidenceArtifact: async (_root: string, _name: string, payload: Record<string, unknown>) => {
                artifacts.push(payload);
            },
        }).then(
            () => ({ ok: true as const }),
            (error: { reason?: string }) => ({ ok: false as const, reason: error.reason }),
        );
        return { executed, materialized, artifacts, outcome };
    }

    const uncommitted = { contentTree, headTree, uncommittedChanges: true };

    it('RED: uncommitted changes and a content tree that differs from HEAD run the matrix on the content tree and record it', async () => {
        const { executed, materialized, artifacts, outcome } = await runCli({ worktreeContent: uncommitted });
        expect(outcome).toEqual({ ok: true });
        expect(materialized).toEqual([contentTree]);
        expect(executed.length).toBeGreaterThan(0);
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].candidate).toEqual({
            tree: contentTree,
            source: 'worktree',
            headTree,
            uncommittedChanges: true,
        });
        expect(artifacts[0].candidateDigest).toBe(contentTree);
    });

    it('RED: a clean worktree is recorded as the worktree source with no uncommitted changes', async () => {
        const { artifacts, outcome } = await runCli({
            gitStatus: '',
            worktreeContent: { contentTree: headTree, headTree, uncommittedChanges: false },
        });
        expect(outcome).toEqual({ ok: true });
        expect(artifacts[0].candidate).toEqual({
            tree: headTree,
            source: 'worktree',
            headTree,
            uncommittedChanges: false,
        });
    });

    it('RED: --candidate uses that tree as given, without comparing it with HEAD, and records the argument source', async () => {
        const { materialized, artifacts, outcome } = await runCli({
            candidateDigest: argumentTree,
            worktreeContent: uncommitted,
        });
        expect(outcome).toEqual({ ok: true });
        expect(materialized).toEqual([argumentTree]);
        expect(artifacts[0].candidate).toEqual({
            tree: argumentTree,
            source: 'argument',
            headTree,
            uncommittedChanges: true,
        });
        expect(artifacts[0].candidateDigest).toBe(argumentTree);
    });

    it('RED: --candidate equal to HEAD tree records no difference from HEAD', async () => {
        const { artifacts } = await runCli({ candidateDigest: headTree, worktreeContent: uncommitted });
        expect(artifacts[0].candidate).toEqual({
            tree: headTree,
            source: 'argument',
            headTree,
            uncommittedChanges: false,
        });
    });

    it('RED: --candidate naming a tree other than HEAD is not an error when git reports a clean worktree', async () => {
        const { materialized, artifacts, outcome } = await runCli({
            candidateDigest: argumentTree,
            gitStatus: '',
            worktreeContent: { contentTree: headTree, headTree, uncommittedChanges: false },
        });
        expect(outcome).toEqual({ ok: true });
        expect(materialized).toEqual([argumentTree]);
        expect(artifacts[0].candidate).toEqual({
            tree: argumentTree,
            source: 'argument',
            headTree,
            uncommittedChanges: true,
        });
    });

    it('RED: a failing cell still publishes the candidate it verified', async () => {
        const { artifacts, outcome } = await runCli({
            worktreeContent: uncommitted,
            failing: new Set(['26:npm run test:server']),
        });
        expect(outcome).toMatchObject({ ok: false, reason: 'cells-failed' });
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].candidate).toEqual({
            tree: contentTree,
            source: 'worktree',
            headTree,
            uncommittedChanges: true,
        });
    });

    it.each([
        ['git is unavailable (every field null)', { contentTree: null, headTree: null, uncommittedChanges: null }],
        ['the content tree could not be computed', { contentTree: null, headTree, uncommittedChanges: null }],
    ])('RED: %s -> materialize-failed, nothing runs and no artifact is written', async (_label, worktreeContent) => {
        const { executed, materialized, artifacts, outcome } = await runCli({ worktreeContent });
        expect(outcome).toEqual({ ok: false, reason: 'materialize-failed' });
        expect(executed).toEqual([]);
        expect(materialized).toEqual([]);
        expect(artifacts).toEqual([]);
    });
});

describe('node acceptance matrix CLI arguments', () => {
    it('RED: --candidate is optional', () => {
        expect(parseNodeAcceptanceMatrixArguments(['node', 'run-node-acceptance-matrix.mjs'])).toEqual({
            candidateDigest: undefined,
        });
    });

    it('--candidate <tree> is passed through', () => {
        expect(
            parseNodeAcceptanceMatrixArguments([
                'node',
                'run-node-acceptance-matrix.mjs',
                '--candidate',
                'e'.repeat(40),
            ]),
        ).toEqual({ candidateDigest: 'e'.repeat(40) });
    });

    it.each([
        [['--candidate']],
        [['--candidate', '--candidate']],
        [['--candidate', 'x', '--candidate', 'y']],
        [['--unknown', 'x']],
        [['--candidate', '']],
    ])('rejects %j', extra => {
        expect(() => parseNodeAcceptanceMatrixArguments(['node', 'run-node-acceptance-matrix.mjs', ...extra])).toThrow(
            /rejected/u,
        );
    });
});

describe('node acceptance artifact write', () => {
    it('writes the payload atomically under test/server/.artifacts/evidence and leaves no temporary file', async () => {
        const repositoryRoot = await mkdtemp(join(tmpdir(), 'node-matrix-artifact-'));
        tempDirs.push(repositoryRoot);
        await writeNodeAcceptanceArtifact(repositoryRoot, 'node-acceptance-matrix.json', { ok: true });
        const evidence = join(repositoryRoot, 'test', 'server', '.artifacts', 'evidence');
        expect(await readdir(evidence)).toEqual(['node-acceptance-matrix.json']);
        expect(JSON.parse(await readFile(join(evidence, 'node-acceptance-matrix.json'), 'utf8'))).toEqual({ ok: true });
    });

    it('a failed write removes its temporary file and propagates the error', async () => {
        const repositoryRoot = await mkdtemp(join(tmpdir(), 'node-matrix-artifact-'));
        tempDirs.push(repositoryRoot);
        const evidence = join(repositoryRoot, 'test', 'server', '.artifacts', 'evidence');
        // A non-empty directory at the target path makes the final rename fail.
        await mkdir(join(evidence, 'node-acceptance-matrix.json', 'blocker'), { recursive: true });
        await expect(
            writeNodeAcceptanceArtifact(repositoryRoot, 'node-acceptance-matrix.json', { ok: true }),
        ).rejects.toThrow();
        expect(await readdir(evidence)).toEqual(['node-acceptance-matrix.json']);
    });
});
