import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { computeWrapperPrefixLength } from '../../harness/coverage-transform-capture.ts';
import {
    CompiledSnapshotCoverageError,
    coverageIdentityTreeDigest,
    COVERAGE_EXCLUDED_RECORDS_FILE_NAME,
    discoverCompiledSnapshotCoverage,
    ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV,
    ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV,
    ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV,
    loadIsolatedRuntimeIdentityEntries,
    readRawCoverageRecords,
    registerIsolatedRuntimeIdentitiesFromEnv,
    registerIsolatedRuntimeScriptIdentities,
    summarizeCoverage,
    toCoverageFinalMap,
    verifyTotalSourcePopulation,
    writeCanonicalCoverageArtifacts,
    writeIsolatedRuntimeIdentityEntry,
} from '../../../../scripts/server-test/compiled-snapshot-coverage.mjs';
import * as compiledSnapshotCoverage from '../../../../scripts/server-test/compiled-snapshot-coverage.mjs';

function sha256Hex(bytesOrString: string | Uint8Array): string {
    return createHash('sha256').update(bytesOrString).digest('hex');
}

/**
 * Compiled snapshot raw V8 converter:
 * `discoverCompiledSnapshotCoverage` discovers, per compiled-snapshot script, its raw V8 coverage
 * record, its `src/**\/*.ts` source, and converts its V8 ranges through that source map into
 * Istanbul-compatible `{ start, end, count }` entries. Fixtures only -- no real build, test server
 * run, V8 collection, or full coverage command. Source maps are built by this file's own independent
 * base64-VLQ encoder (`encodeVlq`/`buildMappings`), never by importing the implementation's decoder or
 * a real `tsc` build, so the RED/GREEN cycle exercises the implementation's own Source Map V3 reader
 * against a hand-specified `{ generated position -> source position }` table.
 *
 * TDD RED-fixture shapes (one per fail-closed rule):
 *  (i)   a snapshot script with no matching raw V8 record -> `missing-raw-record`
 *  (ii)  a snapshot script with no readable source map -> `missing-source-map`
 *  (iii) a source map that resolves outside `src/**\/*.ts` -> `source-map-outside-src`
 *  (iv)  the same dist-relative script path resolving to different sources across snapshot roots,
 *        the same source claimed by two different script paths, and a map with more than one
 *        `sources` entry -> `duplicate-inconsistent-mapping`
 *  (v)   a V8 range whose generated position has no mapping segment at or before it ->
 *        `no-representable-source-location`
 * plus a positive multiple-snapshot discovery case proving snapshot-external raw records never
 * become coverage entries, a nonzero-hit range correctly remapped to a distinct source location, and
 * a zero-hit range counted in the total population but not covered.
 */

function errorOf(fn: () => unknown): InstanceType<typeof CompiledSnapshotCoverageError> | undefined {
    try {
        fn();
        return undefined;
    } catch (error) {
        return error as InstanceType<typeof CompiledSnapshotCoverageError>;
    }
}

function reasonOf(fn: () => unknown): string | undefined {
    try {
        fn();
        return undefined;
    } catch (error) {
        return (error as InstanceType<typeof CompiledSnapshotCoverageError>).reason;
    }
}

// Discovery of a real product source against its compiled output takes about a second or less without coverage
// instrumentation, but under instrumentation the slowest of these tests takes roughly 6 to 7 s, above the 5 s
// default. A test that does it carries this explicit budget, kept well above that worst case so a slower machine
// does not turn it into a timeout.
const REAL_SOURCE_DISCOVERY_TIMEOUT_MS = 60_000;

const scratchRoot = join(tmpdir(), 'epgstation-compiled-snapshot-coverage-tests');
const scratchDirs: string[] = [];

afterEach(() => {
    while (scratchDirs.length > 0) {
        const dir = scratchDirs.pop();
        if (dir !== undefined) {
            rmSync(dir, { force: true, recursive: true });
        }
    }
});

function makeScratchDir(prefix: string): string {
    mkdirSync(scratchRoot, { recursive: true });
    const dir = mkdtempSync(join(scratchRoot, `${prefix}-`));
    scratchDirs.push(dir);
    return dir;
}

function writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
}

function writeJson(path: string, value: unknown): void {
    writeFile(path, JSON.stringify(value));
}

/** The `sources[]` entry a real `tsc` build would emit for `absoluteSourcePath`, relative to `scriptPath`'s own directory (no `sourceRoot`). */
function sourceEntryFor(scriptPath: string, absoluteSourcePath: string): string {
    return relative(dirname(scriptPath), absoluteSourcePath).split(sep).join('/');
}

/** A `sourceRoot` value pointing from `fromDir` to `absoluteDir`. */
function relativeDirFor(fromDir: string, absoluteDir: string): string {
    return relative(fromDir, absoluteDir).split(sep).join('/');
}

const BASE64_VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encodes one signed integer as a Source Map V3 base64-VLQ string. Independent of (never calls) the implementation's `decodeVlqSegment`. */
function encodeVlq(value: number): string {
    let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
    let result = '';
    do {
        let digit = vlq & 0x1f;
        vlq >>>= 5;
        if (vlq > 0) {
            digit |= 0x20;
        }
        result += BASE64_VLQ_CHARS[digit];
    } while (vlq > 0);
    return result;
}

interface MappingPoint {
    genColumn: number;
    genLine: number;
    srcColumn: number;
    srcLine: number;
}

/** Builds a Source Map V3 `mappings` string from explicit `{ genLine, genColumn, srcLine, srcColumn }` points (any order; a single `sources` entry is assumed, matching this repository's real per-file `tsc` output). */
function buildMappings(points: MappingPoint[]): string {
    const byLine = new Map<number, MappingPoint[]>();
    let maxLine = 0;
    for (const point of points) {
        maxLine = Math.max(maxLine, point.genLine);
        const list = byLine.get(point.genLine) ?? [];
        list.push(point);
        byLine.set(point.genLine, list);
    }
    let prevSrcLine = 0;
    let prevSrcColumn = 0;
    const lines: string[] = [];
    for (let line = 0; line <= maxLine; line += 1) {
        const segmentsForLine = [...(byLine.get(line) ?? [])].sort((a, b) => a.genColumn - b.genColumn);
        let prevGenColumn = 0;
        const segments = segmentsForLine.map(point => {
            const segment =
                encodeVlq(point.genColumn - prevGenColumn) +
                encodeVlq(0) +
                encodeVlq(point.srcLine - prevSrcLine) +
                encodeVlq(point.srcColumn - prevSrcColumn);
            prevGenColumn = point.genColumn;
            prevSrcLine = point.srcLine;
            prevSrcColumn = point.srcColumn;
            return segment;
        });
        lines.push(segments.join(','));
    }
    return lines.join(';');
}

const DEFAULT_MAPPINGS = buildMappings([{ genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 }]);

/** The byte offset `lineIndex` (0-based) starts at within `text`, mirroring the implementation's own `computeLineStartOffsets`. */
function lineStartOffset(text: string, lineIndex: number): number {
    return text
        .split('\n')
        .slice(0, lineIndex)
        .reduce((total, line) => total + line.length + 1, 0);
}

/** Writes a compiled-snapshot `.js` file plus its `.js.map`, wired to `sources` (already resolved relative to the map file, i.e. relative to `scriptPath`'s directory, unless a non-empty `sourceRoot` is given -- then relative to `sourceRoot`, itself resolved relative to the map file's directory, matching the Source Map V3 spec). Defaults to no `sourceRoot`, a trivial one-point mapping, and a two-line body. */
function writeCompiledScript(
    scriptPath: string,
    {
        sources = ['unset.ts'],
        sourceRoot = '',
        mappings = DEFAULT_MAPPINGS,
        body = '"use strict";\nexports.x = 1;\n',
    }: { sources?: string[]; sourceRoot?: string; mappings?: string; body?: string } = {},
): void {
    const mapFileName = `${scriptPath.split('/').pop()}.map`;
    writeFile(scriptPath, `${body}//# sourceMappingURL=${mapFileName}\n`);
    writeJson(`${scriptPath}.map`, { version: 3, file: mapFileName, sourceRoot, sources, names: [], mappings });
}

const RAW_FUNCTIONS = Object.freeze([
    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: 40, startOffset: 0 }] },
]);

function writeRawCoverage(
    rawCoverageDir: string,
    fileName: string,
    records: Array<{ url: string; functions?: unknown }>,
): void {
    writeJson(join(rawCoverageDir, fileName), {
        result: records.map((record, index) => ({
            scriptId: String(index + 1),
            url: record.url,
            functions: record.functions ?? RAW_FUNCTIONS,
        })),
    });
}

describe('discoverCompiledSnapshotCoverage: positive multiple-snapshot discovery', () => {
    it('discovers scripts across multiple snapshot roots, ignores snapshot-external raw records, and converts V8 ranges via the source map', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const rootB = join(artifactRoot, 'compiled-dist-b/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const barScript = join(rootB, 'model/Bar.js');

        // Foo: two statements on two generated lines, each mapped to a distinct (non-origin) source
        // position -- proves a real remap, not a degenerate always-(0,0) passthrough. One range gets
        // a nonzero hit count (covered), the other a zero hit count (total-only, not covered).
        const fooBody = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
        const fooLine1 = lineStartOffset(fooBody, 1);
        const fooLine2 = lineStartOffset(fooBody, 2);
        writeCompiledScript(fooScript, {
            body: fooBody,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
                { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
            ]),
            sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))],
        });
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 3, endOffset: fooLine2, startOffset: fooLine1 },
                            { count: 0, endOffset: fooBody.length, startOffset: fooLine2 },
                        ],
                    },
                ],
                url: pathToFileURL(fooScript).href,
            },
            // Snapshot-external: not under rootA/rootB at all (e.g. Vitest's own runtime).
            { url: pathToFileURL(join(artifactRoot, 'node_modules/vitest/dist/index.js')).href },
            // Snapshot-external: a non-file:// url (Node internal module).
            { url: 'node:internal/modules/cjs/loader' },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [{ url: pathToFileURL(barScript).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA, rootB],
        });

        expect(result.records).toHaveLength(2);
        expect(result.records.map(record => record.sourcePath)).toEqual(['src/model/Foo.ts', 'src/model/Bar.ts']);

        const [fooRecord, barRecord] = result.records;
        expect(fooRecord).toMatchObject({
            relativeScriptPath: 'model/Foo.js',
            snapshotRoot: rootA,
            sourcePath: 'src/model/Foo.ts',
        });
        expect(fooRecord.entries).toHaveLength(2);
        expect(fooRecord.entries[0]).toEqual({
            count: 3,
            end: { column: 8, line: 7 },
            endOffset: fooLine2,
            start: { column: 8, line: 5 },
            startOffset: fooLine1,
        });
        expect(fooRecord.entries[1]).toEqual({
            count: 0,
            end: { column: 8, line: 7 },
            endOffset: fooBody.length,
            start: { column: 8, line: 7 },
            startOffset: fooLine2,
        });
        expect(fooRecord.entries.filter(entry => entry.count > 0)).toHaveLength(1);

        expect(barRecord).toMatchObject({
            functions: RAW_FUNCTIONS,
            relativeScriptPath: 'model/Bar.js',
            snapshotRoot: rootB,
            sourcePath: 'src/model/Bar.ts',
        });
        expect(barRecord.entries).toHaveLength(1);
        expect(barRecord.entries[0].count).toBe(1);
    });

    it('honors a non-empty source map sourceRoot when resolving the source path', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // sourceRoot points from the map file's directory back to repoRoot/src; `sources` is then
        // just the file's own name, relative to sourceRoot -- the Source Map V3 two-part form real
        // bundlers (not this repository's tsc, which never sets sourceRoot) commonly emit.
        writeCompiledScript(scriptPath, {
            sourceRoot: relativeDirFor(dirname(scriptPath), join(repoRoot, 'src/model')),
            sources: ['Foo.ts'],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].sourcePath).toBe('src/model/Foo.ts');
    });

    it('decodes multiple mapping segments on the same generated line via correct per-segment column deltas', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Two statements packed onto one generated line (`exports.a=1;exports.b=2;`), each with its
        // own mapping segment on that same line -- exercises the VLQ genColumn *delta* (not absolute)
        // encoding across sequential same-line segments, a path the other fixtures (one point per
        // line) never reach. The first segment is deliberately placed at a NON-zero column (5, not 0):
        // with a first segment at column 0, its successor's delta and absolute column values coincide
        // numerically, so a decoder that mistakenly treats genColumn as absolute rather than
        // delta-from-previous would still produce identical entries -- undetected. The
        // second segment's correctly-decoded column (13) is load-bearing for both entries: it is the basis span boundary between them (entry 1 ends there, entry 2 starts
        // there), and entry 2's own mapped `start` also resolves through it -- a mutant that decodes the
        // delta wrong misplaces both.
        const body = 'exports.a=1;exports.b=2;\n';
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 5, genLine: 0, srcColumn: 0, srcLine: 2 },
                { genColumn: 13, genLine: 0, srcColumn: 13, srcLine: 2 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 5, endOffset: 10, startOffset: 5 },
                            { count: 2, endOffset: body.length, startOffset: 13 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toEqual([
            {
                count: 5,
                end: { column: 13, line: 3 },
                endOffset: 13,
                start: { column: 0, line: 3 },
                startOffset: 5,
            },
            {
                count: 2,
                end: { column: 13, line: 3 },
                endOffset: body.length,
                start: { column: 13, line: 3 },
                startOffset: 13,
            },
        ]);
    });
});

/**
 * Memory-bounded raw-record filtering: `readRawCoverageRecords` takes the exact, closed set of resolved paths a record can ever
 * be consulted for (`relevantPaths`, built by `discoverCompiledSnapshotCoverage` from
 * `walkCompiledScripts` under `snapshotRoots` plus any identity registry's `isolatedScriptPath`
 * entries) and discards every other record's `url` the moment it resolves, instead of retaining it.
 *
 * Both fixtures below share a large "noise" batch of out-of-scope raw records -- `node_modules`,
 * TypeScript, and an unrelated child process's own script -- including some with shapes that would
 * fail `incompatible-raw-merge`/`malformed-raw-dump` validation if they were ever validated (a
 * non-array `functions`, a duplicate range coordinate). None of this noise is under any snapshot root,
 * so per the module's own fail-closed rules a script not under any snapshot root is never a rejection
 * at all (silently excluded) -- proving the noise is discarded, not merely deferred, requires observing
 * `readRawCoverageRecords`'s own filtered output directly, not just that discovery still succeeds.
 */
describe('discoverCompiledSnapshotCoverage: memory-bounded raw-record filtering', () => {
    function buildNoiseRecords(artifactRoot: string, count: number): Array<{ url: string; functions?: unknown }> {
        const noise: Array<{ url: string; functions?: unknown }> = [];
        for (let index = 0; index < count; index += 1) {
            noise.push({ url: pathToFileURL(join(artifactRoot, `node_modules/some-pkg/dist/file-${index}.js`)).href });
        }
        // Shapes that would fail `incompatible-raw-merge` validation if ever validated -- proving these
        // out-of-scope records are discarded before validation, never merely deferred.
        noise.push({ functions: 'not-an-array', url: pathToFileURL(join(artifactRoot, 'node_modules/typescript/lib/typescript.js')).href });
        noise.push({
            functions: [
                {
                    functionName: '',
                    isBlockCoverage: true,
                    ranges: [
                        { count: 1, endOffset: 10, startOffset: 0 },
                        { count: 2, endOffset: 10, startOffset: 0 }, // duplicate (startOffset, endOffset)
                    ],
                },
            ],
            url: pathToFileURL(join(artifactRoot, 'child-process/unrelated-script.js')).href,
        });
        noise.push({ url: 'node:internal/modules/cjs/loader' });
        return noise;
    }

    it('readRawCoverageRecords retains only records whose url resolves into relevantPaths, discarding a large out-of-scope batch (including malformed shapes) without validating it', () => {
        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        writeCompiledScript(fooScript);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            { url: pathToFileURL(fooScript).href },
            ...buildNoiseRecords(artifactRoot, 500),
        ]);

        const relevantPaths = new Set([resolve(fooScript)]);
        const retained = readRawCoverageRecords(rawCoverageDir, relevantPaths);

        expect(retained).toHaveLength(1);
        expect(retained[0].resolvedPath).toBe(resolve(fooScript));
        expect(retained[0].sourceFile).toBe('coverage-1.json');
        expect(retained.every(item => relevantPaths.has(item.resolvedPath))).toBe(true);
    });

    it('discoverCompiledSnapshotCoverage produces identical records whether or not the raw dump also carries a large out-of-scope noise batch', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(fooScript, { sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))] });
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const cleanRawCoverageDir = makeScratchDir('raw-clean');
        writeRawCoverage(cleanRawCoverageDir, 'coverage-1.json', [
            { url: pathToFileURL(fooScript).href },
            { url: pathToFileURL(barScript).href },
        ]);

        const noisyRawCoverageDir = makeScratchDir('raw-noisy');
        writeRawCoverage(noisyRawCoverageDir, 'coverage-1.json', [
            { url: pathToFileURL(fooScript).href },
            { url: pathToFileURL(barScript).href },
            ...buildNoiseRecords(artifactRoot, 500),
        ]);

        const baseline = discoverCompiledSnapshotCoverage({
            rawCoverageDir: cleanRawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const noisy = discoverCompiledSnapshotCoverage({
            rawCoverageDir: noisyRawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(noisy.records).toEqual(baseline.records);
    });
});

/**
 * `readRawCoverageRecords` fails closed on a malformed raw V8 dump whether or not evidence is captured
 * (same reason, same message shape) -- these fixtures only prove the ADDITIONAL diagnostic
 * side effect: sibling dump metadata (name/pid/size/mtime) plus the rejected file's own head/tail
 * bytes are written to `EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR`, which is exactly the persistence
 * seam the node-matrix runner's own ephemeral per-run workspace (deleted once the run
 * finishes) needs so this evidence survives past that workspace's own cleanup.
 */
interface MalformedRawDumpEvidence {
    headBytes: string;
    rejectedFile: { name: string; parseError: string; path: string; pid: string | null; sizeBytes: number };
    siblingsInSameRawCoverageDir: Array<{
        mtimeMs: number;
        name: string;
        pid: string | null;
        samePid: boolean;
        sizeBytes: number;
    }>;
    tailBytes: string;
}

describe('readRawCoverageRecords: malformed-raw-dump evidence capture', () => {
    it('records sibling dump metadata and head/tail bytes without changing the fail-closed rejection', () => {
        const rawCoverageDir = makeScratchDir('raw-malformed');
        const evidenceDir = makeScratchDir('evidence');
        const pid = 424242;
        const goodFileName = `coverage-${pid}-1790000000000-0.json`;
        const badFileName = `coverage-${pid}-1790000000001-1.json`;
        const otherPidFileName = `coverage-999999-1790000000002-0.json`;

        writeRawCoverage(rawCoverageDir, goodFileName, [
            { url: pathToFileURL(join(rawCoverageDir, 'unused.js')).href },
        ]);
        writeRawCoverage(rawCoverageDir, otherPidFileName, [
            { url: pathToFileURL(join(rawCoverageDir, 'unused-2.js')).href },
        ]);
        // Truncated mid-object, matching the real "Unexpected end of JSON input" shape a v8 raw dump
        // cut off mid-write produces.
        const truncatedUrl = pathToFileURL(join(rawCoverageDir, 'truncated.js')).href;
        const truncatedBody =
            `{"result":[{"url":"${truncatedUrl}","functions":[{"functionName":"","isBlockCoverage":true,"ranges":[{"startOffset":0,"endOffset":10,"count`;
        writeFileSync(join(rawCoverageDir, badFileName), truncatedBody, 'utf8');

        const previousEvidenceDir = process.env.EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR;
        process.env.EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR = evidenceDir;
        let reason: string | undefined;
        try {
            reason = reasonOf(() => readRawCoverageRecords(rawCoverageDir, new Set()));
        } finally {
            if (previousEvidenceDir === undefined) {
                delete process.env.EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR;
            } else {
                process.env.EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR = previousEvidenceDir;
            }
        }

        // Same fail-closed rejection as without evidence capture.
        expect(reason).toBe('malformed-raw-dump');

        const capturedDirs = readdirSync(evidenceDir);
        expect(capturedDirs).toHaveLength(1);
        const evidenceFiles = readdirSync(join(evidenceDir, capturedDirs[0]));
        expect(evidenceFiles).toEqual([`${badFileName}.evidence.json`]);
        const evidence = JSON.parse(
            readFileSync(join(evidenceDir, capturedDirs[0], evidenceFiles[0]), 'utf8'),
        ) as MalformedRawDumpEvidence;

        expect(evidence.rejectedFile.name).toBe(badFileName);
        expect(evidence.rejectedFile.pid).toBe(String(pid));
        expect(evidence.rejectedFile.sizeBytes).toBe(truncatedBody.length);
        // Node's own JSON.parse error text for a truncated document varies by V8 version and by
        // exactly where the cut lands (e.g. "Unexpected end of JSON input" vs. "Unterminated
        // string in JSON") -- this fixture only proves the real parse error's own message is
        // captured verbatim, not any specific wording.
        expect(evidence.rejectedFile.parseError.length).toBeGreaterThan(0);
        expect(evidence.headBytes).toBe(truncatedBody);
        expect(evidence.tailBytes).toBe(truncatedBody);

        const siblingNames = evidence.siblingsInSameRawCoverageDir.map(sibling => sibling.name).sort();
        expect(siblingNames).toEqual([badFileName, goodFileName, otherPidFileName].sort());
        const samePidSibling = evidence.siblingsInSameRawCoverageDir.find(sibling => sibling.name === goodFileName);
        expect(samePidSibling?.samePid).toBe(true);
        const otherPidSibling = evidence.siblingsInSameRawCoverageDir.find(sibling => sibling.name === otherPidFileName);
        expect(otherPidSibling?.samePid).toBe(false);
    });
});

describe('discoverCompiledSnapshotCoverage: fail-closed rejections', () => {
    it('RED (missing-raw-record): a snapshot script with no matching raw V8 record is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', []);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-raw-record');
    });

    it('RED (branch-basis-parse-error): compiled JS with a syntax error fails closed instead of degrading to an empty branch basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // `function f( {` has no matching close paren -- a syntax diagnostic on `ts.createSourceFile`'s
        // internal `parseDiagnostics`, not merely unexecuted code. If `parseCompiledSourceForBranchBasis`'s
        // `?? []` fallback silently swallowed an absent/empty diagnostics array instead of failing closed,
        // this would return successfully with `branchEntries: []` and `reasonOf` below would see no thrown
        // error at all, not just the wrong reason.
        writeCompiledScript(scriptPath, {
            body: 'function f( {\n',
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('branch-basis-parse-error');
    });

    it('RED (missing-source-map): a snapshot script with no sourceMappingURL comment is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeFile(scriptPath, '"use strict";\nexports.x = 1;\n');

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-source-map');
    });

    it('RED (source-map-outside-src): a source map resolving outside src/**/*.ts is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'vendor/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'vendor/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('source-map-outside-src');
    });

    it('RED (duplicate-inconsistent-mapping): the same dist-relative script path maps to different sources across snapshot roots', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Other.ts'), 'export const other = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const rootB = join(artifactRoot, 'compiled-dist-b/dist');
        const scriptA = join(rootA, 'model/Foo.js');
        const scriptB = join(rootB, 'model/Foo.js');
        writeCompiledScript(scriptA, { sources: [sourceEntryFor(scriptA, join(repoRoot, 'src/model/Foo.ts'))] });
        writeCompiledScript(scriptB, { sources: [sourceEntryFor(scriptB, join(repoRoot, 'src/model/Other.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            { url: pathToFileURL(scriptA).href },
            { url: pathToFileURL(scriptB).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [rootA, rootB],
                }),
            ),
        ).toBe('duplicate-inconsistent-mapping');
    });

    it('RED (duplicate-inconsistent-mapping): the same source is claimed by two different script paths', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const aliasScriptPath = join(rootA, 'model/FooAlias.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });
        writeCompiledScript(aliasScriptPath, {
            sources: [sourceEntryFor(aliasScriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            { url: pathToFileURL(scriptPath).href },
            { url: pathToFileURL(aliasScriptPath).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('duplicate-inconsistent-mapping');
    });

    it('RED (duplicate-inconsistent-mapping): a source map with more than one source entry is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [
                sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts')),
                sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Bar.ts')),
            ],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('duplicate-inconsistent-mapping');
    });

    it('rejects an empty/missing snapshotRoots input', () => {
        const rawCoverageDir = makeScratchDir('raw');
        expect(reasonOf(() => discoverCompiledSnapshotCoverage({ rawCoverageDir, snapshotRoots: [] }))).toBe(
            'schema-mismatch',
        );
    });
});

/**
 * A real
 * `tsc` build percent-encodes non-ASCII-safe characters (e.g. `{`/`}` from a dynamic-route source file
 * name) in the `//# sourceMappingURL=` comment, per the Source Map V3 / RFC 3986 convention, while the
 * `.map` file itself keeps its literal, unencoded name on disk. `readSourceMap` must decode that token
 * before resolving it, without weakening any existing fail-closed rule.
 */
describe('discoverCompiledSnapshotCoverage: percent-encoded sourceMappingURL resolution', () => {
    it('resolves a percent-encoded sourceMappingURL token to its literal-character .map sibling', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const mapPath = join(rootA, 'model/{dropLogFileId}.js.map');
        writeFile(scriptPath, '"use strict";\nexports.x = 1;\n//# sourceMappingURL=%7BdropLogFileId%7D.js.map\n');
        writeJson(mapPath, {
            file: '{dropLogFileId}.js.map',
            mappings: DEFAULT_MAPPINGS,
            names: [],
            sourceRoot: '',
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
            version: 3,
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].sourcePath).toBe('src/model/Foo.ts');
    });

    it('resolves an un-encoded (literal) sourceMappingURL token exactly as before', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].sourcePath).toBe('src/model/Foo.ts');
    });

    it('RED (missing-source-map): a malformed percent-escape in sourceMappingURL fails closed instead of throwing', () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeFile(scriptPath, '"use strict";\nexports.x = 1;\n//# sourceMappingURL=%.js.map\n');

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-source-map');
    });

    it('RED (source-map-outside-src): a percent-encoded traversal token cannot bypass the outside-source check', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'vendor/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const mapPath = join(repoRoot, 'vendor/Foo.js.map');
        writeJson(mapPath, {
            file: 'Foo.js.map',
            mappings: DEFAULT_MAPPINGS,
            names: [],
            sourceRoot: '',
            sources: [sourceEntryFor(mapPath, join(repoRoot, 'vendor/Foo.ts'))],
            version: 3,
        });
        const encodedRelative = relative(dirname(scriptPath), mapPath)
            .split(sep)
            .join('/')
            .split('/')
            .map(segment => (segment === '..' ? '%2e%2e' : segment))
            .join('/');
        writeFile(scriptPath, `"use strict";\nexports.x = 1;\n//# sourceMappingURL=${encodedRelative}\n`);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('source-map-outside-src');
    });

    it('RED (missing-source-map): a data: URI sourceMappingURL is still rejected unchanged', () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeFile(
            scriptPath,
            '"use strict";\nexports.x = 1;\n//# sourceMappingURL=data:application/json;base64,e30=\n',
        );

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-source-map');
    });
});

/**
 * Statement-endpoint preflight: every real `tsc`
 * build emits an unmapped generated preamble (`"use strict";` + helper boilerplate) on a compiled file's
 * leading line(s), while V8 always records a whole-script top-level range starting at offset 0. Endpoint
 * resolution lets a range whose start precedes the first mapping segment fall back to that first segment
 * when the range's own end still has a mapping, while a range with no mapping segment anywhere in the
 * file is unaffected and still fails closed.
 */
describe('discoverCompiledSnapshotCoverage: statement endpoint resolution for an unmapped generated preamble', () => {
    it('GREEN: a whole-script V8 range starting before the first mapping segment becomes representable when its end has a mapping', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Mirrors the real per-file tsc shape confirmed against a real build: generated
        // lines 0-2 are unmapped preamble; the first mapping segment only appears on the line carrying
        // the actual statement (line 3). V8's whole-script range starts at offset 0 (line 0), before
        // that first segment.
        const body =
            '"use strict";\n' +
            'Object.defineProperty(exports, "__esModule", { value: true });\n' +
            'exports.foo = void 0;\n' +
            'exports.foo = 1;\n';
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([{ genColumn: 0, genLine: 3, srcColumn: 8, srcLine: 4 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        // The statement basis span itself starts at the mapping point (not
        // the raw range's own start offset 0), so the straddling raw range's start-snap only matters for
        // this range staying representable at all (validated below, not fail-closed) -- the mapped `start`
        // it resolves to is the same mapping point the span's own boundary already uses.
        const mappedStart = lineStartOffset(body, 3);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toEqual([
            {
                count: 1,
                end: { column: 8, line: 5 },
                endOffset: body.length,
                start: { column: 8, line: 5 },
                startOffset: mappedStart,
            },
        ]);
    });

    it('RED (no-representable-source-location): a range still has no representable source location when the file has no mapping segment anywhere', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nexports.foo = 1;\n';
        // No mapping segments at all -- the endpoint-resolution fallback (snap start to the first
        // mapped point) has nothing to snap to, so the range must still fail closed rather than
        // silently pass through as an arbitrary (0,0)-like location.
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('no-representable-source-location');
    });
});

/**
 * Generated-helper omission:
 * a real `tsc` build can emit more than one unmapped generated-helper region in a single compiled file
 * (e.g. the `__createBinding`/`__importDefault` CommonJS interop helpers), and V8's block-coverage
 * instrumentation can produce a range wholly inside one of those regions (a divergence sub-range of the
 * helper's own conditional fallback arm) with no `src/**\/*.ts` identity at all -- neither its start nor
 * its end (by the existing monotone `lookupSourcePosition`'s own proof: `startOffset <= endOffset` and
 * `endSource === null` implies `startSource === null`) resolves to any mapping segment. Unlike the
 * statement-endpoint-preflight straddling case above (a range whose START precedes the first
 * mapping segment but whose END still resolves), this range's END also precedes the first segment, so
 * the start-snap fallback does not apply and it has no representable source location at all -- yet it
 * is not the same failure as an empty/absent source map either: the script DOES have real source
 * attribution (`mappingPoints.length > 0`), just not for this one generated-only sub-range.
 *
 * `convertRange` therefore omits (skips, does not fail closed) a range iff `mappingPoints.length > 0`
 * and its end has no representable source position -- silently dropping it from `entries` and, when it
 * would also have been a branch-outcome candidate, from `branchEntries`, while any other range in the
 * same script that DOES resolve is unaffected. The `mappingPoints.length === 0` guard is the one thing
 * that must never be relaxed here (module doc / `discoverCompiledSnapshotCoverage: statement endpoint
 * resolution for an unmapped generated preamble` suite's own "RED (no-representable-source-location):
 * ... when the file has no mapping segment anywhere" case, unchanged below): with an empty decoded map
 * every range in the script would satisfy "before the first point" and the whole script's coverage
 * would silently vanish instead of failing closed.
 *
 * A fixture whose only mapping point is nonempty (`mappingPoints.length === 1`) is structurally
 * identical to the omission condition proved above -- under the approved rule it cannot throw
 * `no-representable-source-location`, so the first test below pins that fixture shape against the
 * omitted (not rejected) outcome.
 */
describe('discoverCompiledSnapshotCoverage: generated-helper omission', () => {
    it('GREEN: a script whose only V8 range is entirely before its only mapping point is discovered with that range omitted, not rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // The only mapping segment is on generated line 5; the script's only V8 range spans offsets
        // [0, 40), which (given the short default body) resolves to a position well before line 5.
        // `mappingPoints.length > 0`, so this is the generated-helper-omission case, not the empty-map
        // fail-closed case -- the record is still discovered, just with an empty `entries`.
        writeCompiledScript(scriptPath, {
            mappings: buildMappings([{ genColumn: 0, genLine: 5, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].sourcePath).toBe('src/model/Foo.ts');
        expect(result.records[0].entries).toEqual([]);
    });

    it('GREEN: a pre-first-mapping-point range is omitted from entries while a later, mapped range in the same script is kept', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Generated lines 0-1 are unmapped preamble (mirrors a tsc CommonJS interop helper); line 2
        // carries the sole mapping segment, for the real statement below it.
        const body = '"use strict";\nexports.__createBinding = 1;\nexports.foo = 1;\n';
        const preambleStart = lineStartOffset(body, 1);
        const mappedStart = lineStartOffset(body, 2);
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([{ genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 4 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            // Entirely within the unmapped preamble (line 1) -- ends one byte before the
                            // mapping point's own generated position (`mappedStart`), so it does not
                            // alias onto that point via the "at or before" lookup. No representable
                            // source position anywhere in this range; omitted, not a rejection.
                            { count: 1, endOffset: mappedStart - 1, startOffset: preambleStart },
                            // Starts exactly at, and ends after, the one mapping point -- resolves normally.
                            { count: 1, endOffset: body.length, startOffset: mappedStart },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toEqual([
            {
                count: 1,
                end: { column: 8, line: 5 },
                endOffset: body.length,
                start: { column: 8, line: 5 },
                startOffset: mappedStart,
            },
        ]);
    });

    it('GREEN: a branch-outcome range nested wholly inside an unmapped preamble is omitted from branchEntries, while its still-resolvable containing range is kept in entries', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Generated lines 0-3 are an unmapped helper preamble containing its own conditional fallback
        // block (line 2, the branch-outcome candidate); line 4 carries the one mapping segment, for the
        // real statement below the helper.
        const body =
            '"use strict";\n' +
            'function __createBinding(o,m,k) {\n' +
            '  if (k) { o[k] = m[k]; }\n' +
            '}\n' +
            'exports.foo = 1;\n';
        const blockStart = lineStartOffset(body, 2);
        const blockEnd = lineStartOffset(body, 3);
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([{ genColumn: 0, genLine: 4, srcColumn: 8, srcLine: 6 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            // Whole-script range: starts before the mapping point (snaps, unchanged
                            // straddling behavior) but ends after it, so it still resolves.
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            // Nested wholly inside the preamble (the helper's `if` block) -- both its
                            // start and end precede the one mapping point. It is a branch-outcome
                            // candidate (properly contained in the whole-script range above) but has no
                            // representable source location, so it is omitted from both entries and
                            // branchEntries rather than failing the whole discovery closed.
                            { count: 0, endOffset: blockEnd, startOffset: blockStart },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(1);
        expect(result.records[0].entries[0].count).toBe(1);
        expect(result.records[0].branchEntries).toEqual([]);
    });

    it('RED (no-representable-source-location, unchanged): an empty source map still fails closed instead of omitting every range', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nexports.foo = 1;\n';
        // `mappingPoints.length === 0` -- the generated-helper-omission guard must not apply here, or
        // this script's entire coverage would silently vanish instead of failing closed.
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('no-representable-source-location');
    });
});

/**
 * Type-only empty-map disposition:
 * a source file containing only `interface`/`type` declarations erases to a byte-exact, ~130-byte tsc
 * strict-mode stub (`"use strict";` + the `__esModule` marker) with a source map whose `mappings` is the
 * empty string (`mappingPoints.length === 0`) -- structurally identical, at the discovery loop, to the
 * `no-representable-source-location` empty-map fail-closed case above. The disposition narrows that case:
 * a `mappingPoints.length === 0` script is accepted with `entries: []`/`branchEntries: []` (retained as a record
 * contributing 0/0 -- vacuously complete) iff its compiled JS body, after stripping the
 * trailing `//# sourceMappingURL=` comment and surrounding whitespace, is byte-equal to the canonical
 * stub. Anything else with an empty map -- including JS that merely resembles the stub -- keeps failing
 * closed exactly as before, unaffected by this narrowing.
 */
const TYPE_ERASURE_STUB_BODY = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';

describe('discoverCompiledSnapshotCoverage: type-only source with a canonical tsc erasure stub', () => {
    it('GREEN: a canonical tsc type-erasure stub with an empty source map is retained in inventory with entries: []', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/IFoo.ts'), 'export interface IFoo { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/IFoo.js');
        writeCompiledScript(scriptPath, {
            body: TYPE_ERASURE_STUB_BODY,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/IFoo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].sourcePath).toBe('src/model/IFoo.ts');
        expect(result.records[0].entries).toEqual([]);
        expect(result.records[0].branchEntries).toEqual([]);
        expect(result.records[0].relativeScriptPath).toBe('model/IFoo.js');
    });

    it('RED (no-representable-source-location): compiled JS that is not byte-equal to the canonical stub still fails closed on an empty source map', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/IFoo.ts'), 'export interface IFoo { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/IFoo.js');
        // One extra statement beyond the canonical two-line stub -- must not be treated as "close enough".
        const body = `${TYPE_ERASURE_STUB_BODY}exports.unexpected = 1;\n`;
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/IFoo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('no-representable-source-location');
    });

    it('GREEN: aggregation over a stub-accepted 0-entry script reports 0% without NaN, and is not flagged uncovered', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/IFoo.ts'), 'export interface IFoo { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/IFoo.js');
        writeCompiledScript(scriptPath, {
            body: TYPE_ERASURE_STUB_BODY,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/IFoo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const coverageMap = toCoverageFinalMap(records);
        const summary = summarizeCoverage(coverageMap);

        expect(summary.statementsTotal).toBe(0);
        expect(summary.statementsPercent).toBe(0);
        expect(Number.isNaN(summary.statementsPercent)).toBe(false);
        expect(summary.uncoveredFiles).toEqual([]);
    });

    it('GREEN: compiled JS byte-equal to the canonical stub is vacuous even with a non-empty source map -- a stub-shaped body has no executable range for any mapping point to legitimately represent', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            body: TYPE_ERASURE_STUB_BODY,
            mappings: buildMappings([{ genColumn: 0, genLine: 0, srcColumn: 8, srcLine: 4 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: TYPE_ERASURE_STUB_BODY.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toEqual([]);
        expect(result.records[0].branchEntries).toEqual([]);
    });
});

/**
 * Type-only unexecuted stub:
 * a compiled-snapshot script whose body is byte-equal, after stripping comments (respecting string and
 * template literal boundaries), to the canonical tsc type-erasure stub has no executable V8 range to
 * ever capture -- whether or not this run's raw dump happens to contain a record for it -- and, for the
 * `Enums.ts`-shape variant that preserves a source block comment, its comment-derived mapping points
 * must never be used to fabricate a phantom covered statement. */
const ENUMS_STUB_BODY =
    '"use strict";\n/** 定数宣言 */\nObject.defineProperty(exports, "__esModule", { value: true });\n';

describe('discoverCompiledSnapshotCoverage: unexecuted and comment-bearing type-erasure stubs', () => {
    it('RED->GREEN: an unexecuted canonical stub with no raw record still produces an explicit 0/0 record', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/IFoo.ts'), 'export interface IFoo { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/IFoo.js');
        writeCompiledScript(scriptPath, {
            body: TYPE_ERASURE_STUB_BODY,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/IFoo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', []);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });


        const record = records.find(entry => entry.sourcePath === 'src/model/IFoo.ts');
        expect(record).toBeDefined();
        expect(record?.entries).toEqual([]);
        expect(record?.branchEntries).toEqual([]);
        expect(record?.rawUrl).toBeNull();
    });

    it('RED->GREEN: an unexecuted comment-bearing Enums-shape stub with no raw record still produces an explicit 0/0 record', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/Enums.ts'), '/** 定数宣言 */\nexport type DBType = "mysql" | "sqlite3";');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'Enums.js');
        writeCompiledScript(scriptPath, {
            body: ENUMS_STUB_BODY,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 3, srcColumn: 0, srcLine: 1 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/Enums.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', []);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const record = records.find(entry => entry.sourcePath === 'src/Enums.ts');
        expect(record).toBeDefined();
        expect(record?.entries).toEqual([]);
        expect(record?.branchEntries).toEqual([]);
        expect(record?.rawUrl).toBeNull();
    });

    it('RED->GREEN: an executed comment-bearing Enums-shape stub attributes no statement to the comment-mapped lines', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/Enums.ts'), '/** 定数宣言 */\nexport type DBType = "mysql" | "sqlite3";');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'Enums.js');
        writeCompiledScript(scriptPath, {
            body: ENUMS_STUB_BODY,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 3, srcColumn: 0, srcLine: 1 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/Enums.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: ENUMS_STUB_BODY.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toEqual([]);
        expect(result.records[0].branchEntries).toEqual([]);
    });

    it('GREEN-guard: a comment marker inside a string literal is not treated as a comment, so the file is not classified vacuous', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = "// not a comment";');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = `${TYPE_ERASURE_STUB_BODY}exports.foo = "// not a comment";\n`;
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('no-representable-source-location');
    });

    it('RED: a non-stub script missing its raw record fails closed instead of being excluded from records', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', []);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-raw-record');
    });
});

/**
 * Raw merge:
 * more than one raw V8 record for the same resolved script path (one dump per Vitest worker/flush) are
 * disjoint partial observations of the identical compiled JS, not competing versions -- a
 * last-wins merge would silently drop every record but the last one read. These fixtures pin the
 * additive merge: identical `(startOffset, endOffset)` ranges sum their counts, ranges present in only
 * some records union in with their own counts, `isBlockCoverage` merges via logical OR rather than ever
 * being treated as a conflict (V8 legitimately flips it `false` -> `true` at a byte-identical range key
 * the first time a function is invoked), and an unsafe duplicate group -- including a duplicate
 * `(startOffset, endOffset)` coordinate within a single record's own ranges -- fails closed as
 * `incompatible-raw-merge` naming the offending dump file(s).
 */
describe('discoverCompiledSnapshotCoverage: additive merge of raw V8 records for the same resolved script path', () => {
    it('GREEN (mirrors the measured 2+13 probe): identical (startOffset, endOffset) ranges across dump files for the same script sum their counts', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 2, endOffset: 40, startOffset: 0 }] },
                ],
                url,
            },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 13, endOffset: 40, startOffset: 0 }] },
                ],
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(1);
        expect(result.records[0].entries[0].count).toBe(15);
        // Public synthetic `functions` must retain the exact-key once with the summed count (not only
        // attribution `entries`; entries can stay GREEN if mergeRawRecords public union is deleted).
        const publicIdenticalRanges = result.records[0].functions.flatMap(fn => fn.ranges);
        expect(publicIdenticalRanges).toEqual([{ count: 15, endOffset: 40, startOffset: 0 }]);
    });

    it('GREEN: ranges present in only some dump files for the same script union in with their own counts', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
        const lineTwoOffset = lineStartOffset(body, 2);
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 2, srcColumn: 0, srcLine: 1 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 3, endOffset: lineTwoOffset, startOffset: 0 }],
                    },
                ],
                url,
            },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 5, endOffset: body.length, startOffset: lineTwoOffset }],
                    },
                ],
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(2);
        expect(result.records[0].entries.map(entry => entry.count).sort()).toEqual([3, 5]);
        // Public synthetic `functions` must keep both one-sided coordinates once each with their own counts.
        const publicOneSidedRanges = result.records[0].functions.flatMap(fn => fn.ranges);
        expect(publicOneSidedRanges).toEqual([
            { count: 3, endOffset: lineTwoOffset, startOffset: 0 },
            { count: 5, endOffset: body.length, startOffset: lineTwoOffset },
        ]);
    });

    it("GREEN (mirrors evidence 06/07's 3-dumps/2-workers shape): the same script URL present in 2 of 3 dump files merges without last-wins loss", () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        // Worker A's first flush.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 2, endOffset: 40, startOffset: 0 }] },
                ],
                url,
            },
        ]);
        // Worker B's flush -- same script URL, disjoint partial observation.
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 13, endOffset: 40, startOffset: 0 }] },
                ],
                url,
            },
        ]);
        // Worker A's second flush -- an unrelated script, never touching Foo.js.
        writeRawCoverage(rawCoverageDir, 'coverage-3.json', [{ url: 'node:internal/modules/cjs/loader' }]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(1);
        // Last-wins would have kept only the last-read record's count (13 or 2, order-dependent);
        // the additive merge always sums both to 15 regardless of dump-file read order.
        expect(result.records[0].entries[0].count).toBe(15);
        // Same public exact-key contract as the 2-dump probe: one retained range, count 15.
        const publicThreeDumpRanges = result.records[0].functions.flatMap(fn => fn.ranges);
        expect(publicThreeDumpRanges).toEqual([{ count: 15, endOffset: 40, startOffset: 0 }]);
    });

    it('GREEN (mirrors the measured V8 probe, evidence 02): isBlockCoverage flipping false -> true at an identical range key across dump files merges successfully via logical OR, not a conflict', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        // Flush 1: function not yet invoked in this flush window -- isBlockCoverage false, count 0.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: 'bar',
                        isBlockCoverage: false,
                        ranges: [{ count: 0, endOffset: 40, startOffset: 0 }],
                    },
                ],
                url,
            },
        ]);
        // Flush 2: same function, same byte-identical range key -- now invoked -- isBlockCoverage true, count 1.
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [
            {
                functions: [
                    {
                        functionName: 'bar',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: 40, startOffset: 0 }],
                    },
                ],
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(1);
        expect(result.records[0].entries[0].count).toBe(1);
        // false→true OR must remain on the public synthetic function for this exact key.
        expect(result.records[0].functions).toHaveLength(1);
        expect(result.records[0].functions[0].isBlockCoverage).toBe(true);
        expect(result.records[0].functions[0].ranges).toEqual([{ count: 1, endOffset: 40, startOffset: 0 }]);
    });

    it('RED (incompatible-raw-merge): a duplicate record with a non-array functions field is rejected at merge time, before snapshot matching', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url }]);
        // A malformed duplicate for the same URL: `functions` is present but not an array.
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [{ functions: 'not-an-array', url }]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('incompatible-raw-merge');
    });

    it('RED (incompatible-raw-merge): a duplicate (startOffset, endOffset) coordinate within a single raw record is rejected, even with only one dump file', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        // A single dump file whose record carries the same (startOffset, endOffset) coordinate twice,
        // across two distinct functions -- an intra-record duplicate, not a legitimate multi-flush union.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: 'a', isBlockCoverage: true, ranges: [{ count: 1, endOffset: 40, startOffset: 0 }] },
                    { functionName: 'b', isBlockCoverage: true, ranges: [{ count: 1, endOffset: 40, startOffset: 0 }] },
                ],
                url,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('incompatible-raw-merge');
    });
});

/**
 * A C1 (branch) population of zero must not be judged vacuously 100%: the converter derives real
 * Istanbul branches. `discoverCompiledSnapshotCoverage` builds a
 * per-record `branchEntries` array, the same `{ start, end, count }` shape as `entries`, via the same
 * `convertRange`/mapping lookup. Every fixture here uses `DEFAULT_MAPPINGS` (one mapping point covering
 * the whole generated file): the entries' exact converted location is not what these fixtures test (the
 * sibling `discoverCompiledSnapshotCoverage: positive multiple-snapshot discovery` suite already pins
 * per-range location remapping) -- only what count a raw `isBlockCoverage === true` range assigns each
 * outcome. Which outcomes *exist* at all is determined
 * by a static parse of the compiled JS (`buildBranchBasisEntries`), not by these fixtures' raw ranges -- see the
 * branch basis RED test in the "shard-independent statement/branch location basis" describe block
 * above for that contract; this suite's `body` fixtures below are written with real `if`-statements so
 * their static basis always has exactly the one outcome each test's raw-range shape was designed around.
 */
describe('discoverCompiledSnapshotCoverage: branch-outcome conversion', () => {
    it('RED: an isBlockCoverage range nested inside another (a whole-function range containing an unexecuted block range) becomes one unexecuted branchEntries outcome', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nif (x) {\n  y();\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            // ranges[0]: the whole function body -- invoked once.
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            // A block range strictly inside ranges[0] (the `if` body) that was never
                            // executed -- the exact "unexecuted branch" shape these fixtures exist to cover.
                            { count: 0, endOffset: 30, startOffset: 14 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        // This fixture's default mapping has exactly one point, so the statement
        // basis is exactly one span regardless of how many raw ranges V8 reported -- the nested block
        // range is not a second statement entry, only a branchEntries candidate.
        expect(result.records[0].entries).toHaveLength(1);
        expect(result.records[0].branchEntries).toHaveLength(1);
        expect(result.records[0].branchEntries[0].count).toBe(0);
    });

    it('GREEN: the same nested block range, now executed, becomes one covered branchEntries outcome', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nif (x) {\n  y();\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            { count: 1, endOffset: 30, startOffset: 14 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records[0].branchEntries).toHaveLength(1);
        expect(result.records[0].branchEntries[0].count).toBe(1);
    });

    it('GREEN: sibling (non-nested, adjacent) isBlockCoverage ranges are not misdetected as branch outcomes -- a file without real branch nesting stays branchEntries: []', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
        const lineTwoOffset = lineStartOffset(body, 2);
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        // Two adjacent, non-overlapping statement ranges -- neither contains the other.
                        ranges: [
                            { count: 1, endOffset: lineTwoOffset, startOffset: 0 },
                            { count: 1, endOffset: body.length, startOffset: lineTwoOffset },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        // This fixture's default mapping has exactly one point, so the statement
        // basis is exactly one span regardless of how many disjoint raw ranges V8 reported.
        expect(result.records[0].entries).toHaveLength(1);
        expect(result.records[0].branchEntries).toEqual([]);
    });

    it('GREEN: a function with isBlockCoverage false still contributes its branch outcome from the static basis, but with count 0 -- existence does not depend on isBlockCoverage, only count does', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nif (x) {\n  y();\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            // The one mapping point is placed at generated offset 14 (the start of `if (x) {`, inside the
            // nested [14, 30) range below) rather than the default offset 0 -- offset 0 belongs only to
            // `ranges[0]` (the whole, isBlockCoverage:false function, count 1: a real but "function
            // invocation recorded, no block detail" observation), which the single count rule (see
            // `countForSpanStart`) fails closed on if a query's innermost containing range resolves to it
            // with a positive count. This fixture's own point is about the NESTED zero-count range's
            // count (0, no fail-closed), not about that separate, legitimate fail-closed rule.
            mappings: buildMappings([{ genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: false,
                        ranges: [
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            { count: 0, endOffset: 30, startOffset: 14 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        // The `if`-body branch outcome exists in the static basis regardless of this shard's own
        // isBlockCoverage flip. Its count is still 0: the single count
        // rule (see `countForSpanStart`) picks the innermost containing range from EVERY range of EVERY
        // function here -- the nested [14, 30) range, narrower than `ranges[0]` -- and that range's own
        // count is 0 (not a fabricated inheritance from `ranges[0]`'s count 1, and not a fail-closed
        // rejection either, since 0 is not a positive count).
        expect(result.records[0].branchEntries).toHaveLength(1);
        expect(result.records[0].branchEntries[0].count).toBe(0);
    });

    it('GREEN (record-local branch attribution): two coherent raw topologies across dump files keep nested zero local and sum the executed outcome -- artificial exact-key union zero is not used', () => {
        // Contract (record-local attribution): each raw dump is one coherent V8 topology.
        // - early-style record: whole-function positive only (outcome span inherits parent count 1)
        // - cancel-style record: parent positive + nested zero (outcome span is 0)
        // Aggregate = 1+0 = 1. Same-record nested zero still wins inside its own topology (covered above).
        // A parent-only dump plus a nested-zero-only dump merged to 0 is not a coherent per-record V8
        // topology (it would force a global-union zero), so it is not used here.
        //
        // Single count rule: the early-style record is deliberately given ONLY the
        // whole-function `ranges[0]` extent, with NO nested range for the then-arm at all -- this is the
        // real V8 shape for an always-taken branch (confirmed with a plain-node probe): V8 never emits a
        // nested range whose count equals its own parent's, so a branch taken every time the function ran
        // has no range of its own and must inherit the innermost ENCLOSING range's count via
        // `countForSpanStart`. A fixture that instead invents a nested range at the
        // same count as the parent (`{ count: 1, ... }` at [14, 30)) would only exercise a
        // `ranges[0]`-excluding design -- that nested range is not a shape V8 itself would ever produce and
        // is removed here.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nif (x) {\n  y();\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        const url = pathToFileURL(scriptPath).href;
        // Early-style coherent topology: function invoked; no nested zero for the then-arm.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url,
            },
        ]);
        // Cancel-style coherent topology: function invoked; nested then-arm observed as zero.
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            { count: 0, endOffset: 30, startOffset: 14 },
                        ],
                    },
                ],
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        // Public functions still expose the additive exact-key merge (union of coordinates).
        expect(result.records[0].functions.some(fn => fn.ranges.some(r => r.startOffset === 14))).toBe(true);
        expect(result.records[0].branchEntries).toHaveLength(1);
        // Record-local: early contributes 1, cancel contributes 0 → aggregate 1 (not global-union 0).
        expect(result.records[0].branchEntries[0].count).toBe(1);
    });

    it('GREEN (real phantom shape): a branch inside an isBlockCoverage:false, count-0 function nested inside a CALLED function reports 0, never the outer called function\'s own count', () => {
        // Direct regression for a real shape (RecorderModel.ts's
        // `destroyReplacedWaitingStream`, never invoked by any test, nested inside an outer function that
        // WAS invoked and itself carried a second, narrower, positive-count block range -- e.g. a loop
        // body -- enclosing the uncalled nested function's own text): dropping BOTH `ranges[0]` of every
        // function AND every `isBlockCoverage: false` function's ranges entirely would leave a query
        // inside the never-called nested function with no candidate of its own, so it would fall through
        // to the outer function's surviving narrower range -- reporting a phantom nonzero count for code
        // that never ran. The single count rule includes EVERY range of EVERY function, `isBlockCoverage`
        // or not, so the nested function's own (narrower, zero-count) range always wins here instead.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // `thenText` is the branch-outcome span under test. `innerFnText` is a function expression that is
        // DEFINED (assigned to `h.n`) but never CALLED. `loopBodyText` is a `for`-loop body that runs 8
        // times per single call to `outer` -- a real V8 dump legitimately gives this its own range with a
        // DIFFERENT count than `outer`'s own call count (never emitting a nested range equal to its
        // parent's), so `outer` itself carries two ranges: its own whole-body extent (`ranges[0]`, count
        // 1) and this loop-body range (count 8) strictly enclosing `innerFnText`'s text.
        const thenText = '{ return 1; }';
        const innerFnText = `function (y) { if (y) ${thenText} return 2; }`;
        const loopBodyText = `{ var h = { n: ${innerFnText} }; }`;
        const outerBodyText = `{ for (var i = 0; i < x; i++) ${loopBodyText} return x; }`;
        const body = `"use strict";\nfunction outer(x) ${outerBodyText}\nouter(8);\n`;
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const outerStart = body.indexOf('function outer');
        const outerBodyStart = body.indexOf(outerBodyText);
        const outerEnd = outerBodyStart + outerBodyText.length;
        const loopBodyStart = body.indexOf(loopBodyText);
        const loopBodyEnd = loopBodyStart + loopBodyText.length;
        const innerStart = body.indexOf(innerFnText);
        const innerEnd = innerStart + innerFnText.length;

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }] },
                    {
                        functionName: 'outer',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: outerEnd, startOffset: outerStart },
                            { count: 8, endOffset: loopBodyEnd, startOffset: loopBodyStart },
                        ],
                    },
                    // Never invoked: isBlockCoverage false, whole-extent count 0 -- narrower than the
                    // enclosing loop-body range above, so it must win the innermost-range search.
                    { functionName: '', isBlockCoverage: false, ranges: [{ count: 0, endOffset: innerEnd, startOffset: innerStart }] },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const thenStart = body.indexOf(thenText, innerStart);
        const branchEntry = result.records[0].branchEntries.find(entry => entry.startOffset === thenStart);
        expect(branchEntry).toBeDefined();
        expect(branchEntry?.count).toBe(0);
    });

    it('GREEN (probe-derived): an always-taken if/ternary/&&/case-or-default branch has no range of its own and inherits the enclosing function\'s own call count', () => {
        // Plain-node V8 probe (`if (x) { return 1; }` always true, `x ? 'a' : 'b'`, `x && 2`, and a
        // `switch` whose matched arm is always the same case): V8 never emits a nested range for an
        // always-taken construct at all when its own count would equal its parent's, so each of these
        // constructs has NO range of its own in this fixture -- only the enclosing function's own
        // `ranges[0]` -- and every branch outcome inside it must inherit that same count (5).
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body =
            '"use strict";\n' +
            'function f(x) {\n' +
            '  if (x) {\n' +
            '    return 1;\n' +
            '  }\n' +
            "  var t = x ? 'a' : 'b';\n" +
            '  var u = x && 2;\n' +
            '  switch (x) {\n' +
            '    case 1:\n' +
            '      return t;\n' +
            '    default:\n' +
            '      return u;\n' +
            '  }\n' +
            '}\n' +
            'f(1);\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const fStart = body.indexOf('function f');
        const fEnd = body.indexOf('f(1);');

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }] },
                    // ONLY the whole-function extent -- no nested range for any construct below, matching
                    // the probe's own result for an always-taken branch.
                    { functionName: 'f', isBlockCoverage: true, ranges: [{ count: 5, endOffset: fEnd, startOffset: fStart }] },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const branchesInF = result.records[0].branchEntries.filter(
            entry => entry.startOffset >= fStart && entry.endOffset <= fEnd,
        );
        // if-then, ternary true, ternary false, `&&` right operand, case clause, default clause.
        expect(branchesInF.length).toBe(6);
        for (const entry of branchesInF) {
            expect(entry.count).toBe(5);
        }
    });

    it('GREEN (probe-derived): an uncalled function reports 0 for both statements and branches inside it, never a wider enclosing scope\'s own count', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body =
            '"use strict";\n' + // line 0
            'function neverCalled(x) {\n' + // line 1
            '  if (x) {\n' + // line 2
            '    return 1;\n' + // line 3
            '  }\n' + // line 4
            '  return 2;\n' + // line 5
            '}\n'; // line 6
        writeCompiledScript(scriptPath, {
            body,
            // Two mapping points: one at the very start (so every earlier-offset branch span still has a
            // preceding point to resolve against, instead of being silently omitted) and one at the start
            // of line 5 (`return 2;`, inside `neverCalled`) so that statement span's own query offset
            // lands inside the uncalled function.
            mappings: buildMappings([
                { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 5, srcColumn: 0, srcLine: 0 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const neverCalledStart = body.indexOf('function neverCalled');
        const neverCalledEnd = body.lastIndexOf('}') + 1;
        const line5Offset = lineStartOffset(body, 5);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }] },
                    // Never invoked at all.
                    {
                        functionName: 'neverCalled',
                        isBlockCoverage: false,
                        ranges: [{ count: 0, endOffset: neverCalledEnd, startOffset: neverCalledStart }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const statementEntry = result.records[0].entries.find(entry => entry.startOffset === line5Offset);
        expect(statementEntry).toBeDefined();
        expect(statementEntry?.count).toBe(0);

        const branchEntry = result.records[0].branchEntries.find(
            entry => entry.startOffset >= neverCalledStart && entry.endOffset <= neverCalledEnd,
        );
        expect(branchEntry).toBeDefined();
        expect(branchEntry?.count).toBe(0);
    });

    it('GREEN: an isBlockCoverage:false range with a positive count contributes 0 for spans inside it and is reported as a functionGranularityExclusions diagnostic, never fails the run', () => {
        // `isBlockCoverage: false` with a positive count is a real, legitimate V8 shape (invocation
        // recorded, but no block-level detail at all -- confirmed to occur in a real coverage run: a worker
        // that has called `v8.stopCoverage()` degrades every file it loads afterward to exactly this
        // shape). There is no narrower range to attribute a
        // specific statement/branch count to without fabricating one, so this contributes `0` for the
        // query instead -- undercounted, never a whole-run failure, and reported so the gap stays visible.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nfunction weird(x) {\n  return x;\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            // One mapping point at the start of line 2 (`  return x;`), inside `weird`.
            mappings: buildMappings([{ genColumn: 0, genLine: 2, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const weirdStart = body.indexOf('function weird');

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }] },
                    // Invoked (positive count) but only function-granularity evidence -- no block detail.
                    {
                        functionName: 'weird',
                        isBlockCoverage: false,
                        ranges: [{ count: 5, endOffset: body.length, startOffset: weirdStart }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const insideWeird = result.records[0].entries.find(entry => entry.startOffset >= weirdStart);
        expect(insideWeird).toBeDefined();
        expect(insideWeird?.count).toBe(0);

        expect(result.functionGranularityExclusions).toHaveLength(1);
        const exclusion = result.functionGranularityExclusions[0];
        expect(exclusion.relativeScriptPath).toBe('model/Foo.js');
        expect(exclusion.functionName).toBe('weird');
        expect(exclusion.sourceFile).toBe('coverage-1.json');
        expect(exclusion.count).toBe(5);
        expect(exclusion.startOffset).toBe(weirdStart);
    });

    it('GREEN (dedup): many basis spans landing inside the same offending range still produce exactly one functionGranularityExclusions entry', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Several statement-mapped lines, ALL inside `weird`, plus an `if` (a branch-basis span) also
        // inside it -- both bases must query this same offending range many times over.
        const body =
            '"use strict";\n' +
            'function weird(x) {\n' +
            '  if (x) {\n' +
            '    return 1;\n' +
            '  }\n' +
            '  return 2;\n' +
            '}\n';
        const weirdStart = body.indexOf('function weird');
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 0, genLine: 2, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 3, srcColumn: 0, srcLine: 0 },
                { genColumn: 0, genLine: 5, srcColumn: 0, srcLine: 0 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }] },
                    {
                        functionName: 'weird',
                        isBlockCoverage: false,
                        ranges: [{ count: 9, endOffset: body.length, startOffset: weirdStart }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records[0].entries.length).toBeGreaterThan(1);
        expect(result.records[0].entries.every(entry => entry.count === 0)).toBe(true);
        expect(result.records[0].branchEntries.length).toBeGreaterThan(0);
        expect(result.records[0].branchEntries.every(entry => entry.count === 0)).toBe(true);
        expect(result.functionGranularityExclusions).toHaveLength(1);
    });
});

/**
 * Record-local count attribution:
 * statement/branch counts must apply innermost-containing-range *per raw script record*, then add the
 * non-negative per-record counts. Exact-coordinate union of ranges across records remains valid for the
 * public `functions` merge, but must not be the attribution input (that produced false zeros when an
 * early-return topology without an exact return range was merged with a cancel topology carrying an
 * exact zero at the return span).
 */
describe('discoverCompiledSnapshotCoverage: record-local statement count attribution across raw V8 records', () => {
    /** Parent-positive / missing-exact / suffix-zero topology mirrored from ParentUserDeletionCoordinator early-return dumps. */
    function earlyOnlyFunctions(parentStart: number, returnStart: number, suffixStart: number, bodyEnd: number) {
        return [
            {
                functionName: '',
                isBlockCoverage: true,
                ranges: [
                    { count: 1, endOffset: bodyEnd, startOffset: 0 },
                    // Parent of the return span: contains returnStart, does not carry an exact return range.
                    { count: 1, endOffset: bodyEnd, startOffset: parentStart },
                    // Suffix after the return statement only -- does not contain returnStart.
                    { count: 0, endOffset: bodyEnd - 1, startOffset: suffixStart },
                ],
            },
        ];
    }

    /** Cancel path: parent positive plus exact zero on the return span. */
    function cancelOnlyFunctions(parentStart: number, returnStart: number, suffixStart: number, bodyEnd: number) {
        return [
            {
                functionName: '',
                isBlockCoverage: true,
                ranges: [
                    { count: 1, endOffset: bodyEnd, startOffset: 0 },
                    { count: 1, endOffset: bodyEnd, startOffset: parentStart },
                    { count: 0, endOffset: suffixStart, startOffset: returnStart },
                    { count: 1, endOffset: bodyEnd - 1, startOffset: suffixStart },
                ],
            },
        ];
    }

    /** Single coherent record that exercised both paths (return taken once). */
    function bothPathsCoherentFunctions(
        parentStart: number,
        returnStart: number,
        suffixStart: number,
        bodyEnd: number,
    ) {
        return [
            {
                functionName: '',
                isBlockCoverage: true,
                ranges: [
                    { count: 1, endOffset: bodyEnd, startOffset: 0 },
                    { count: 2, endOffset: bodyEnd, startOffset: parentStart },
                    // Exact return span observed positive once in the combined topology.
                    { count: 1, endOffset: suffixStart, startOffset: returnStart },
                    { count: 1, endOffset: bodyEnd - 1, startOffset: suffixStart },
                ],
            },
        ];
    }

    function setupReturnSpanFixture() {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // Three mapped statements: parent region, return span, suffix after return.
        const body = '"use strict";\nexports.parent = 1;\nexports.ret = 1;\nexports.suffix = 1;\n';
        const parentStart = lineStartOffset(body, 1);
        const returnStart = lineStartOffset(body, 2);
        const suffixStart = lineStartOffset(body, 3);
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 1 },
                { genColumn: 0, genLine: 2, srcColumn: 0, srcLine: 2 },
                { genColumn: 0, genLine: 3, srcColumn: 0, srcLine: 3 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        return {
            bodyEnd: body.length,
            parentStart,
            rawCoverageDir: makeScratchDir('raw'),
            repoRoot,
            returnStart,
            rootA,
            scriptPath,
            suffixStart,
            url: pathToFileURL(scriptPath).href,
        };
    }

    function statementCountAt(
        result: ReturnType<typeof discoverCompiledSnapshotCoverage>,
        returnStart: number,
    ): number {
        const entry = result.records[0].entries.find(e => e.startOffset === returnStart);
        expect(entry).toBeDefined();
        return entry!.count;
    }

    it('RED→GREEN: early-only topology (parent positive, missing exact return, suffix zero) attributes return statement count 1', () => {
        const { bodyEnd, parentStart, rawCoverageDir, repoRoot, returnStart, rootA, suffixStart, url } =
            setupReturnSpanFixture();
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: earlyOnlyFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(statementCountAt(result, returnStart)).toBe(1);
    });

    it('RED→GREEN: cancel-only topology (parent positive + exact return zero) attributes return statement count 0', () => {
        const { bodyEnd, parentStart, rawCoverageDir, repoRoot, returnStart, rootA, suffixStart, url } =
            setupReturnSpanFixture();
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: cancelOnlyFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(statementCountAt(result, returnStart)).toBe(0);
    });

    it.each([
        ['early-then-cancel', ['early', 'cancel'] as const],
        ['cancel-then-early', ['cancel', 'early'] as const],
    ])(
        'RED→GREEN: early + cancel as separate records aggregate return statement count 1 (%s result order)',
        (_label, order) => {
            const { bodyEnd, parentStart, rawCoverageDir, repoRoot, returnStart, rootA, suffixStart, url } =
                setupReturnSpanFixture();
            const early = {
                functions: earlyOnlyFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            };
            const cancel = {
                functions: cancelOnlyFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            };
            const byKind = { cancel, early } as const;
            // Deterministic reader order: one dump file whose `result` array order is fixed by the
            // fixture. Creation order of separate dump files is not evidence (readdir is unsorted).
            writeRawCoverage(
                rawCoverageDir,
                'coverage-1.json',
                order.map(kind => byKind[kind]),
            );

            const result = discoverCompiledSnapshotCoverage({
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
            });
            // Global exact-key union would keep exact zero and report 0; record-local sum is 1+0=1.
            expect(statementCountAt(result, returnStart)).toBe(1);
        },
    );

    it('RED→GREEN: same two-path execution as one coherent record attributes return statement count 1', () => {
        const { bodyEnd, parentStart, rawCoverageDir, repoRoot, returnStart, rootA, suffixStart, url } =
            setupReturnSpanFixture();
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: bothPathsCoherentFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(statementCountAt(result, returnStart)).toBe(1);
    });

    it('RED→GREEN negative guard: narrower zero inside the same record remains 0 despite a positive parent (no global parent override)', () => {
        const { bodyEnd, parentStart, rawCoverageDir, repoRoot, returnStart, rootA, suffixStart, url } =
            setupReturnSpanFixture();
        // Same-record cancel topology alone: exact zero must win over parent positive.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: cancelOnlyFunctions(parentStart, returnStart, suffixStart, bodyEnd),
                url,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(statementCountAt(result, returnStart)).toBe(0);
    });
});

/**
 * Statement-basis syntax-only rule: `buildStatementBasisEntries` spans run between
 * consecutive source-map mapping points, never between statement boundaries, so a span can legitimately
 * start mid-whitespace (rule 1: query the raw count at the span's own first non-whitespace/non-comment
 * token, not its raw start) or contain no executable token at all -- whitespace, a comment, punctuation,
 * or a bare structural keyword (`try`/`catch`/`finally`/`else`/`default`/`do`) alone -- in which case it
 * is not a statement and is omitted from the basis entirely (rule 2), never counted in the total or the
 * covered subset. Both rules are statement-basis only; the branch-outcome basis is unaffected.
 */
describe('discoverCompiledSnapshotCoverage: statement-basis syntax-only span omission and first-non-whitespace count query', () => {
    it('GREEN (rule 1): a span whose leading whitespace sits inside a V8-zero continuation range, but whose own first token sits inside the enclosing nonzero range, is attributed that nonzero count -- and keeps its id at the span own (unqueried) start/end', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Leading.ts'), 'export const a = 1;\nexport const b = 2;\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Leading.js');
        // One generated line, two mapping points: [0,12) covers "exports.a=1;", [12,end) covers the
        // whitespace-then-`return` span under test -- the leading four spaces are V8-zero (a synthetic
        // stand-in for a real post-`return`/`throw` continuation range), `return` itself resumes inside
        // the enclosing (nonzero) function range.
        const body = 'exports.a=1;    return exports.a;\n';
        const returnOffset = body.indexOf('return');
        expect(returnOffset).toBe(16);
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
                { genColumn: 12, genLine: 0, srcColumn: 0, srcLine: 1 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Leading.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 5, endOffset: body.length, startOffset: 0 },
                            // Zero-count continuation range covering ONLY the leading whitespace
                            // (offsets [12,16)) of the span under test -- `return` (offset 16) is
                            // deliberately just outside it, back in the enclosing nonzero range.
                            { count: 0, endOffset: returnOffset, startOffset: 12 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        const entry = result.records[0].entries.find(e => e.startOffset === 12);
        expect(entry).toBeDefined();
        // Rule 1: queried at the first non-whitespace offset (16, `return`'s own start), not the span's
        // raw start (12, inside the whitespace) -- so this is 5, never the phantom 0 the old
        // query-at-span-start rule would have reported.
        expect(entry!.count).toBe(5);
        // Rule 3: the span's own start/end (its id) is unaffected by which offset was queried for count.
        expect(entry!.startOffset).toBe(12);
        expect(entry!.endOffset).toBe(body.length);
        expect(entry!.start).toEqual({ column: 0, line: 2 });
    });

    it('GREEN (rule 2): whitespace-only, `}`-only, and bare `finally`-only spans are omitted from the statement basis entirely, while a `return;` span in the same script is kept', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/SyntaxOnly.ts'), Array.from({ length: 6 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/SyntaxOnly.js');
        // Syntactically valid JS (required: the branch-outcome basis parses this same compiled body
        // with `ts.createSourceFile` and fails closed on any parse diagnostic) -- a real `try {} finally
        // {}` so the bare `finally` keyword is where a real compiled `tsc` output would place it.
        const body = [
            '"use strict";',
            'function h(x) {',
            '    if (x) {',
            '        return;',
            '    }',
            '    try {',
            '    } finally {',
            '        cleanup();',
            '    }',
            '}',
            '',
        ].join('\n');

        const line3Start = lineStartOffset(body, 3); // '        return;'
        const returnOnlyStart = line3Start + 8; // 'r' of `return`
        const returnOnlyEnd = returnOnlyStart + 'return;'.length; // right after `;`
        const line4Start = lineStartOffset(body, 4); // '    }'
        const closeBraceStart = line4Start + 4; // `}` closing the `if` block
        const closeBraceEnd = closeBraceStart + 1; // right after that `}`
        const line6Start = lineStartOffset(body, 6); // '    } finally {'
        const finallyStart = line6Start + 6; // `finally`
        const finallyEnd = finallyStart + 'finally'.length; // right after `finally`, before ` {`

        expect(body.slice(returnOnlyStart, returnOnlyEnd)).toBe('return;');
        expect(body.slice(returnOnlyEnd, closeBraceStart)).toBe('\n    ');
        expect(body.slice(closeBraceStart, closeBraceEnd)).toBe('}');
        // Whitespace, the unrelated `try {}` block's own punctuation and bare `try` keyword -- every
        // token in this stretch is still non-executable (rule 2 applies to it too, just not asserted
        // on directly here).
        expect(body.slice(closeBraceEnd, finallyStart)).toBe('\n    try {\n    } ');
        expect(body.slice(finallyStart, finallyEnd)).toBe('finally');

        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([
                { genColumn: 8, genLine: 3, srcColumn: 0, srcLine: 0 },
                { genColumn: 15, genLine: 3, srcColumn: 0, srcLine: 1 },
                { genColumn: 4, genLine: 4, srcColumn: 0, srcLine: 2 },
                { genColumn: 5, genLine: 4, srcColumn: 0, srcLine: 3 },
                { genColumn: 6, genLine: 6, srcColumn: 0, srcLine: 4 },
                { genColumn: 13, genLine: 6, srcColumn: 0, srcLine: 5 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/SyntaxOnly.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 7, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        const startOffsets = new Set(result.records[0].entries.map(e => e.startOffset));

        // `return;` -- has an executable token (`return`) -- is kept, counted from the enclosing range.
        const returnEntry = result.records[0].entries.find(e => e.startOffset === returnOnlyStart);
        expect(returnEntry).toBeDefined();
        expect(returnEntry!.endOffset).toBe(returnOnlyEnd);
        expect(returnEntry!.count).toBe(7);

        // Whitespace-only, `}`-only, and bare `finally`-only spans have no executable token: omitted.
        expect(startOffsets.has(returnOnlyEnd)).toBe(false); // "\n    " (whitespace only)
        expect(startOffsets.has(closeBraceStart)).toBe(false); // "}" only
        expect(startOffsets.has(closeBraceEnd)).toBe(false); // whitespace + bare `try` + punctuation only
        expect(startOffsets.has(finallyStart)).toBe(false); // "finally" only
    });
});

/**
 * `verifyTotalSourcePopulation`
 * confirms every real `src/**\/*.ts` file (excluding `.d.ts`) is accounted for in `discoverCompiledSnapshotCoverage`'s
 * `records` -- either already discovered, or explicitly declared no-emit. Fixtures build a real
 * `src/**\/*.ts` tree under `repositoryRoot` (via `writeFile`, matching this suite's other fixtures)
 * without necessarily wiring every file into a compiled snapshot script -- that gap is exactly what
 * this function exists to reject or accept.
 */
describe('verifyTotalSourcePopulation: total src/**/*.ts population completeness + no-emit classification', () => {
    it('GREEN: every real src file already has a discovered record -- records pass through unchanged, no no-emit entries added', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const result = verifyTotalSourcePopulation({ records, repositoryRoot: repoRoot });
        expect(result.records).toEqual(records);
    });

    it('RED (undeclared-no-emit-source): a real src file with no discovered record and no declaration is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        // A type-only file: never referenced by any compiled snapshot script or raw record below.
        writeFile(join(repoRoot, 'src/model/FooTypes.ts'), 'export interface FooShape { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(reasonOf(() => verifyTotalSourcePopulation({ records, repositoryRoot: repoRoot }))).toBe(
            'undeclared-no-emit-source',
        );
    });

    it('GREEN: a src file declared in declaredNoEmitSources gets an explicit zero-statement total-map entry instead of being rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/FooTypes.ts'), 'export interface FooShape { id: string; }');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const result = verifyTotalSourcePopulation({
            declaredNoEmitSources: ['src/model/FooTypes.ts'],
            records,
            repositoryRoot: repoRoot,
        });
        expect(result.records).toHaveLength(2);
        const noEmitRecord = result.records.find(record => record.sourcePath === 'src/model/FooTypes.ts');
        expect(noEmitRecord).toEqual({ entries: [], noEmit: true, sourcePath: 'src/model/FooTypes.ts' });

        // The declared no-emit source gets an explicit, zero-statement entry in the eventual total
        // map -- not a silent absence indistinguishable from an uncollected script.
        const coverageMap = toCoverageFinalMap(result.records);
        expect(Object.keys(coverageMap).sort()).toEqual(['src/model/Foo.ts', 'src/model/FooTypes.ts']);
        expect(coverageMap['src/model/FooTypes.ts']).toEqual({
            b: {},
            branchMap: {},
            f: {},
            fnMap: {},
            path: 'src/model/FooTypes.ts',
            s: {},
            statementMap: {},
        });
        const summary = summarizeCoverage(coverageMap);
        // The declared-no-emit file contributes 0 statements of its own -- the total equals exactly
        // what the one real discovered record (Foo.ts) already carries, not inflated by a phantom
        // entry for the no-emit file.
        expect(summary.statementsTotal).toBe(records[0].entries.length);
        expect(summary.uncoveredFiles).not.toContain('src/model/FooTypes.ts');
    });

    it('RED (no-emit-mismatch): a declared no-emit source that actually has a discovered record is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(
            reasonOf(() =>
                verifyTotalSourcePopulation({
                    declaredNoEmitSources: ['src/model/Foo.ts'],
                    records,
                    repositoryRoot: repoRoot,
                }),
            ),
        ).toBe('no-emit-mismatch');
    });

    it('RED (schema-mismatch): a declaredNoEmitSources entry that is not a real file under src/ is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(
            reasonOf(() =>
                verifyTotalSourcePopulation({
                    declaredNoEmitSources: ['src/model/DoesNotExist.ts'],
                    records,
                    repositoryRoot: repoRoot,
                }),
            ),
        ).toBe('schema-mismatch');
    });

    it('RED (schema-mismatch): a declaredNoEmitSources entry outside src/**/*.ts (e.g. a .d.ts path) is rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        expect(
            reasonOf(() =>
                verifyTotalSourcePopulation({
                    declaredNoEmitSources: ['src/model/Foo.d.ts'],
                    records: [],
                    repositoryRoot: repoRoot,
                }),
            ),
        ).toBe('schema-mismatch');
    });

    it('RED (schema-mismatch): duplicate declaredNoEmitSources entries are rejected', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/FooTypes.ts'), 'export interface FooShape { id: string; }');
        expect(
            reasonOf(() =>
                verifyTotalSourcePopulation({
                    declaredNoEmitSources: ['src/model/FooTypes.ts', 'src/model/FooTypes.ts'],
                    records: [],
                    repositoryRoot: repoRoot,
                }),
            ),
        ).toBe('schema-mismatch');
    });

    it('RED (schema-mismatch): rejects a non-array records input', () => {
        const repoRoot = makeScratchDir('repo');
        expect(reasonOf(() => verifyTotalSourcePopulation({ records: null, repositoryRoot: repoRoot }))).toBe(
            'schema-mismatch',
        );
    });

    it('RED (schema-mismatch): rejects a non-array declaredNoEmitSources input', () => {
        const repoRoot = makeScratchDir('repo');
        expect(
            reasonOf(() =>
                verifyTotalSourcePopulation({
                    declaredNoEmitSources: 'src/model/Foo.ts',
                    records: [],
                    repositoryRoot: repoRoot,
                }),
            ),
        ).toBe('schema-mismatch');
    });

    it('GREEN: a repositoryRoot with no src/ directory at all reports an empty total population (vacuously complete)', () => {
        const repoRoot = makeScratchDir('repo-empty');
        const result = verifyTotalSourcePopulation({ records: [], repositoryRoot: repoRoot });
        expect(result.records).toEqual([]);
    });
});

/**
 * `toCoverageFinalMap` converts
 * `discoverCompiledSnapshotCoverage`'s `records` into a standard Istanbul `coverage-final.json`
 * coverage map (`{ [sourcePath]: FileCoverage }`) -- the exact shape any Istanbul-compatible reader
 * (such as the reader in `run-coverage-gate-cli.mjs`)
 * already accepts. Pure and synchronous:
 * no filesystem, no binding metadata -- digest binding is a separate, not-yet-decided concern this
 * function does not touch.
 */
describe('toCoverageFinalMap: converter records -> standard Istanbul coverage-final map', () => {
    it('RED: converts each record into a path-keyed FileCoverage with statementMap/s from entries and empty branchMap/b/fnMap/f', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const barScript = join(rootA, 'model/Bar.js');

        const fooBody = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
        const fooLine1 = lineStartOffset(fooBody, 1);
        const fooLine2 = lineStartOffset(fooBody, 2);
        writeCompiledScript(fooScript, {
            body: fooBody,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
                { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
            ]),
            sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))],
        });
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 3, endOffset: fooLine2, startOffset: fooLine1 },
                            { count: 0, endOffset: fooBody.length, startOffset: fooLine2 },
                        ],
                    },
                ],
                url: pathToFileURL(fooScript).href,
            },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [{ url: pathToFileURL(barScript).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const coverageMap = toCoverageFinalMap(records);

        // statementMap/branchMap keys are the entry's own
        // compiled-range identity (`startOffset:endOffset`), not a shard-local array index -- see
        // `toCoverageFinalMap`'s own doc.
        const fooStatementId0 = `${fooLine1}:${fooLine2}`;
        const fooStatementId1 = `${fooLine2}:${fooBody.length}`;
        // Bar.js has no explicit raw functions/ranges in its raw coverage record, so it falls back to
        // this file's `RAW_FUNCTIONS` fixture (`{ endOffset: 40, startOffset: 0 }`) for its count only
        // (the statement basis span itself is this script's own default one-point
        // mapping through `compiledBodyEndOffset` of its default compiled body, not the raw range's own
        // endOffset -- `RAW_FUNCTIONS`' count 1 still applies, since its `[0, 40)` range contains the
        // span's start offset 0).
        const barStatementId0 = `0:${'"use strict";\nexports.x = 1;\n'.length}`;

        expect(Object.keys(coverageMap)).toEqual(['src/model/Bar.ts', 'src/model/Foo.ts']);
        expect(coverageMap['src/model/Foo.ts']).toEqual({
            path: 'src/model/Foo.ts',
            statementMap: {
                [fooStatementId0]: { end: { column: 8, line: 7 }, start: { column: 8, line: 5 } },
                [fooStatementId1]: { end: { column: 8, line: 7 }, start: { column: 8, line: 7 } },
            },
            s: { [fooStatementId0]: 3, [fooStatementId1]: 0 },
            branchMap: {},
            b: {},
            fnMap: {},
            f: {},
        });
        expect(coverageMap['src/model/Bar.ts']).toEqual({
            path: 'src/model/Bar.ts',
            statementMap: { [barStatementId0]: { end: { column: 0, line: 1 }, start: { column: 0, line: 1 } } },
            s: { [barStatementId0]: 1 },
            branchMap: {},
            b: {},
            fnMap: {},
            f: {},
        });
    });

    it('RED: an empty records array converts to an empty coverage map', () => {
        expect(toCoverageFinalMap([])).toEqual({});
    });

    it('RED (schema-mismatch): rejects a non-array records input', () => {
        expect(reasonOf(() => toCoverageFinalMap('not-an-array'))).toBe('schema-mismatch');
    });

    // discoverCompiledSnapshotCoverage's
    // own duplicate check only rejects an *inconsistent* cross-root mapping (same script path ->
    // different source, or same source claimed by different script paths). Two snapshot roots that
    // each consistently resolve the same relative script path to the same source (e.g. one dist tree
    // per Vitest worker, both containing the same file) pass that check cleanly and produce two
    // records for the one sourcePath -- exactly the multi-snapshot shape the module doc says must be
    // supported ("do not assume a single snapshot"). Silently keying by sourcePath would
    // let the second record overwrite the first and drop real coverage without any signal.
    it('RED (duplicate-source-across-snapshots): two consistent snapshot roots producing records for the same sourcePath are rejected, not silently merged/overwritten', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const rootB = join(artifactRoot, 'compiled-dist-b/dist');
        const barScriptA = join(rootA, 'model/Bar.js');
        const barScriptB = join(rootB, 'model/Bar.js');
        writeCompiledScript(barScriptA, { sources: [sourceEntryFor(barScriptA, join(repoRoot, 'src/model/Bar.ts'))] });
        writeCompiledScript(barScriptB, { sources: [sourceEntryFor(barScriptB, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScriptA).href }]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [{ url: pathToFileURL(barScriptB).href }]);

        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA, rootB],
        });
        // The consistent cross-root mapping passes discoverCompiledSnapshotCoverage's own checks --
        // two records for the same sourcePath reach toCoverageFinalMap.
        expect(records).toHaveLength(2);
        expect(records.map(record => record.sourcePath)).toEqual(['src/model/Bar.ts', 'src/model/Bar.ts']);

        expect(reasonOf(() => toCoverageFinalMap(records))).toBe('duplicate-source-across-snapshots');
    });

    it("RED: a record with branchEntries converts to a single-location branchMap entry per outcome, b as a one-element count array, keyed by each outcome's own compiled-range identity even when their mapped locations coincide", () => {
        const branchLoc = { end: { column: 1, line: 1 }, start: { column: 0, line: 1 } };
        const records = [
            {
                branchEntries: [
                    { count: 0, end: branchLoc.end, endOffset: 20, start: branchLoc.start, startOffset: 10 },
                    { count: 2, end: branchLoc.end, endOffset: 40, start: branchLoc.start, startOffset: 30 },
                ],
                entries: [],
                sourcePath: 'src/model/Foo.ts',
            },
        ];

        const coverageMap = toCoverageFinalMap(records);

        expect(coverageMap['src/model/Foo.ts'].branchMap).toEqual({
            '10:20': { loc: branchLoc, locations: [branchLoc], type: 'branch' },
            '30:40': { loc: branchLoc, locations: [branchLoc], type: 'branch' },
        });
        expect(coverageMap['src/model/Foo.ts'].b).toEqual({ '10:20': [0], '30:40': [2] });
    });

    it('RED: a record with no branchEntries field (e.g. a verifyTotalSourcePopulation no-emit entry) converts to an empty branchMap/b', () => {
        const coverageMap = toCoverageFinalMap([{ entries: [], sourcePath: 'src/model/NoEmit.ts' }]);
        expect(coverageMap['src/model/NoEmit.ts'].branchMap).toEqual({});
        expect(coverageMap['src/model/NoEmit.ts'].b).toEqual({});
    });

    // A sparse source map can let more than one physically distinct raw V8 range
    // degenerate to the same mapped location (the real TailStream.ts case, 14
    // independent branch-outcome ranges all resolving to the same `5:3-5:3`, was itself a *branch*-outcome
    // scenario). Statement identity is not raw-offset based: the statement basis is
    // the script's own mapping-point spans, not raw V8 ranges, so a sparse mapping table collapses this region into the
    // one span/one statementMap entry the source map actually supports, counted from the *innermost* raw
    // range containing the span's own start offset -- never a second, disjoint raw range's count folded
    // in. The analogous gap for branches is closed the same way:
    // `branchEntries` identity comes from a static basis (a syntax parse of
    // the compiled JS, see `buildBranchBasisEntries`), not raw-offset identity -- see the branch
    // basis test (the RED test in the "shard-independent statement/branch location basis"
    // describe block above) for that contract; the "branch-outcome conversion" suite below
    // still pins the *count* rule (innermost `isBlockCoverage === true` range containing a span's start).
    it("GREEN: two disjoint raw V8 ranges that both degenerate to the same sparse-mapped location collapse into the one statement basis span the source map supports, counted from the innermost range containing the span's own start offset", () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Sparse.ts'), '// copyright header\nexport const x = 1;\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Sparse.js');
        // A single generated-line body with exactly one mapping point, at its very start -- mirrors a
        // real tsc file whose only mapping segment for a stretch of generated code lands on a leading
        // comment line (root-cause F6: TailStream.ts's mapping point at its own copyright-comment line
        // 5). Every generated offset on this line, however far past the mapping point, resolves (via
        // "nearest preceding segment") to that one point -- so the whole line is one statement basis span.
        const body = 'AAAAAAAAAABBBBBBBBBB';
        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([{ genColumn: 0, genLine: 0, srcColumn: 3, srcLine: 4 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Sparse.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        // Two disjoint, physically distinct ranges -- neither contains the other -- both
                        // entirely past the sole mapping point. Only the first contains the one basis
                        // span's own start offset (0), so its count is the one assigned.
                        ranges: [
                            { count: 1, endOffset: 10, startOffset: 0 },
                            { count: 4, endOffset: 20, startOffset: 10 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        expect(result.records).toHaveLength(1);
        expect(result.records[0].entries).toHaveLength(1);
        const [entry] = result.records[0].entries;
        expect(entry.start).toEqual({ column: 3, line: 5 });
        expect(entry.end).toEqual({ column: 3, line: 5 });
        expect(entry.startOffset).toBe(0);
        expect(entry.endOffset).toBe(body.length);
        expect(entry.count).toBe(1);

        const coverageMap = toCoverageFinalMap(result.records);
        const statementMap = coverageMap['src/model/Sparse.ts'].statementMap;
        const statementId = `0:${body.length}`;
        expect(Object.keys(statementMap)).toEqual([statementId]);
        expect(coverageMap['src/model/Sparse.ts'].s).toEqual({ [statementId]: 1 });
    });
});

async function reasonOfAsync(fn: () => Promise<unknown>): Promise<string | undefined> {
    try {
        await fn();
        return undefined;
    } catch (error) {
        return (error as InstanceType<typeof CompiledSnapshotCoverageError>).reason;
    }
}

const TREE_DIGEST = 'b'.repeat(40);
const HEAD_TREE = 'c'.repeat(40);
/** A clean worktree: the content tree is HEAD's tree. */
const CLEAN_WORKTREE_CONTENT = { contentTree: HEAD_TREE, headTree: HEAD_TREE, uncommittedChanges: false };
/** A worktree with uncommitted changes: the content tree differs from HEAD's tree. */
const UNCOMMITTED_WORKTREE_CONTENT = { contentTree: TREE_DIGEST, headTree: HEAD_TREE, uncommittedChanges: true };
/** Git was unavailable: nothing could be recorded. */
const UNRECORDED_WORKTREE_CONTENT = { contentTree: null, headTree: null, uncommittedChanges: null };

/**
 * `writeCanonicalCoverageArtifacts` atomically writes a plain Istanbul `coverage-final.json` (no added
 * fields), then a sibling `coverage-final.binding.json` sidecar carrying exactly the six approved fields:
 * `coverageFinalSha256` (of the just-written `coverage-final.json` bytes),
 * `worktreeContent` (caller-supplied record of the measured content), `testRosterDigest`, `snapshotDigests` (one per resolved
 * `snapshotRoots` entry), `rawDumpDigest`, `converterVersion`. Every expected digest in these tests is
 * independently recomputed from the fixture's own known inputs via the shared, already-tested
 * `sha256Hex` -- never by re-deriving the implementation's own internal digest logic.
 */
/**
 * `summarizeCoverage`
 * computes C0 (statement) / C1 (branch) percentages from a `toCoverageFinalMap`-shaped coverage map --
 * the exact basis `writeCanonicalCoverageArtifacts` just wrote -- so `run-tests.mjs`'s coverage-mode
 * gate judges the converter's own output, not the built-in v8 provider's. Pure and synchronous.
 *
 * Statements: an empty map (or a map whose files carry zero statement entries) reports 0%, not a
 * vacuous 100% -- that is exactly the "old all-zero report accepted as success" failure mode the
 * converter exists to prevent.
 *
 * Branches: `toCoverageFinalMap`
 * derives real `branchMap`/`b` from each record's `branchEntries`, so a zero branch population
 * across an entire coverage map is not a by-design converter scope limit -- it reports
 * 0%, the same "old all-zero report accepted as success" failure mode the statements side already
 * guards against, never a vacuous 100%.
 */
describe('summarizeCoverage: C0/C1 percentages from a coverage-final map, same basis as the sidecar', () => {
    function coverageMapFixture(files) {
        const map = {};
        for (const [sourcePath, { statementCounts, branchOutcomeCounts = [] }] of Object.entries(files)) {
            const statementMap = {};
            const s = {};
            statementCounts.forEach((count, index) => {
                statementMap[String(index)] = {
                    end: { column: 0, line: index + 1 },
                    start: { column: 0, line: index + 1 },
                };
                s[String(index)] = count;
            });
            map[sourcePath] = {
                b: branchOutcomeCounts.length > 0 ? { '0': branchOutcomeCounts } : {},
                branchMap: {},
                f: {},
                fnMap: {},
                path: sourcePath,
                s,
                statementMap,
            };
        }
        return map;
    }

    it('RED: 100% statements, no branch entries at all -> statementsPercent 100, branchesPercent 0 (fail-closed, never vacuous 100), no uncovered files', () => {
        const coverageMap = coverageMapFixture({
            'src/a.ts': { statementCounts: [1, 2, 3] },
            'src/b.ts': { statementCounts: [1] },
        });
        const summary = summarizeCoverage(coverageMap);
        expect(summary.statementsTotal).toBe(4);
        expect(summary.statementsCovered).toBe(4);
        expect(summary.statementsPercent).toBe(100);
        expect(summary.branchesTotal).toBe(0);
        expect(summary.branchesPercent).toBe(0);
        // A zero branch population still never adds a file to uncoveredFiles on its own (condition:
        // a file with no real branches is not penalized) -- only the run-level percent fails closed.
        expect(summary.uncoveredFiles).toEqual([]);
    });

    it('RED: a partially-covered file is reported as uncovered and drags statementsPercent below 100', () => {
        const coverageMap = coverageMapFixture({
            'src/a.ts': { statementCounts: [1, 2, 3] },
            'src/b.ts': { statementCounts: [1, 0] },
        });
        const summary = summarizeCoverage(coverageMap);
        expect(summary.statementsTotal).toBe(5);
        expect(summary.statementsCovered).toBe(4);
        expect(summary.statementsPercent).toBe(80);
        expect(summary.uncoveredFiles).toEqual(['src/b.ts']);
    });

    it('RED: an empty coverage map reports 0% statements (never a vacuous 100%) -- the "old all-zero report accepted" failure mode', () => {
        const summary = summarizeCoverage({});
        expect(summary.statementsTotal).toBe(0);
        expect(summary.statementsPercent).toBe(0);
    });

    it('RED: a real (non-empty) branch population still counts uncovered outcomes normally', () => {
        const coverageMap = coverageMapFixture({
            'src/a.ts': { statementCounts: [1], branchOutcomeCounts: [1, 0] },
        });
        const summary = summarizeCoverage(coverageMap);
        expect(summary.branchesTotal).toBe(2);
        expect(summary.branchesCovered).toBe(1);
        expect(summary.branchesPercent).toBe(50);
        expect(summary.uncoveredFiles).toEqual(['src/a.ts']);
    });

    it('RED (schema-mismatch): rejects a non-object coverageMap', () => {
        expect(reasonOf(() => summarizeCoverage(null))).toBe('schema-mismatch');
        expect(reasonOf(() => summarizeCoverage([]))).toBe('schema-mismatch');
        expect(reasonOf(() => summarizeCoverage('not-a-map'))).toBe('schema-mismatch');
    });
});

describe('writeCanonicalCoverageArtifacts: canonical coverage-final.json + binding sidecar', () => {
    it('RED: writes a pure Istanbul coverage-final.json and a six-field binding sidecar bound to the just-written bytes', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');
        const testRoster = ['test/server/model/bar.test.ts', 'test/server/model/foo.test.ts'];

        const { binding, coverageMap } = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster,
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        // coverage-final.json on disk is byte-identical to toCoverageFinalMap's pure output -- no
        // added fields of any kind.
        const coverageFinalBytes = await readFile(join(outputDirectory, 'coverage-final.json'));
        const { records } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        expect(JSON.parse(coverageFinalBytes.toString('utf8'))).toEqual(toCoverageFinalMap(records));
        expect(coverageMap).toEqual(toCoverageFinalMap(records));

        const bindingBytes = await readFile(join(outputDirectory, 'coverage-final.binding.json'));
        const persistedBinding = JSON.parse(bindingBytes.toString('utf8'));
        expect(persistedBinding).toEqual(binding);

        // Exactly the six fields the ruling names -- nothing else.
        expect(Object.keys(persistedBinding).sort()).toEqual(
            [
                'converterVersion',
                'coverageFinalSha256',
                'rawDumpDigest',
                'snapshotDigests',
                'testRosterDigest',
                'worktreeContent',
            ].sort(),
        );

        // coverageFinalSha256 is a real hash of the exact bytes written to coverage-final.json.
        expect(persistedBinding.coverageFinalSha256).toBe(sha256Hex(coverageFinalBytes));
        // worktreeContent is passed through from the caller verbatim.
        expect(persistedBinding.worktreeContent).toEqual(CLEAN_WORKTREE_CONTENT);
        // testRosterDigest is a digest of the sorted roster -- order-independent.
        expect(persistedBinding.testRosterDigest).toBe(sha256Hex(JSON.stringify([...testRoster].sort())));
        expect(persistedBinding.testRosterDigest).toBe(sha256Hex(JSON.stringify([...testRoster].reverse().sort())));
        // One snapshotDigests entry per resolved snapshotRoots entry.
        expect(persistedBinding.snapshotDigests).toHaveLength(1);
        expect(typeof persistedBinding.snapshotDigests[0]).toBe('string');
        // rawDumpDigest is a real hash derived from the raw coverage directory's own file contents.
        const rawBytes = await readFile(join(rawCoverageDir, 'coverage-1.json'));
        expect(persistedBinding.rawDumpDigest).toBe(sha256Hex(`coverage-1.json:${sha256Hex(rawBytes)}`));
        expect(typeof persistedBinding.converterVersion).toBe('string');
        expect(persistedBinding.converterVersion.length).toBeGreaterThan(0);
    });

    it('GREEN (undercounting visibility): writes a coverage-excluded-records.json sidecar and exposes excludedRecordDiagnostics on the return value', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        writeCompiledScript(scriptPath, { sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))] });
        const jsSource = readFileSync(scriptPath, 'utf8');

        const rawCoverageDir = makeScratchDir('raw');
        // Verified: this record's own top-level end equals the on-disk dist length exactly.
        writeRawCoverage(rawCoverageDir, 'coverage-native.json', [
            {
                functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: jsSource.length, startOffset: 0 }] }],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        // Unverifiable: top-level end matches neither the on-disk length nor any candidate capture (the
        // capture directory below is opted into but genuinely empty) -- excluded, not failed closed,
        // since the native record above already proves real evidence for this same script.
        writeRawCoverage(rawCoverageDir, 'coverage-unverifiable.json', [
            {
                functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ count: 1, endOffset: jsSource.length * 4, startOffset: 0 }] }],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        const transformCaptureDir = makeScratchDir('transform-capture-empty');

        const outputDirectory = makeScratchDir('output');
        const result = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/foo.test.ts'],
            transformCaptureDir,
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        expect(result.excludedRecordDiagnostics).toHaveLength(1);
        expect(result.excludedRecordDiagnostics[0].relativeScriptPath).toBe('model/Foo.js');

        const sidecarBytes = await readFile(join(outputDirectory, COVERAGE_EXCLUDED_RECORDS_FILE_NAME));
        const sidecar = JSON.parse(sidecarBytes.toString('utf8'));
        expect(sidecar.excludedRecordCount).toBe(1);
        expect(sidecar.excludedRecords).toHaveLength(1);
        expect(sidecar.excludedRecords[0].relativeScriptPath).toBe('model/Foo.js');
    });

    it('GREEN (undercounting visibility): a run with zero exclusions still writes the sidecar, with an empty array', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');
        const result = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/bar.test.ts'],
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        expect(result.excludedRecordDiagnostics).toEqual([]);
        expect(result.functionGranularityExclusions).toEqual([]);
        const sidecar = JSON.parse((await readFile(join(outputDirectory, COVERAGE_EXCLUDED_RECORDS_FILE_NAME))).toString('utf8'));
        expect(sidecar).toEqual({
            excludedRecordCount: 0,
            excludedRecords: [],
            functionGranularityExclusionCount: 0,
            functionGranularityExclusions: [],
        });
    });

    // Proves verifyTotalSourcePopulation
    // is actually wired into this canonical output path, not just tested in isolation -- without
    // that wiring, an undiscovered src/**/*.ts file (no compiled counterpart, no declaration) would have
    // silently been missing from coverage-final.json instead of failing the run closed.
    it('RED (undeclared-no-emit-source): rejects, before writing anything, when repositoryRoot has a src/**/*.ts file with no discovered record and no declaredNoEmitSources entry', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        // Never referenced by any compiled snapshot script or raw record below.
        writeFile(join(repoRoot, 'src/model/BarTypes.ts'), 'export interface BarShape { id: string; }');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');

        await expect(
            writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: ['test/server/model/bar.test.ts'],
                worktreeContent: CLEAN_WORKTREE_CONTENT,
            }),
        ).rejects.toMatchObject({ reason: 'undeclared-no-emit-source' });

        // Fails closed *before* writing anything -- same convention as every other early rejection in
        // this describe block (missing-binding-digest).
        expect(readdirSync(outputDirectory)).toEqual([]);
    });

    it('GREEN: declaring that same file in declaredNoEmitSources lets the run through, with an explicit zero-statement entry for it', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        writeFile(join(repoRoot, 'src/model/BarTypes.ts'), 'export interface BarShape { id: string; }');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');

        const { coverageMap } = await writeCanonicalCoverageArtifacts({
            declaredNoEmitSources: ['src/model/BarTypes.ts'],
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/bar.test.ts'],
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        expect(Object.keys(coverageMap).sort()).toEqual(['src/model/Bar.ts', 'src/model/BarTypes.ts']);
        expect(coverageMap['src/model/BarTypes.ts']).toEqual({
            b: {},
            branchMap: {},
            f: {},
            fnMap: {},
            path: 'src/model/BarTypes.ts',
            s: {},
            statementMap: {},
        });
    });

    // T-1: the writeCanonicalCoverageArtifacts
    // filter that buckets records per snapshotRoot (`record.snapshotRoot === root`) had never actually
    // run against 2+ roots in this suite -- every prior test used exactly one. A filter that always
    // returned empty, or that returned the same records regardless of root, would have passed every
    // existing assertion (`toHaveLength(1)`, `typeof === 'string'`). This test uses two roots, each
    // with its own distinct source, and independently recomputes each expected digest from the
    // fixture's own known inputs (never by calling the implementation's own digest logic).
    it('RED: snapshotDigests has one independently-verifiable entry per resolved snapshotRoots entry, in resolved-path order', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Baz.ts'), 'export const baz = 1;');

        const artifactRoot = makeScratchDir('artifacts');
        const rootA = join(artifactRoot, 'compiled-dist-a/dist');
        const rootB = join(artifactRoot, 'compiled-dist-b/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const bazScript = join(rootB, 'model/Baz.js');
        writeCompiledScript(fooScript, { sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))] });
        writeCompiledScript(bazScript, { sources: [sourceEntryFor(bazScript, join(repoRoot, 'src/model/Baz.ts'))] });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(fooScript).href }]);
        writeRawCoverage(rawCoverageDir, 'coverage-2.json', [{ url: pathToFileURL(bazScript).href }]);

        const outputDirectory = makeScratchDir('output');
        const { binding } = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA, rootB],
            testRoster: ['test/server/model/foo.test.ts'],
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        // rootA ("compiled-dist-a") sorts before rootB ("compiled-dist-b") -- resolved-path order.
        expect(binding.snapshotDigests).toHaveLength(2);
        const [digestA, digestB] = binding.snapshotDigests;
        // Independently recomputed from the fixture's own known relativeScriptPath:sourcePath pairs,
        // via the same shared sha256Hex primitive -- never by re-deriving the implementation's filter.
        expect(digestA).toBe(sha256Hex(JSON.stringify(['model/Foo.js:src/model/Foo.ts'])));
        expect(digestB).toBe(sha256Hex(JSON.stringify(['model/Baz.js:src/model/Baz.ts'])));
        // The two roots' digests are genuinely distinct -- a filter that always returns the same
        // (or an empty) set for every root would produce two identical values here.
        expect(digestA).not.toBe(digestB);
    });

    it('RED: never reads a pre-existing coverage-final.json/binding sidecar as input -- both are freshly overwritten', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');
        writeJson(join(outputDirectory, 'coverage-final.json'), { 'src/stale-leftover.ts': { s: { '0': 999 } } });
        writeJson(join(outputDirectory, 'coverage-final.binding.json'), {
            converterVersion: 'stale',
            coverageFinalSha256: 'stale',
            rawDumpDigest: 'stale',
            snapshotDigests: ['stale'],
            testRosterDigest: 'stale',
            worktreeContent: 'stale',
        });

        const { coverageMap } = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/bar.test.ts'],
            worktreeContent: CLEAN_WORKTREE_CONTENT,
        });

        expect(coverageMap).not.toHaveProperty('src/stale-leftover.ts');
        expect(coverageMap).toHaveProperty('src/model/Bar.ts');
        const persistedBinding = JSON.parse(
            await readFile(join(outputDirectory, 'coverage-final.binding.json'), 'utf8'),
        );
        expect(persistedBinding.worktreeContent).toEqual(CLEAN_WORKTREE_CONTENT);
        expect(persistedBinding.coverageFinalSha256).not.toBe('stale');
    });

    it.each([
        ['absent', undefined],
        ['not an object', 'abc'],
        ['contentTree not a string or null', { ...CLEAN_WORKTREE_CONTENT, contentTree: 1 }],
        ['contentTree an empty string', { ...CLEAN_WORKTREE_CONTENT, contentTree: '' }],
        ['headTree missing', { contentTree: HEAD_TREE, uncommittedChanges: false }],
        ['uncommittedChanges not a boolean or null', { ...CLEAN_WORKTREE_CONTENT, uncommittedChanges: 'no' }],
    ])('RED (schema-mismatch): rejects a malformed worktreeContent (%s) before writing anything', async (_label, worktreeContent) => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const rawCoverageDir = makeScratchDir('raw');
        const outputDirectory = makeScratchDir('output');

        const reason = await reasonOfAsync(() =>
            writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: ['test/server/model/bar.test.ts'],
                worktreeContent,
            }),
        );

        expect(reason).toBe('schema-mismatch');
        await expect(readFile(join(outputDirectory, 'coverage-final.json'), 'utf8')).rejects.toThrow();
    });

    it('RED (missing-binding-digest): rejects a missing/empty testRoster before writing anything', async () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const rawCoverageDir = makeScratchDir('raw');
        const outputDirectory = makeScratchDir('output');

        const reason = await reasonOfAsync(() =>
            writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: [],
                worktreeContent: CLEAN_WORKTREE_CONTENT,
            }),
        );

        expect(reason).toBe('missing-binding-digest');
        await expect(readFile(join(outputDirectory, 'coverage-final.json'), 'utf8')).rejects.toThrow();
    });

    // The run's verdict is decided by the measured content alone. The worktree content record (content
    // tree, HEAD tree, whether they differ) is only written to the binding sidecar as a statement of what
    // was measured; uncommitted changes and unavailable git never fail the run.
    function writeBarFixture() {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);
        const outputDirectory = makeScratchDir('output');
        return [repoRoot, rootA, rawCoverageDir, outputDirectory] as const;
    }

    it('GREEN: a worktree with uncommitted changes does not fail the run; the binding records the measured content', async () => {
        const [repoRoot, rootA, rawCoverageDir, outputDirectory] = writeBarFixture();

        const { binding, coverageMap } = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/bar.test.ts'],
            worktreeContent: UNCOMMITTED_WORKTREE_CONTENT,
        });

        expect(coverageMap).toHaveProperty('src/model/Bar.ts');
        const persistedBinding = JSON.parse(
            await readFile(join(outputDirectory, 'coverage-final.binding.json'), 'utf8'),
        );
        expect(persistedBinding.worktreeContent).toEqual(UNCOMMITTED_WORKTREE_CONTENT);
        expect(persistedBinding).toEqual(binding);
        expect(persistedBinding).not.toHaveProperty('treeDigest');
        await expect(readFile(join(outputDirectory, 'coverage-final.json'), 'utf8')).resolves.toContain('src/model/Bar.ts');
    });

    it('GREEN: a record git could not produce (every field null) still lets the run through and is recorded as is', async () => {
        const [repoRoot, rootA, rawCoverageDir, outputDirectory] = writeBarFixture();

        const { binding } = await writeCanonicalCoverageArtifacts({
            directory: outputDirectory,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
            testRoster: ['test/server/model/bar.test.ts'],
            worktreeContent: UNRECORDED_WORKTREE_CONTENT,
        });

        expect(binding.worktreeContent).toEqual(UNRECORDED_WORKTREE_CONTENT);
        const persistedBinding = JSON.parse(
            await readFile(join(outputDirectory, 'coverage-final.binding.json'), 'utf8'),
        );
        expect(persistedBinding.worktreeContent).toEqual(UNRECORDED_WORKTREE_CONTENT);
    });

    it('GREEN: the verdict inputs are the same whatever the record says (same coverage map for clean, uncommitted and unrecorded)', async () => {
        const maps = [];
        for (const worktreeContent of [CLEAN_WORKTREE_CONTENT, UNCOMMITTED_WORKTREE_CONTENT, UNRECORDED_WORKTREE_CONTENT]) {
            const [repoRoot, rootA, rawCoverageDir, outputDirectory] = writeBarFixture();
            const { coverageMap } = await writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: ['test/server/model/bar.test.ts'],
                worktreeContent,
            });
            maps.push(JSON.stringify(coverageMap).replaceAll(repoRoot, '<repo>'));
        }
        expect(maps[1]).toBe(maps[0]);
        expect(maps[2]).toBe(maps[0]);
    });

    it('GREEN: coverageIdentityTreeDigest is the content tree, or "unrecorded" when git could not provide it', () => {
        expect(coverageIdentityTreeDigest(CLEAN_WORKTREE_CONTENT)).toBe(HEAD_TREE);
        expect(coverageIdentityTreeDigest(UNCOMMITTED_WORKTREE_CONTENT)).toBe(TREE_DIGEST);
        expect(coverageIdentityTreeDigest(UNRECORDED_WORKTREE_CONTENT)).toBe('unrecorded');
    });

    // S-1: a real rename failure
    // (forced here by pre-creating a directory at the target path, so `rename(temporary, target)`
    // throws EISDIR/ENOTDIR/ENOTEMPTY depending on platform) must not leave the create-exclusive temp
    // file behind in the canonical directory.
    it('RED: cleans up its own temp file when the final rename fails (forced by a pre-existing directory at the target path)', async () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(barScript).href }]);

        const outputDirectory = makeScratchDir('output');
        // A directory (not a file) already occupies the exact path atomicWriteJsonFile will try to
        // rename its temp file onto -- rename() onto an existing directory fails.
        mkdirSync(join(outputDirectory, 'coverage-final.json'));

        await expect(
            writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: ['test/server/model/bar.test.ts'],
                worktreeContent: CLEAN_WORKTREE_CONTENT,
            }),
        ).rejects.toThrow();

        const leftoverTempFiles = readdirSync(outputDirectory).filter(name => name.endsWith('.tmp'));
        expect(leftoverTempFiles).toEqual([]);
    });

    // Under
    // EPGSTATION_COVERAGE_CONVERTER the built-in v8 provider still writes coverage-final.json (its
    // reporter narrows to ['json'], not []) before writeCanonicalCoverageArtifacts ever runs. On the
    // success path that file is simply overwritten. On ANY fail-closed rejection here -- including the
    // early, nothing-yet-written checks like the testRoster check -- that provider-written file must not be
    // left behind un-bound (no sidecar, or a stale sidecar from a previous run) in the canonical
    // directory. Best-effort removal must never replace the real rejection reason with a cleanup error.
    it('RED (missing-binding-digest): removes a pre-existing provider-written coverage-final.json (and any stale sidecar) on fail-closed rejection, without masking the original reason', async () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const rawCoverageDir = makeScratchDir('raw');
        const outputDirectory = makeScratchDir('output');
        // Simulates the built-in v8 provider's own leftover output, written before this function runs.
        writeJson(join(outputDirectory, 'coverage-final.json'), { 'src/provider-leftover.ts': { s: { '0': 1 } } });
        writeJson(join(outputDirectory, 'coverage-final.binding.json'), { stale: true });

        const reason = await reasonOfAsync(() =>
            writeCanonicalCoverageArtifacts({
                directory: outputDirectory,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
                testRoster: [],
                worktreeContent: UNCOMMITTED_WORKTREE_CONTENT,
            }),
        );

        // The original fail-closed reason is preserved, not replaced by a cleanup-related error.
        expect(reason).toBe('missing-binding-digest');
        await expect(readFile(join(outputDirectory, 'coverage-final.json'), 'utf8')).rejects.toThrow();
        await expect(readFile(join(outputDirectory, 'coverage-final.binding.json'), 'utf8')).rejects.toThrow();
    });
});

// A script no test executed has no raw V8 record. That is a measurement gap, never a silent
// exclusion: discovery rejects it (`missing-raw-record`), and source-map staticness rejections fire
// regardless of raw-record presence.
describe('discoverCompiledSnapshotCoverage: a script with no raw record fails closed', () => {
    function twoScriptFixture() {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const barScript = join(rootA, 'model/Bar.js');
        writeCompiledScript(fooScript, { sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))] });
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });

        // Only Foo was actually executed by this shard's tests -- Bar has no raw V8 record at all.
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(fooScript).href }]);

        return { barScript, fooScript, rawCoverageDir, repoRoot, rootA };
    }

    it('a script with no raw record is rejected as missing-raw-record', () => {
        const { rawCoverageDir, repoRoot, rootA } = twoScriptFixture();

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-raw-record');
    });

    it('source-map staticness rejections still fire for a script with no raw record', () => {
        const repoRoot = makeScratchDir('repo');
        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        // No sourceMappingURL comment at all -- a tree defect independent of execution.
        writeFile(scriptPath, '"use strict";\nexports.x = 1;\n');

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', []);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [rootA] }),
            ),
        ).toBe('missing-source-map');
    });
});

/**
 * Target RED: `discoverCompiledSnapshotCoverage` derives one script's
 * statement/branch location *basis* -- which `(startOffset, endOffset)` keys exist in `entries` at all
 * -- directly and only from whatever `functions[].ranges[]` that one call's own `rawCoverageDir` happens
 * to contain. Two shards of the identical candidate tree, run against the identical compiled script +
 * source map, can present raw V8 dumps that disagree on which ranges exist at all (not just which are
 * hit). This is execution-dependent *block granularity*, not function invocation itself (a real V8
 * dump always reports an uninvoked declared function's own extent range; what actually
 * changes on invocation is `isBlockCoverage` flipping `false` -> `true`, after which V8 additionally
 * reports that function's inner block ranges). Both raw fixtures below therefore carry the whole-script
 * top-level range every real `NODE_V8_COVERAGE`/`takePreciseCoverage` dump reports (this
 * range's own `[0, scriptLength)` containment contains every mapping point, so it cannot by itself
 * stand in for a basis) plus a second arm reproducing
 * a second shape (the same mapped statement's raw range starting at the unmapped preamble offset 0 in one
 * shard vs exactly at the first mapping point's own offset in the other -- two different raw-offset
 * identities for one source location). This is still RED, not GREEN: no shared, execution-independent
 * basis mechanism exists yet, so the two `discoverCompiledSnapshotCoverage` calls below -- standing in
 * for two shards of one candidate tree, same snapshotRoots/repositoryRoot, differing only in which
 * ranges their own rawCoverageDir happens to contain -- currently produce two different entry
 * populations for the same script instead of the same basis (sized to this script's own mapping-point
 * count) with only the covered subset (count) differing.
 */
describe('discoverCompiledSnapshotCoverage: shard-independent statement/branch location basis', () => {
    it('RED: two shards of the same candidate tree that observed different real-V8-shaped ranges for the same compiled script must still discover the same statement location basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const fooScript = join(rootA, 'model/Foo.js');
        const fooBody = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
        const fooLine1 = lineStartOffset(fooBody, 1);
        const fooLine2 = lineStartOffset(fooBody, 2);
        writeCompiledScript(fooScript, {
            body: fooBody,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
                { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
            ]),
            sources: [sourceEntryFor(fooScript, join(repoRoot, 'src/model/Foo.ts'))],
        });
        // The whole-script top-level range every real V8 dump reports for a script: read back
        // from the file just written so this matches the actual compiled byte length, not a guess.
        const scriptLength = readFileSync(fooScript, 'utf8').length;
        const innerBlockStart = fooLine2 + 4;
        const innerBlockEnd = fooLine2 + 8;

        // Shard 1: the first statement's range starts at the unmapped preamble offset 0
        // (probe1 shape), and the second statement's enclosing function is reported isBlockCoverage:false
        // with only its own extent range, count 0 -- V8 has not yet flipped it to block granularity.
        const rawCoverageDirShard1 = makeScratchDir('raw-shard-1');
        writeRawCoverage(rawCoverageDirShard1, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: scriptLength, startOffset: 0 }],
                    },
                    {
                        functionName: 'f1',
                        isBlockCoverage: true,
                        ranges: [{ count: 5, endOffset: fooLine2, startOffset: 0 }],
                    },
                    {
                        functionName: 'f2',
                        isBlockCoverage: false,
                        ranges: [{ count: 0, endOffset: fooBody.length, startOffset: fooLine2 }],
                    },
                ],
                url: pathToFileURL(fooScript).href,
            },
        ]);

        // Shard 2: the same first statement's range starts exactly at the first mapping point's own
        // offset instead of 0, and the second statement's enclosing function is isBlockCoverage:true --
        // it was invoked, so V8 additionally reports an inner block range nested inside the same extent.
        const rawCoverageDirShard2 = makeScratchDir('raw-shard-2');
        writeRawCoverage(rawCoverageDirShard2, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: scriptLength, startOffset: 0 }],
                    },
                    {
                        functionName: 'f1',
                        isBlockCoverage: true,
                        ranges: [{ count: 9, endOffset: fooLine2, startOffset: fooLine1 }],
                    },
                    {
                        functionName: 'f2',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 4, endOffset: fooBody.length, startOffset: fooLine2 },
                            { count: 0, endOffset: innerBlockEnd, startOffset: innerBlockStart },
                        ],
                    },
                ],
                url: pathToFileURL(fooScript).href,
            },
        ]);

        const shard1 = discoverCompiledSnapshotCoverage({
            rawCoverageDir: rawCoverageDirShard1,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const shard2 = discoverCompiledSnapshotCoverage({
            rawCoverageDir: rawCoverageDirShard2,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const locationIdsOf = result =>
            result.records[0].entries.map(entry => `${entry.startOffset}:${entry.endOffset}`).sort();

        // Desired shard-independent contract: the same compiled script under the same candidate tree
        // yields the same location basis regardless of which shard's raw V8 dump produced it, sized to
        // this script's own mapping-point count (2 -- neither shard's own raw range count, nor its
        // synthetic-entry count) -- only the per-location count may differ. A raw-offset-identity
        // basis would fail this: it carries both the preamble/mapping-point start divergence and the
        // invoked shard's extra inner-block range straight through, so shard 1's basis would have 3
        // locations and shard 2's 4.
        expect(locationIdsOf(shard1)).toEqual(locationIdsOf(shard2));
        expect(locationIdsOf(shard1)).toHaveLength(2);

        // Per-location count must come only from the shard's own innermost-containing raw range: neither
        // borrowed from the other shard's dump nor read off the whole-script range (count 1, the value
        // that a whole-script-range gate would wrongly apply to every location).
        const countsOf = result =>
            Object.fromEntries(
                result.records[0].entries.map(entry => [`${entry.startOffset}:${entry.endOffset}`, entry.count]),
            );
        expect(countsOf(shard1)).toEqual({ '14:29': 5, '29:44': 0 });
        expect(countsOf(shard2)).toEqual({ '14:29': 9, '29:44': 4 });

        const shard1Map = toCoverageFinalMap(shard1.records);
        const shard2Map = toCoverageFinalMap(shard2.records);
        expect(Object.keys(shard1Map['src/model/Foo.ts'].statementMap).sort()).toEqual(
            Object.keys(shard2Map['src/model/Foo.ts'].statementMap).sort(),
        );
    });

    it('GREEN: two shards of the same candidate tree that differ only in whether a branching function was invoked still discover the same branch location basis', () => {
        // `buildBranchBasisEntries` derives branchEntries from a static parse of the compiled JS, never
        // from whichever functions[].ranges[] this one call's own rawCoverageDir happens to contain --
        // closing the gap buildStatementBasisEntries closes for statements. A
        // real V8 dump only reports a function's inner block ranges once isBlockCoverage flipped true
        // (see the "branch-outcome conversion" suite's isBlockCoverage-false case below), so
        // two shards of the identical candidate tree, same compiled script + source map, differing only
        // in whether that one function was invoked by this shard's own tests, would discover a
        // different branch location population for it -- not merely a different count at the same
        // location.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const body = '"use strict";\nif (x) {\n  y();\n}\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        // Shard 1: the branching function was invoked by this shard's own tests -- isBlockCoverage
        // true, so V8 additionally reports the nested `if`-body block range as its own branch outcome.
        const rawCoverageDirShard1 = makeScratchDir('raw-shard-1');
        writeRawCoverage(rawCoverageDirShard1, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            { count: 0, endOffset: 30, startOffset: 14 },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        // Shard 2: this shard's own tests never reached the function at all -- isBlockCoverage false,
        // only the whole-function extent range, no nested block range at all.
        const rawCoverageDirShard2 = makeScratchDir('raw-shard-2');
        writeRawCoverage(rawCoverageDirShard2, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: false,
                        ranges: [{ count: 0, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const shard1 = discoverCompiledSnapshotCoverage({
            rawCoverageDir: rawCoverageDirShard1,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });
        const shard2 = discoverCompiledSnapshotCoverage({
            rawCoverageDir: rawCoverageDirShard2,
            repositoryRoot: repoRoot,
            snapshotRoots: [rootA],
        });

        const branchLocationIdsOf = result =>
            result.records[0].branchEntries.map(entry => `${entry.startOffset}:${entry.endOffset}`).sort();

        // Shard-independent contract: the same compiled script under the same candidate tree yields the
        // same branch location basis regardless of which shard's raw V8 dump produced it -- sized to
        // this script's own static basis (1 -- the `if`'s single `thenStatement` outcome; there is no
        // `else`), not either shard's own isBlockCoverage-gated raw range count -- only the per-location
        // count may differ.
        expect(branchLocationIdsOf(shard1)).toEqual(branchLocationIdsOf(shard2));
        expect(branchLocationIdsOf(shard1)).toHaveLength(1);

        // Per-location count must never be fabricated from a shard whose own dump has no positive
        // observation of the outcome at all: shard 2 has only ONE range (the whole-function extent,
        // isBlockCoverage:false, count 0) -- the single count rule's innermost-range search has nothing
        // else to pick, so it correctly returns that range's own count, 0 (not a fail-closed rejection,
        // since 0 is not a positive count; never borrowing shard 1's count either).
        const branchCountsOf = result =>
            Object.fromEntries(
                result.records[0].branchEntries.map(entry => [`${entry.startOffset}:${entry.endOffset}`, entry.count]),
            );
        expect(Object.values(branchCountsOf(shard2)).every(count => count === 0)).toBe(true);

        const shard1Map = toCoverageFinalMap(shard1.records);
        const shard2Map = toCoverageFinalMap(shard2.records);
        expect(Object.keys(shard1Map['src/model/Foo.ts'].branchMap).sort()).toEqual(
            Object.keys(shard2Map['src/model/Foo.ts'].branchMap).sort(),
        );
    });
});

/**
 * A TypeScript
 * class+namespace merge emits `(function (X) { ... })(X || (X = {}));` -- the IIFE's sole argument is a
 * merge guard whose `||` right operand, `(X = {})`, is provably unreachable (module evaluation order
 * always binds `X` to the class value before this IIFE runs, so the `||` short-circuits). This residue
 * is excluded from the statement and branch-outcome location basis by an anchored static rule on the
 * compiled JS text alone -- never a raw V8 range, shard, or source map -- so it does not become a
 * permanent fail-closed rejection under a 100% gate. The namespace body itself stays fully coverable.
 */
describe('discoverCompiledSnapshotCoverage: TypeScript class+namespace merge guard exclusion', () => {
    /** One namespace-body statement line plus a merge-guard tail line, with mapping points for both -- the shape real `tsc` class+namespace merge emission produces. */
    function mergeGuardFixture(guardTail: string) {
        const namespaceBodyLine = '    X.FOO = 1;';
        const body = `"use strict";\n(function (X) {\n${namespaceBodyLine}\n${guardTail}`;
        const namespaceBodyColumn = namespaceBodyLine.indexOf('X');
        const guardIdentColumn = guardTail.indexOf('(', guardTail.indexOf('||')) + 1;
        const namespaceBodyStart = lineStartOffset(body, 2) + namespaceBodyColumn;
        const guardIdentOffset = lineStartOffset(body, 3) + guardIdentColumn;
        const mappings = buildMappings([
            { genColumn: namespaceBodyColumn, genLine: 2, srcColumn: 4, srcLine: 1 },
            { genColumn: guardIdentColumn, genLine: 3, srcColumn: 0, srcLine: 0 },
        ]);
        return { body, guardIdentOffset, mappings, namespaceBodyStart };
    }

    function discoverSingle(scriptPath: string, repoRoot: string, rawCoverageDir: string) {
        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [dirname(scriptPath)],
        });
        expect(result.records).toHaveLength(1);
        return result.records[0];
    }

    it('RED: the merge guard tail `})(X || (X = {}));` is excluded from both the statement and branch-outcome basis, while the namespace body statement stays covered', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export namespace Foo {\n    export const FOO = 1;\n}\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const { body, guardIdentOffset, mappings, namespaceBodyStart } = mergeGuardFixture('})(X || (X = {}));');
        const guardStart = body.indexOf('||');

        writeCompiledScript(scriptPath, {
            body,
            mappings,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const record = discoverSingle(scriptPath, repoRoot, rawCoverageDir);

        expect(guardIdentOffset).toBeGreaterThan(guardStart);
        expect(record.entries.some(entry => entry.startOffset >= guardStart)).toBe(false);
        expect(record.entries.some(entry => entry.startOffset === namespaceBodyStart)).toBe(true);
        expect(record.branchEntries).toEqual([]);
    });

    it('GREEN: a product-source `||` default-assignment that is not the sole argument of an IIFE call stays in the statement and branch-outcome basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const a = 1;');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const line1 = 'const a = x || (x = {});';
        const body = `"use strict";\n${line1}`;

        writeCompiledScript(scriptPath, {
            body,
            mappings: buildMappings([{ genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const record = discoverSingle(scriptPath, repoRoot, rawCoverageDir);

        expect(record.entries.length).toBeGreaterThan(0);
        expect(record.branchEntries).toHaveLength(1);
    });

    it('GREEN: `})(X || (Y = {}));` (mismatched identifiers) stays in the statement and branch-outcome basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export namespace Foo {\n    export const FOO = 1;\n}\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const { body, mappings, namespaceBodyStart } = mergeGuardFixture('})(X || (Y = {}));');

        writeCompiledScript(scriptPath, {
            body,
            mappings,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const record = discoverSingle(scriptPath, repoRoot, rawCoverageDir);

        expect(record.entries.some(entry => entry.startOffset === namespaceBodyStart)).toBe(true);
        expect(record.entries.some(entry => entry.startOffset > namespaceBodyStart)).toBe(true);
        expect(record.branchEntries).toHaveLength(1);
    });

    it('GREEN: `})(X || (X = { a: 1 }));` (non-empty right-hand object) stays in the statement and branch-outcome basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export namespace Foo {\n    export const FOO = 1;\n}\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const { body, mappings, namespaceBodyStart } = mergeGuardFixture('})(X || (X = { a: 1 }));');

        writeCompiledScript(scriptPath, {
            body,
            mappings,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [{ url: pathToFileURL(scriptPath).href }]);

        const record = discoverSingle(scriptPath, repoRoot, rawCoverageDir);

        expect(record.entries.some(entry => entry.startOffset === namespaceBodyStart)).toBe(true);
        expect(record.entries.some(entry => entry.startOffset > namespaceBodyStart)).toBe(true);
        expect(record.branchEntries).toHaveLength(1);
    });

    it('RED: the exclusion is a static rule over the compiled JS text, so two shards with different block-coverage granularity discover an identical (post-exclusion) statement and branch basis', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export namespace Foo {\n    export const FOO = 1;\n}\n');

        const rootA = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(rootA, 'model/Foo.js');
        const { body, mappings, namespaceBodyStart } = mergeGuardFixture('})(X || (X = {}));');
        const guardStart = body.indexOf('||');

        writeCompiledScript(scriptPath, {
            body,
            mappings,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });

        // Shard 1: one whole-script isBlockCoverage:true range -- block granularity never split.
        const rawCoverageDirShard1 = makeScratchDir('raw-shard-1');
        writeRawCoverage(rawCoverageDirShard1, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: body.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        // Shard 2: split into a covered preamble range plus an isBlockCoverage:false inner-function
        // extent range covering the namespace body onward -- a different block-coverage granularity for
        // the identical compiled script.
        const rawCoverageDirShard2 = makeScratchDir('raw-shard-2');
        writeRawCoverage(rawCoverageDirShard2, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: namespaceBodyStart, startOffset: 0 }],
                    },
                    {
                        functionName: 'inner',
                        isBlockCoverage: false,
                        ranges: [{ count: 0, endOffset: body.length, startOffset: namespaceBodyStart }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const shard1 = discoverSingle(scriptPath, repoRoot, rawCoverageDirShard1);
        const shard2 = discoverSingle(scriptPath, repoRoot, rawCoverageDirShard2);

        const idsOf = (record: { entries: Array<{ startOffset: number; endOffset: number }> }) =>
            record.entries.map(entry => `${entry.startOffset}:${entry.endOffset}`).sort();
        const branchIdsOf = (record: { branchEntries: Array<{ startOffset: number; endOffset: number }> }) =>
            record.branchEntries.map(entry => `${entry.startOffset}:${entry.endOffset}`).sort();

        expect(idsOf(shard1)).toEqual(idsOf(shard2));
        expect(branchIdsOf(shard1)).toEqual(branchIdsOf(shard2));
        expect(branchIdsOf(shard1)).toEqual([]);
        expect(shard1.entries.some(entry => entry.startOffset >= guardStart)).toBe(false);
        expect(shard2.entries.some(entry => entry.startOffset >= guardStart)).toBe(false);
    });
});

/**
 * Lifecycle-safe registry-fixture positive.
 *
 * Real order: official + isolated byte-identical copy → register run/tree/complete relative path/
 * official+isolated JS+map digests + isolated raw URL candidate → raw V8 URL on isolated path →
 * delete isolated tree → convert with registry identity. Converter must attribute the
 * AddRawExtended `down()` await witness (`[853,859)`) only after full-field identity match —
 * never by URL shape/basename/suffix alone, never by reopening deleted isolated bytes.
 *
 * Fixture writes the registry entry itself and passes `identityRegistryDir` / `runScope` /
 * `treeDigest` into discovery. Without association this is RED
 * (`missing-raw-record`); GREEN requires the fail-closed registry consumer.
 */
describe('discoverCompiledSnapshotCoverage: lifecycle-safe registry-fixture positive', () => {
    const RELATIVE_SCRIPT = 'db/migrations/sqlite/1624085241577-AddRawExtended.js';
    const SOURCE_PATH = 'src/db/migrations/sqlite/1624085241577-AddRawExtended.ts';
    const RUN_SCOPE = 'r2-lifecycle-registry-fixture-run';
    const TREE_DIGEST = 'r2-lifecycle-registry-fixture-tree-digest';
    /** Identity schema version the converter must accept (fail-closed on mismatch). */
    const IDENTITY_SCHEMA_VERSION = 1;

    /** Exact V8/source offsets from the real AddRawExtended witness. */
    const DOWN_START = 819;
    const AWAIT_START = 853;
    const AWAIT_END = 859;
    const DOWN_END = 8343;

    /**
     * Builds a parseable CJS body whose `async down` / first `await ` sit at the real witness
     * offsets, so raw range `[819,8343)` and compiled span `[853,859)` are meaningful.
     */
    function buildWitnessBody(): string {
        const downOpen = 'async down(queryRunner) {\n        ';
        const awaitTok = 'await ';
        const afterAwait = 'queryRunner.query("down");\n';
        const downRangeLen = DOWN_END - DOWN_START;
        const used = downOpen.length + awaitTok.length + afterAwait.length;
        const pad = `/*${'z'.repeat(downRangeLen - used - 4)}*/`;
        const downContent = `${downOpen}${awaitTok}${afterAwait}${pad}`;
        if (downContent.length !== downRangeLen) {
            throw new Error(`down content length ${downContent.length} !== ${downRangeLen}`);
        }

        const baseWithoutIndent =
            '"use strict";\n' +
            'Object.defineProperty(exports, "__esModule", { value: true });\n' +
            'class Migration {\n' +
            '    async up(queryRunner) {\n' +
            '        await queryRunner.query("up");\n' +
            '    }\n';
        const shellLeft = '    pad() { return "';
        const shellRight = '"; }\n    ';
        const fill = DOWN_START - baseWithoutIndent.length - shellLeft.length - shellRight.length;
        if (fill <= 0) {
            throw new Error(`prefix fill non-positive: ${fill}`);
        }
        const prefix = `${baseWithoutIndent}${shellLeft}${'p'.repeat(fill)}${shellRight}`;
        if (prefix.length !== DOWN_START) {
            throw new Error(`prefix length ${prefix.length} !== ${DOWN_START}`);
        }

        const suffix = '\n    }\n}\nexports.AddRawExtended1624085241577 = Migration;\n';
        const body = `${prefix}${downContent}${suffix}`;
        if (body.slice(DOWN_START, DOWN_START + 10) !== 'async down') {
            throw new Error(`DOWN_START marker missing: ${JSON.stringify(body.slice(DOWN_START, DOWN_START + 20))}`);
        }
        if (body.slice(AWAIT_START, AWAIT_END) !== 'await ') {
            throw new Error(`AWAIT span missing: ${JSON.stringify(body.slice(AWAIT_START, AWAIT_END))}`);
        }
        return body;
    }

    /**
     * Writes one authenticated identity entry before isolated cleanup. Mirrors the contract the
     * converter must consume: run/tree scope, complete relative path, official/isolated digests,
     * and the isolated absolute path / file URL candidate. Written as fixture JSON so RED can be
     * observed before the writer helper exists in production code.
     */
    function writeIdentityRegistryEntry(
        registryDir: string,
        fields: {
            officialJsSha256: string;
            officialMapSha256: string;
            isolatedJsSha256: string;
            isolatedMapSha256: string;
            isolatedScriptPath: string;
            isolatedScriptUrl: string;
        },
    ): void {
        writeJson(join(registryDir, 'identity-fixture-positive.json'), {
            schemaVersion: IDENTITY_SCHEMA_VERSION,
            runScope: RUN_SCOPE,
            treeDigest: TREE_DIGEST,
            canonicalRelativeScriptPath: RELATIVE_SCRIPT,
            officialJsSha256: fields.officialJsSha256,
            officialMapSha256: fields.officialMapSha256,
            isolatedJsSha256: fields.isolatedJsSha256,
            isolatedMapSha256: fields.isolatedMapSha256,
            isolatedScriptPath: fields.isolatedScriptPath,
            isolatedScriptUrl: fields.isolatedScriptUrl,
        });
    }

    it('register → raw isolated URL → delete isolated tree → convert attributes official down() [853,859)', () => {
        const repoRoot = makeScratchDir('repo');
        // Source text only needs a stable path under src/**/*.ts; statement basis uses the compiled body.
        writeFile(
            join(repoRoot, SOURCE_PATH),
            [
                'import { MigrationInterface, QueryRunner } from "typeorm";',
                'export class AddRawExtended1624085241577 implements MigrationInterface {',
                '    public async up(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("up");',
                '    }',
                '    public async down(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("down");',
                '    }',
                '}',
                '',
            ].join('\n'),
        );

        const officialRoot = join(makeScratchDir('official'), 'compiled-dist/dist');
        const isolatedRoot = join(makeScratchDir('isolated'), 'compiled-runtime/dist');
        const officialScript = join(officialRoot, ...RELATIVE_SCRIPT.split('/'));
        const isolatedScript = join(isolatedRoot, ...RELATIVE_SCRIPT.split('/'));

        const body = buildWitnessBody();
        // gen line/col for AWAIT_START / AWAIT_END: mapping points bound the exact production
        // witness span [853,859) as one statement-basis entry (converter spans mapping-to-mapping).
        const awaitLine = body.slice(0, AWAIT_START).split('\n').length - 1;
        const awaitCol = AWAIT_START - (body.lastIndexOf('\n', AWAIT_START - 1) + 1);
        const awaitEndCol = AWAIT_END - (body.lastIndexOf('\n', AWAIT_END - 1) + 1);
        const downLine = body.slice(0, DOWN_START).split('\n').length - 1;
        const mappings = buildMappings([
            { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
            { genColumn: 4, genLine: downLine, srcColumn: 4, srcLine: 5 },
            { genColumn: awaitCol, genLine: awaitLine, srcColumn: 8, srcLine: 6 },
            { genColumn: awaitEndCol, genLine: awaitLine, srcColumn: 14, srcLine: 6 },
        ]);

        writeCompiledScript(officialScript, {
            body,
            mappings,
            sources: [sourceEntryFor(officialScript, join(repoRoot, SOURCE_PATH))],
        });
        // Byte-identical isolated copy (same JS + same map bytes).
        const officialJs = readFileSync(officialScript);
        const officialMap = readFileSync(`${officialScript}.map`);
        mkdirSync(dirname(isolatedScript), { recursive: true });
        writeFileSync(isolatedScript, officialJs);
        writeFileSync(`${isolatedScript}.map`, officialMap);

        // Sanity: copies are byte-identical before cleanup.
        expect(readFileSync(isolatedScript).equals(officialJs)).toBe(true);
        expect(readFileSync(`${isolatedScript}.map`).equals(officialMap)).toBe(true);

        const isolatedScriptUrl = pathToFileURL(isolatedScript).href;
        const registryDir = makeScratchDir('identity-registry');
        // Capture digests + isolated raw URL candidate while both trees are still readable.
        writeIdentityRegistryEntry(registryDir, {
            officialJsSha256: sha256Hex(officialJs),
            officialMapSha256: sha256Hex(officialMap),
            isolatedJsSha256: sha256Hex(readFileSync(isolatedScript)),
            isolatedMapSha256: sha256Hex(readFileSync(`${isolatedScript}.map`)),
            isolatedScriptPath: isolatedScript,
            isolatedScriptUrl,
        });

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: body.length, startOffset: 0 },
                            // Real witness topology: down() range [819,8343) count 1.
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                // Raw URL points at the isolated copy (the path that actually ran).
                url: isolatedScriptUrl,
            },
        ]);

        // Real lifecycle order: isolated tree is removed before conversion.
        rmSync(isolatedRoot, { force: true, recursive: true });

        const result = discoverCompiledSnapshotCoverage({
            identityRegistryDir: registryDir,
            rawCoverageDir,
            repositoryRoot: repoRoot,
            runScope: RUN_SCOPE,
            // Converter only sees the official snapshot root (shard mode / run-tests behavior).
            snapshotRoots: [officialRoot],
            treeDigest: TREE_DIGEST,
        });

        // Desired GREEN shape: registry-authenticated isolated raw attributes the official script.
        expect(result.records).toHaveLength(1);
        expect(result.records[0].relativeScriptPath).toBe(RELATIVE_SCRIPT);
        expect(result.records[0].sourcePath).toBe(SOURCE_PATH);

        // down() positive range remains on the official record.
        const downPositive = result.records[0].functions
            .flatMap((fn: { ranges: Array<{ count: number; endOffset: number; startOffset: number }> }) => fn.ranges)
            .filter(
                (range: { count: number; endOffset: number; startOffset: number }) =>
                    range.startOffset === DOWN_START && range.endOffset === DOWN_END && range.count > 0,
            );
        expect(downPositive.length).toBeGreaterThanOrEqual(1);

        // Acceptance: compiled await span [853,859) is present with positive count.
        const awaitEntry = result.records[0].entries.find(
            (entry: { startOffset: number; endOffset: number }) =>
                entry.startOffset === AWAIT_START && entry.endOffset === AWAIT_END,
        );
        expect(awaitEntry).toBeDefined();
        expect(awaitEntry!.count).toBeGreaterThan(0);
    });
});

/**
 * Fail-closed: field-isolated negative matrix + writer/env wiring.
 *
 * Reuses the real AddRawExtended witness geometry. Each negative mutates exactly one identity
 * field (or one lifecycle condition) and must stay unassociated in strict mode
 * (`missing-raw-record`). Hand-written positive fixtures alone are not enough — writer helpers
 * and non-coverage env scrubbing are asserted separately.
 */
describe('discoverCompiledSnapshotCoverage: lifecycle-safe registry fail-closed matrix', () => {
    const RELATIVE_SCRIPT = 'db/migrations/sqlite/1624085241577-AddRawExtended.js';
    const SOURCE_PATH = 'src/db/migrations/sqlite/1624085241577-AddRawExtended.ts';
    const RUN_SCOPE = 'r2-lifecycle-registry-failclosed-run';
    const TREE_DIGEST = 'r2-lifecycle-registry-failclosed-tree';
    const IDENTITY_SCHEMA_VERSION = 1;
    const DOWN_START = 819;
    const AWAIT_START = 853;
    const AWAIT_END = 859;
    const DOWN_END = 8343;
    const VALID_DIGEST_RE = /^[0-9a-f]{64}$/;

    function buildWitnessBody(): string {
        const downOpen = 'async down(queryRunner) {\n        ';
        const awaitTok = 'await ';
        const afterAwait = 'queryRunner.query("down");\n';
        const downRangeLen = DOWN_END - DOWN_START;
        const used = downOpen.length + awaitTok.length + afterAwait.length;
        const pad = `/*${'z'.repeat(downRangeLen - used - 4)}*/`;
        const downContent = `${downOpen}${awaitTok}${afterAwait}${pad}`;
        if (downContent.length !== downRangeLen) {
            throw new Error(`down content length ${downContent.length} !== ${downRangeLen}`);
        }

        const baseWithoutIndent =
            '"use strict";\n' +
            'Object.defineProperty(exports, "__esModule", { value: true });\n' +
            'class Migration {\n' +
            '    async up(queryRunner) {\n' +
            '        await queryRunner.query("up");\n' +
            '    }\n';
        const shellLeft = '    pad() { return "';
        const shellRight = '"; }\n    ';
        const fill = DOWN_START - baseWithoutIndent.length - shellLeft.length - shellRight.length;
        if (fill <= 0) {
            throw new Error(`prefix fill non-positive: ${fill}`);
        }
        const prefix = `${baseWithoutIndent}${shellLeft}${'p'.repeat(fill)}${shellRight}`;
        if (prefix.length !== DOWN_START) {
            throw new Error(`prefix length ${prefix.length} !== ${DOWN_START}`);
        }

        const suffix = '\n    }\n}\nexports.AddRawExtended1624085241577 = Migration;\n';
        const body = `${prefix}${downContent}${suffix}`;
        if (body.slice(DOWN_START, DOWN_START + 10) !== 'async down') {
            throw new Error(`DOWN_START marker missing: ${JSON.stringify(body.slice(DOWN_START, DOWN_START + 20))}`);
        }
        if (body.slice(AWAIT_START, AWAIT_END) !== 'await ') {
            throw new Error(`AWAIT span missing: ${JSON.stringify(body.slice(AWAIT_START, AWAIT_END))}`);
        }
        return body;
    }

    type LifecycleFixture = {
        body: string;
        isolatedRoot: string;
        isolatedScript: string;
        isolatedScriptUrl: string;
        officialJsSha256: string;
        officialMapSha256: string;
        officialRoot: string;
        officialScript: string;
        registryDir: string;
        repoRoot: string;
    };

    function buildLifecycleFixture(): LifecycleFixture {
        const repoRoot = makeScratchDir('repo');
        writeFile(
            join(repoRoot, SOURCE_PATH),
            [
                'import { MigrationInterface, QueryRunner } from "typeorm";',
                'export class AddRawExtended1624085241577 implements MigrationInterface {',
                '    public async up(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("up");',
                '    }',
                '    public async down(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("down");',
                '    }',
                '}',
                '',
            ].join('\n'),
        );

        const officialRoot = join(makeScratchDir('official'), 'compiled-dist/dist');
        const isolatedRoot = join(makeScratchDir('isolated'), 'compiled-runtime/dist');
        const officialScript = join(officialRoot, ...RELATIVE_SCRIPT.split('/'));
        const isolatedScript = join(isolatedRoot, ...RELATIVE_SCRIPT.split('/'));

        const body = buildWitnessBody();
        const awaitLine = body.slice(0, AWAIT_START).split('\n').length - 1;
        const awaitCol = AWAIT_START - (body.lastIndexOf('\n', AWAIT_START - 1) + 1);
        const awaitEndCol = AWAIT_END - (body.lastIndexOf('\n', AWAIT_END - 1) + 1);
        const downLine = body.slice(0, DOWN_START).split('\n').length - 1;
        const mappings = buildMappings([
            { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
            { genColumn: 4, genLine: downLine, srcColumn: 4, srcLine: 5 },
            { genColumn: awaitCol, genLine: awaitLine, srcColumn: 8, srcLine: 6 },
            { genColumn: awaitEndCol, genLine: awaitLine, srcColumn: 14, srcLine: 6 },
        ]);

        writeCompiledScript(officialScript, {
            body,
            mappings,
            sources: [sourceEntryFor(officialScript, join(repoRoot, SOURCE_PATH))],
        });
        const officialJs = readFileSync(officialScript);
        const officialMap = readFileSync(`${officialScript}.map`);
        mkdirSync(dirname(isolatedScript), { recursive: true });
        writeFileSync(isolatedScript, officialJs);
        writeFileSync(`${isolatedScript}.map`, officialMap);

        return {
            body,
            isolatedRoot,
            isolatedScript,
            isolatedScriptUrl: pathToFileURL(isolatedScript).href,
            officialJsSha256: sha256Hex(officialJs),
            officialMapSha256: sha256Hex(officialMap),
            officialRoot,
            officialScript,
            registryDir: makeScratchDir('identity-registry'),
            repoRoot,
        };
    }

    function validEntryFields(fixture: LifecycleFixture) {
        return {
            schemaVersion: IDENTITY_SCHEMA_VERSION,
            runScope: RUN_SCOPE,
            treeDigest: TREE_DIGEST,
            canonicalRelativeScriptPath: RELATIVE_SCRIPT,
            officialJsSha256: fixture.officialJsSha256,
            officialMapSha256: fixture.officialMapSha256,
            isolatedJsSha256: fixture.officialJsSha256,
            isolatedMapSha256: fixture.officialMapSha256,
            isolatedScriptPath: fixture.isolatedScript,
            isolatedScriptUrl: fixture.isolatedScriptUrl,
        };
    }

    function writeRegistryEntry(registryDir: string, entry: Record<string, unknown>, fileName = 'identity-entry.json'): void {
        writeJson(join(registryDir, fileName), entry);
    }

    function writeIsolatedRaw(rawCoverageDir: string, fixture: LifecycleFixture, url = fixture.isolatedScriptUrl): void {
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: fixture.body.length, startOffset: 0 },
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                url,
            },
        ]);
    }

    function discoverStrictAfterCleanup(
        fixture: LifecycleFixture,
        entry: Record<string, unknown> | null,
        {
            deleteIsolated = true,
            runScope = RUN_SCOPE,
            treeDigest = TREE_DIGEST,
            rawUrl,
        }: {
            deleteIsolated?: boolean;
            runScope?: string;
            treeDigest?: string;
            rawUrl?: string;
        } = {},
    ): string | undefined {
        if (entry !== null) {
            writeRegistryEntry(fixture.registryDir, entry);
        }
        const rawCoverageDir = makeScratchDir('raw');
        writeIsolatedRaw(rawCoverageDir, fixture, rawUrl ?? fixture.isolatedScriptUrl);
        if (deleteIsolated) {
            rmSync(fixture.isolatedRoot, { force: true, recursive: true });
        }
        return reasonOf(() =>
            discoverCompiledSnapshotCoverage({
                identityRegistryDir: fixture.registryDir,
                rawCoverageDir,
                repositoryRoot: fixture.repoRoot,
                runScope,
                snapshotRoots: [fixture.officialRoot],
                treeDigest,
            }),
        );
    }

    const OTHER_DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const BAD_DIGEST = 'not-a-sha256-digest';

    it.each([
        {
            name: 'missing registry directory yields missing-raw-record',
            mutate: (fixture: LifecycleFixture) => {
                // Point discovery at an empty/missing registry: leave registry empty (no entry written).
                void fixture;
                return null;
            },
        },
        {
            name: 'corrupt JSON is ignored (missing-raw-record)',
            mutate: (fixture: LifecycleFixture) => {
                writeFile(join(fixture.registryDir, 'identity-corrupt.json'), '{not-json');
                return null; // already written non-JSON; discoverStrictAfterCleanup null path won't rewrite
            },
            special: 'corrupt-json' as const,
        },
        {
            name: 'schemaVersion mismatch',
            mutate: (fixture: LifecycleFixture) => ({ ...validEntryFields(fixture), schemaVersion: 999 }),
        },
        {
            name: 'empty runScope',
            mutate: (fixture: LifecycleFixture) => ({ ...validEntryFields(fixture), runScope: '' }),
        },
        {
            name: 'runScope mismatch',
            mutate: (fixture: LifecycleFixture) => ({ ...validEntryFields(fixture), runScope: 'other-run' }),
        },
        {
            name: 'empty treeDigest',
            mutate: (fixture: LifecycleFixture) => ({ ...validEntryFields(fixture), treeDigest: '' }),
        },
        {
            name: 'treeDigest mismatch',
            mutate: (fixture: LifecycleFixture) => ({ ...validEntryFields(fixture), treeDigest: 'other-tree' }),
        },
        {
            name: 'canonicalRelativeScriptPath mismatch',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                canonicalRelativeScriptPath: 'db/migrations/sqlite/other.js',
            }),
        },
        {
            name: 'canonicalRelativeScriptPath basename-only',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                canonicalRelativeScriptPath: '1624085241577-AddRawExtended.js',
            }),
        },
        {
            name: 'official JS digest mismatch vs disk',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                officialJsSha256: OTHER_DIGEST,
                isolatedJsSha256: OTHER_DIGEST,
            }),
        },
        {
            name: 'official map digest mismatch vs disk',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                officialMapSha256: OTHER_DIGEST,
                isolatedMapSha256: OTHER_DIGEST,
            }),
        },
        {
            name: 'stored isolated JS digests differ from official after cleanup (cross-pair)',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                isolatedJsSha256: OTHER_DIGEST,
            }),
        },
        {
            name: 'stored isolated map digests differ from official after cleanup (cross-pair)',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                isolatedMapSha256: OTHER_DIGEST,
            }),
        },
        {
            name: 'official JS digest not exact sha256 hex',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                officialJsSha256: BAD_DIGEST,
                isolatedJsSha256: BAD_DIGEST,
            }),
        },
        {
            name: 'isolated JS digest not exact sha256 hex',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                isolatedJsSha256: BAD_DIGEST,
            }),
        },
        {
            name: 'URL/path mismatch (file URL does not resolve to isolatedScriptPath)',
            mutate: (fixture: LifecycleFixture) => ({
                ...validEntryFields(fixture),
                isolatedScriptUrl: pathToFileURL(join(fixture.isolatedRoot, 'other.js')).href,
            }),
        },
        {
            name: 'suffix-only path must not associate (wrong absolute path)',
            mutate: (fixture: LifecycleFixture) => {
                const decoy = join(makeScratchDir('decoy'), '1624085241577-AddRawExtended.js');
                return {
                    ...validEntryFields(fixture),
                    isolatedScriptPath: decoy,
                    isolatedScriptUrl: pathToFileURL(decoy).href,
                };
            },
        },
    ])('negative one-field: $name → missing-raw-record', ({ mutate, special, name }) => {
        const fixture = buildLifecycleFixture();
        if (special === 'corrupt-json') {
            mutate(fixture);
            const reason = discoverStrictAfterCleanup(fixture, null);
            expect(reason, name).toBe('missing-raw-record');
            return;
        }
        const entry = mutate(fixture);
        const reason = discoverStrictAfterCleanup(fixture, entry);
        expect(reason, name).toBe('missing-raw-record');
    });

    it('positive: two byte-identical isolated runtimes for same canonical merge additively after cleanup', () => {
        // Frozen witness shape: many compiled-runtime-* paths for one canonical script must merge,
        // not all be marked conflicted. Distinct isolated paths + matching digests = additive.
        const fixture = buildLifecycleFixture();
        const officialJs = readFileSync(fixture.officialScript);
        const officialMap = readFileSync(`${fixture.officialScript}.map`);

        const isolatedRoot2 = join(makeScratchDir('isolated-b'), 'compiled-runtime/dist');
        const isolatedScript2 = join(isolatedRoot2, ...RELATIVE_SCRIPT.split('/'));
        mkdirSync(dirname(isolatedScript2), { recursive: true });
        writeFileSync(isolatedScript2, officialJs);
        writeFileSync(`${isolatedScript2}.map`, officialMap);
        const isolatedUrl2 = pathToFileURL(isolatedScript2).href;

        const entryA = validEntryFields(fixture);
        const entryB = {
            ...validEntryFields(fixture),
            isolatedScriptPath: isolatedScript2,
            isolatedScriptUrl: isolatedUrl2,
        };
        writeRegistryEntry(fixture.registryDir, entryA, 'identity-a.json');
        writeRegistryEntry(fixture.registryDir, entryB, 'identity-b.json');

        const rawCoverageDir = makeScratchDir('raw-multi');
        writeRawCoverage(rawCoverageDir, 'coverage-a.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: fixture.body.length, startOffset: 0 },
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                url: fixture.isolatedScriptUrl,
            },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-b.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: fixture.body.length, startOffset: 0 },
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                url: isolatedUrl2,
            },
        ]);

        rmSync(fixture.isolatedRoot, { force: true, recursive: true });
        rmSync(isolatedRoot2, { force: true, recursive: true });

        const result = discoverCompiledSnapshotCoverage({
            identityRegistryDir: fixture.registryDir,
            rawCoverageDir,
            repositoryRoot: fixture.repoRoot,
            runScope: RUN_SCOPE,
            snapshotRoots: [fixture.officialRoot],
            treeDigest: TREE_DIGEST,
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].relativeScriptPath).toBe(RELATIVE_SCRIPT);
        const awaitEntry = result.records[0].entries.find(
            (entry: { startOffset: number; endOffset: number; count: number }) =>
                entry.startOffset === AWAIT_START && entry.endOffset === AWAIT_END,
        );
        expect(awaitEntry).toBeDefined();
        // Two runtimes each contributed count 1 → deterministic additive merge of record-local ranges.
        expect(awaitEntry!.count).toBe(2);
    });

    it('negative: same isolated path with disagreeing identity is conflicted; unrelated runtime still associates', () => {
        // Conflict boundary is the isolated-path binding, not the whole canonical script.
        const fixture = buildLifecycleFixture();
        const good = validEntryFields(fixture);

        // Unrelated valid runtime at a different isolated path — must remain associated.
        const isolatedRootOther = join(makeScratchDir('isolated-ok'), 'compiled-runtime/dist');
        const isolatedScriptOther = join(isolatedRootOther, ...RELATIVE_SCRIPT.split('/'));
        mkdirSync(dirname(isolatedScriptOther), { recursive: true });
        writeFileSync(isolatedScriptOther, readFileSync(fixture.officialScript));
        writeFileSync(`${isolatedScriptOther}.map`, readFileSync(`${fixture.officialScript}.map`));
        const otherUrl = pathToFileURL(isolatedScriptOther).href;

        // True conflict: identical isolated path, disagreeing digest identity (still cross-pair equal
        // within each entry so both pass the loader schema gate before conflict marking).
        const conflictPath = fixture.isolatedScript;
        const conflictUrl = fixture.isolatedScriptUrl;
        writeRegistryEntry(
            fixture.registryDir,
            {
                ...good,
                isolatedScriptPath: conflictPath,
                isolatedScriptUrl: conflictUrl,
            },
            'identity-conflict-a.json',
        );
        writeRegistryEntry(
            fixture.registryDir,
            {
                ...good,
                officialJsSha256: OTHER_DIGEST,
                officialMapSha256: OTHER_DIGEST,
                isolatedJsSha256: OTHER_DIGEST,
                isolatedMapSha256: OTHER_DIGEST,
                isolatedScriptPath: conflictPath,
                isolatedScriptUrl: conflictUrl,
            },
            'identity-conflict-b.json',
        );
        writeRegistryEntry(
            fixture.registryDir,
            {
                ...good,
                isolatedScriptPath: isolatedScriptOther,
                isolatedScriptUrl: otherUrl,
            },
            'identity-ok.json',
        );

        const rawCoverageDir = makeScratchDir('raw-binding-conflict');
        // Raw for conflicted path (must stay unassociated) and for the unrelated good path.
        writeRawCoverage(rawCoverageDir, 'coverage-conflict.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: fixture.body.length, startOffset: 0 },
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                url: conflictUrl,
            },
        ]);
        writeRawCoverage(rawCoverageDir, 'coverage-ok.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: fixture.body.length, startOffset: 0 },
                            { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                        ],
                    },
                ],
                url: otherUrl,
            },
        ]);

        rmSync(fixture.isolatedRoot, { force: true, recursive: true });
        rmSync(isolatedRootOther, { force: true, recursive: true });

        const result = discoverCompiledSnapshotCoverage({
            identityRegistryDir: fixture.registryDir,
            rawCoverageDir,
            repositoryRoot: fixture.repoRoot,
            runScope: RUN_SCOPE,
            snapshotRoots: [fixture.officialRoot],
            treeDigest: TREE_DIGEST,
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].relativeScriptPath).toBe(RELATIVE_SCRIPT);
        const awaitEntry = result.records[0].entries.find(
            (entry: { startOffset: number; endOffset: number; count: number }) =>
                entry.startOffset === AWAIT_START && entry.endOffset === AWAIT_END,
        );
        expect(awaitEntry).toBeDefined();
        // Only the unrelated valid runtime contributes (conflicted binding rejected).
        expect(awaitEntry!.count).toBe(1);
    });

    it('negative: drifted isolated bytes still present before cleanup stay unassociated', () => {
        const fixture = buildLifecycleFixture();
        // Mutate isolated JS after digests were captured for a matching registry entry that stores
        // the original equal digests — live re-check must reject.
        writeFileSync(fixture.isolatedScript, `${readFileSync(fixture.isolatedScript, 'utf8')}\n`);
        const entry = {
            ...validEntryFields(fixture),
            // Store pre-drift digests (official still matches registry; isolated disk does not).
        };
        const reason = discoverStrictAfterCleanup(fixture, entry, { deleteIsolated: false });
        expect(reason).toBe('missing-raw-record');
    });

    it('writer writeIsolatedRuntimeIdentityEntry rejects official/isolated JS cross-pair mismatch', () => {
        const fixture = buildLifecycleFixture();
        expect(() =>
            writeIsolatedRuntimeIdentityEntry({
                registryDir: fixture.registryDir,
                runScope: RUN_SCOPE,
                treeDigest: TREE_DIGEST,
                canonicalRelativeScriptPath: RELATIVE_SCRIPT,
                officialJsSha256: fixture.officialJsSha256,
                officialMapSha256: fixture.officialMapSha256,
                isolatedJsSha256: OTHER_DIGEST,
                isolatedMapSha256: fixture.officialMapSha256,
                isolatedScriptPath: fixture.isolatedScript,
                isolatedScriptUrl: fixture.isolatedScriptUrl,
            }),
        ).toThrow(/cross-pair|digest|mismatch|official|isolated/i);
    });

    it('writer writeIsolatedRuntimeIdentityEntry rejects non-sha256 digest format', () => {
        const fixture = buildLifecycleFixture();
        expect(() =>
            writeIsolatedRuntimeIdentityEntry({
                registryDir: fixture.registryDir,
                runScope: RUN_SCOPE,
                treeDigest: TREE_DIGEST,
                canonicalRelativeScriptPath: RELATIVE_SCRIPT,
                officialJsSha256: BAD_DIGEST,
                officialMapSha256: fixture.officialMapSha256,
                isolatedJsSha256: BAD_DIGEST,
                isolatedMapSha256: fixture.officialMapSha256,
                isolatedScriptPath: fixture.isolatedScript,
                isolatedScriptUrl: fixture.isolatedScriptUrl,
            }),
        ).toThrow(/sha256|digest|hex/i);
    });

    it('registerIsolatedRuntimeScriptIdentities skips scripts whose isolated digests differ from official', () => {
        const fixture = buildLifecycleFixture();
        // Drift isolated JS bytes so digests diverge while still readable.
        writeFileSync(fixture.isolatedScript, `${readFileSync(fixture.isolatedScript, 'utf8')}\n//drift\n`);
        const written = registerIsolatedRuntimeScriptIdentities({
            registryDir: fixture.registryDir,
            runScope: RUN_SCOPE,
            treeDigest: TREE_DIGEST,
            officialSnapshotRoot: fixture.officialRoot,
            isolatedSnapshotRoot: fixture.isolatedRoot,
        });
        expect(written).toEqual([]);
        expect(loadIsolatedRuntimeIdentityEntries(fixture.registryDir)).toEqual([]);
    });

    it('real writer lifecycle: register → raw isolated URL → cleanup → convert (not hand-written JSON)', () => {
        const fixture = buildLifecycleFixture();
        const written = registerIsolatedRuntimeScriptIdentities({
            registryDir: fixture.registryDir,
            runScope: RUN_SCOPE,
            treeDigest: TREE_DIGEST,
            officialSnapshotRoot: fixture.officialRoot,
            isolatedSnapshotRoot: fixture.isolatedRoot,
        });
        expect(written.length).toBeGreaterThanOrEqual(1);
        const entries = loadIsolatedRuntimeIdentityEntries(fixture.registryDir);
        expect(entries.length).toBeGreaterThanOrEqual(1);
        for (const entry of entries) {
            expect(entry.officialJsSha256).toMatch(VALID_DIGEST_RE);
            expect(entry.isolatedJsSha256).toBe(entry.officialJsSha256);
            expect(entry.isolatedMapSha256).toBe(entry.officialMapSha256);
        }

        const rawCoverageDir = makeScratchDir('raw');
        writeIsolatedRaw(rawCoverageDir, fixture);
        rmSync(fixture.isolatedRoot, { force: true, recursive: true });

        const result = discoverCompiledSnapshotCoverage({
            identityRegistryDir: fixture.registryDir,
            rawCoverageDir,
            repositoryRoot: fixture.repoRoot,
            runScope: RUN_SCOPE,
            snapshotRoots: [fixture.officialRoot],
            treeDigest: TREE_DIGEST,
        });
        expect(result.records).toHaveLength(1);
        expect(result.records[0].relativeScriptPath).toBe(RELATIVE_SCRIPT);
        const awaitEntry = result.records[0].entries.find(
            (entry: { startOffset: number; endOffset: number }) =>
                entry.startOffset === AWAIT_START && entry.endOffset === AWAIT_END,
        );
        expect(awaitEntry).toBeDefined();
        expect(awaitEntry!.count).toBeGreaterThan(0);
    });

    it('env registration no-ops when registry env is unset (coverage-outside)', () => {
        const fixture = buildLifecycleFixture();
        const previous = {
            registry: process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV],
            runScope: process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV],
            tree: process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV],
        };
        try {
            delete process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV];
            delete process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV];
            delete process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV];
            const written = registerIsolatedRuntimeIdentitiesFromEnv({
                officialSnapshotRoot: fixture.officialRoot,
                isolatedSnapshotRoot: fixture.isolatedRoot,
            });
            expect(written).toEqual([]);
        } finally {
            if (previous.registry === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV] = previous.registry;
            }
            if (previous.runScope === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV] = previous.runScope;
            }
            if (previous.tree === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV] = previous.tree;
            }
        }
    });

    it('scrubIsolatedRuntimeIdentityEnv removes all three registry variables from child env', () => {
        const scrub = (
            compiledSnapshotCoverage as {
                scrubIsolatedRuntimeIdentityEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
            }
        ).scrubIsolatedRuntimeIdentityEnv;
        expect(typeof scrub).toBe('function');
        const scrubbed = scrub!({
            KEEP: 'yes',
            [ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]: '/tmp/hostile-registry',
            [ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]: 'hostile-run',
            [ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]: 'hostile-tree',
        });
        expect(scrubbed.KEEP).toBe('yes');
        expect(scrubbed[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).toBeUndefined();
        expect(scrubbed[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]).toBeUndefined();
        expect(scrubbed[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBeUndefined();
    });
});

/**
 * Actual runner/harness wiring probe.
 *
 * Must traverse:
 * 1. `scripts/server-test/run-tests.mjs` exported env construction (scrub + coverage-only assign)
 * 2. `createIsolatedCompiledRuntime` registration callsite after copy / before cleanup
 * then raw isolated URL → cleanup → discover conversion.
 *
 * Direct helper-only calls (`scrubIsolatedRuntimeIdentityEnv` /
 * `registerIsolatedRuntimeIdentitiesFromEnv` alone) do not satisfy this probe.
 * Removing either production callsite must make this RED.
 */
describe('discoverCompiledSnapshotCoverage: actual runner/harness wiring probe', () => {
    const RELATIVE_SCRIPT = 'db/migrations/sqlite/1624085241577-AddRawExtended.js';
    const SOURCE_PATH = 'src/db/migrations/sqlite/1624085241577-AddRawExtended.ts';
    const TREE_DIGEST = 'r2-lifecycle-wiring-probe-tree';
    const DOWN_START = 819;
    const AWAIT_START = 853;
    const AWAIT_END = 859;
    const DOWN_END = 8343;

    function buildWitnessBody(): string {
        const downOpen = 'async down(queryRunner) {\n        ';
        const awaitTok = 'await ';
        const afterAwait = 'queryRunner.query("down");\n';
        const downRangeLen = DOWN_END - DOWN_START;
        const used = downOpen.length + awaitTok.length + afterAwait.length;
        const pad = `/*${'z'.repeat(downRangeLen - used - 4)}*/`;
        const downContent = `${downOpen}${awaitTok}${afterAwait}${pad}`;
        if (downContent.length !== downRangeLen) {
            throw new Error(`down content length ${downContent.length} !== ${downRangeLen}`);
        }

        const baseWithoutIndent =
            '"use strict";\n' +
            'Object.defineProperty(exports, "__esModule", { value: true });\n' +
            'class Migration {\n' +
            '    async up(queryRunner) {\n' +
            '        await queryRunner.query("up");\n' +
            '    }\n';
        const shellLeft = '    pad() { return "';
        const shellRight = '"; }\n    ';
        const fill = DOWN_START - baseWithoutIndent.length - shellLeft.length - shellRight.length;
        if (fill <= 0) {
            throw new Error(`prefix fill non-positive: ${fill}`);
        }
        const prefix = `${baseWithoutIndent}${shellLeft}${'p'.repeat(fill)}${shellRight}`;
        if (prefix.length !== DOWN_START) {
            throw new Error(`prefix length ${prefix.length} !== ${DOWN_START}`);
        }

        const suffix = '\n    }\n}\nexports.AddRawExtended1624085241577 = Migration;\n';
        const body = `${prefix}${downContent}${suffix}`;
        if (body.slice(DOWN_START, DOWN_START + 10) !== 'async down') {
            throw new Error(`DOWN_START marker missing: ${JSON.stringify(body.slice(DOWN_START, DOWN_START + 20))}`);
        }
        if (body.slice(AWAIT_START, AWAIT_END) !== 'await ') {
            throw new Error(`AWAIT span missing: ${JSON.stringify(body.slice(AWAIT_START, AWAIT_END))}`);
        }
        return body;
    }

    it('runner env construction + createIsolatedCompiledRuntime copy→capture→cleanup→convert', async () => {
        // Actual runner module (not a reimplemented scrub). Import must be safe under auditor
        // and must expose the production env-construction seam used by runAgainstCompiledSnapshot.
        const runner = await import('../../../../scripts/server-test/run-tests.mjs');
        const buildServerTestChildEnvironment = (
            runner as {
                buildServerTestChildEnvironment?: (input: {
                    mode: string;
                    compiledSnapshot: string;
                    rawCoverageDirectory?: string;
                    processEnv?: NodeJS.ProcessEnv;
                    treeDigest?: string;
                }) => {
                    testEnvironment: NodeJS.ProcessEnv;
                    identityRegistryDir?: string;
                    coverageRunScope?: string;
                    coverageTreeDigest?: string;
                };
            }
        ).buildServerTestChildEnvironment;
        expect(typeof buildServerTestChildEnvironment).toBe('function');

        const repoRoot = makeScratchDir('wiring-repo');
        writeFile(
            join(repoRoot, SOURCE_PATH),
            [
                'import { MigrationInterface, QueryRunner } from "typeorm";',
                'export class AddRawExtended1624085241577 implements MigrationInterface {',
                '    public async up(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("up");',
                '    }',
                '    public async down(queryRunner: QueryRunner): Promise<void> {',
                '        await queryRunner.query("down");',
                '    }',
                '}',
                '',
            ].join('\n'),
        );

        // Minimal compiled snapshot: migration witness + dummy DBOperator so harness can load.
        const officialRoot = join(makeScratchDir('wiring-official'), 'compiled-dist/dist');
        const officialScript = join(officialRoot, ...RELATIVE_SCRIPT.split('/'));
        const body = buildWitnessBody();
        const awaitLine = body.slice(0, AWAIT_START).split('\n').length - 1;
        const awaitCol = AWAIT_START - (body.lastIndexOf('\n', AWAIT_START - 1) + 1);
        const awaitEndCol = AWAIT_END - (body.lastIndexOf('\n', AWAIT_END - 1) + 1);
        const downLine = body.slice(0, DOWN_START).split('\n').length - 1;
        const mappings = buildMappings([
            { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
            { genColumn: 4, genLine: downLine, srcColumn: 4, srcLine: 5 },
            { genColumn: awaitCol, genLine: awaitLine, srcColumn: 8, srcLine: 6 },
            { genColumn: awaitEndCol, genLine: awaitLine, srcColumn: 14, srcLine: 6 },
        ]);
        writeCompiledScript(officialScript, {
            body,
            mappings,
            sources: [sourceEntryFor(officialScript, join(repoRoot, SOURCE_PATH))],
        });
        // Harness module loads DBOperator at import; discovery also walks every .js under the
        // snapshot, so this stub must have a readable source map and a matching raw record.
        const dbOperatorSource = join(repoRoot, 'src/model/db/DBOperator.ts');
        writeFile(dbOperatorSource, 'export default class DBOperator {}\n');
        const dbOperatorScript = join(officialRoot, 'model/db/DBOperator.js');
        const dbOperatorBody = '"use strict";\nclass DBOperator {}\nexports.default = DBOperator;\n';
        writeCompiledScript(dbOperatorScript, {
            body: dbOperatorBody,
            mappings: buildMappings([{ genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(dbOperatorScript, dbOperatorSource)],
        });

        const rawCoverageDir = makeScratchDir('wiring-raw');
        const nonCoverage = buildServerTestChildEnvironment!({
            mode: 'imp',
            compiledSnapshot: officialRoot,
            processEnv: {
                KEEP: 'yes',
                [ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]: '/tmp/hostile-registry',
                [ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]: 'hostile-run',
                [ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]: 'hostile-tree',
            },
        });
        expect(nonCoverage.testEnvironment.KEEP).toBe('yes');
        expect(nonCoverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).toBeUndefined();
        expect(nonCoverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]).toBeUndefined();
        expect(nonCoverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBeUndefined();

        const coverage = buildServerTestChildEnvironment!({
            mode: 'coverage',
            compiledSnapshot: officialRoot,
            rawCoverageDirectory: rawCoverageDir,
            treeDigest: TREE_DIGEST,
            processEnv: {
                [ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]: '/tmp/hostile-registry',
                [ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]: 'hostile-run',
                [ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]: 'hostile-tree',
            },
        });
        expect(coverage.identityRegistryDir).toBe(join(rawCoverageDir, 'isolated-runtime-identity'));
        expect(coverage.coverageRunScope).toBe(rawCoverageDir.split(/[/\\]/u).pop());
        expect(coverage.coverageTreeDigest).toBe(TREE_DIGEST);
        expect(coverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).toBe(coverage.identityRegistryDir);
        expect(coverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]).toBe(coverage.coverageRunScope);
        expect(coverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBe(TREE_DIGEST);
        expect(coverage.testEnvironment[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).not.toBe('/tmp/hostile-registry');

        mkdirSync(coverage.identityRegistryDir!, { recursive: true });

        const previousEnv = {
            snapshot: process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT,
            registry: process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV],
            runScope: process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV],
            tree: process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV],
        };
        process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT = officialRoot;
        process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV] = coverage.identityRegistryDir!;
        process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV] = coverage.coverageRunScope!;
        process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV] = TREE_DIGEST;

        try {
            // Actual harness callsite (not registerIsolatedRuntimeIdentitiesFromEnv directly).
            const harness = await import('../../persistence/harness');
            const runtime = await harness.createIsolatedCompiledRuntime({
                // Copy the fixture official tree; loadOperator stub avoids real DBOperator construct.
                loadOperator: () =>
                    class DummyOperator {
                        checkConnection(): Promise<void> {
                            return Promise.resolve();
                        }
                        closeConnection(): Promise<void> {
                            return Promise.resolve();
                        }
                        getConnection(): Promise<never> {
                            return Promise.reject(new Error('not used'));
                        }
                    } as never,
            });

            const isolatedScript = join(runtime.compiledSnapshot, ...RELATIVE_SCRIPT.split('/'));
            expect(readdirSync(coverage.identityRegistryDir!).some(name => name.endsWith('.json'))).toBe(true);

            writeRawCoverage(rawCoverageDir, 'coverage-wiring-1.json', [
                {
                    functions: [
                        {
                            functionName: '',
                            isBlockCoverage: true,
                            ranges: [
                                { count: 1, endOffset: body.length, startOffset: 0 },
                                { count: 1, endOffset: DOWN_END, startOffset: DOWN_START },
                            ],
                        },
                    ],
                    // Isolated path for the migration witness (registry-authenticated after cleanup).
                    url: pathToFileURL(isolatedScript).href,
                },
                {
                    functions: [
                        {
                            functionName: '',
                            isBlockCoverage: true,
                            ranges: [{ count: 1, endOffset: dbOperatorBody.length, startOffset: 0 }],
                        },
                    ],
                    // Exact official path for the harness load stub (still present at conversion).
                    url: pathToFileURL(dbOperatorScript).href,
                },
            ]);

            await runtime.cleanup();

            const result = discoverCompiledSnapshotCoverage({
                identityRegistryDir: coverage.identityRegistryDir,
                rawCoverageDir,
                repositoryRoot: repoRoot,
                runScope: coverage.coverageRunScope,
                snapshotRoots: [officialRoot],
                treeDigest: TREE_DIGEST,
            });
            expect(result.records.length).toBeGreaterThanOrEqual(1);
            const migration = result.records.find(
                (record: { relativeScriptPath: string }) => record.relativeScriptPath === RELATIVE_SCRIPT,
            );
            expect(migration).toBeDefined();
            const awaitEntry = migration!.entries.find(
                (entry: { startOffset: number; endOffset: number }) =>
                    entry.startOffset === AWAIT_START && entry.endOffset === AWAIT_END,
            );
            expect(awaitEntry).toBeDefined();
            expect(awaitEntry!.count).toBeGreaterThan(0);
        } finally {
            if (previousEnv.snapshot === undefined) {
                delete process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
            } else {
                process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT = previousEnv.snapshot;
            }
            if (previousEnv.registry === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV] = previousEnv.registry;
            }
            if (previousEnv.runScope === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV] = previousEnv.runScope;
            }
            if (previousEnv.tree === undefined) {
                delete process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV];
            } else {
                process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV] = previousEnv.tree;
            }
        }
    });
});

/**
 * Runner-callsite wiring.
 *
 * Must execute `runAgainstCompiledSnapshot` (production path), not only the exported
 * `buildServerTestChildEnvironment` helper. Inject process/test deps so no coverage run starts.
 * Removing the builder call from `runAgainstCompiledSnapshot` must make this RED.
 * Direct CLI entry must still run `main` (invalid mode → Unknown server test mode).
 * Leaves the harness wiring probe above unchanged.
 */
describe('run-tests.mjs: runAgainstCompiledSnapshot production connection', () => {
    const TREE_DIGEST = 'r2-runner-callsite-tree-digest';

    it('coverage path: builder → child env identity triple + conversion forward', async () => {
        const runner = await import('../../../../scripts/server-test/run-tests.mjs');
        const runAgainstCompiledSnapshot = (
            runner as {
                runAgainstCompiledSnapshot?: (input: {
                    compiledSnapshot: string;
                    filters: string[];
                    rawCoverageDirectory: string;
                    worktreeContent: Record<string, unknown>;
                    dependencies?: Record<string, unknown>;
                }) => Promise<void>;
            }
        ).runAgainstCompiledSnapshot;
        expect(typeof runAgainstCompiledSnapshot).toBe('function');

        const compiledSnapshot = makeScratchDir('runner-callsite-snapshot');
        const rawCoverageDirectory = makeScratchDir('runner-callsite-raw');
        const expectedRegistry = join(rawCoverageDirectory, 'isolated-runtime-identity');
        const expectedRunScope = rawCoverageDirectory.split(/[/\\]/u).pop()!;

        let capturedChildEnv: NodeJS.ProcessEnv | undefined;
        let capturedConversion: {
            identityRegistryDir?: string;
            runScope?: string;
            worktreeContent?: unknown;
        } | undefined;
        let mkdirSeen: string | undefined;

        await runAgainstCompiledSnapshot!({
            compiledSnapshot,
            filters: [],
            rawCoverageDirectory,
            worktreeContent: { contentTree: TREE_DIGEST, headTree: HEAD_TREE, uncommittedChanges: true },
            dependencies: {
                mode: 'coverage',
                processEnv: {
                    KEEP: 'yes',
                    [ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]: '/tmp/hostile-registry',
                    [ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]: 'hostile-run',
                    [ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]: 'hostile-tree',
                },
                enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                mkdir: async (path: string) => {
                    mkdirSeen = path;
                },
                run: async (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
                    capturedChildEnv = options.env;
                },
                writeCanonicalCoverageArtifacts: async (input: {
                    identityRegistryDir?: string;
                    runScope?: string;
                    worktreeContent?: unknown;
                }) => {
                    capturedConversion = {
                        identityRegistryDir: input.identityRegistryDir,
                        runScope: input.runScope,
                        worktreeContent: input.worktreeContent,
                    };
                    return { coverageMap: {} };
                },
                // Leaf 5: zero-population is measurement hard failure. Use well-formed 100/100 so
                // this probe only asserts builder → child/conversion identity forwarding.
                summarizeCoverage: () => ({
                    statementsPercent: 100,
                    branchesPercent: 100,
                    statementsCovered: 1,
                    statementsTotal: 1,
                    branchesCovered: 1,
                    branchesTotal: 1,
                    uncoveredFiles: [],
                }),
            },
        });

        expect(mkdirSeen).toBe(expectedRegistry);
        expect(capturedChildEnv).toBeDefined();
        expect(capturedChildEnv!.KEEP).toBe('yes');
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).toBe(expectedRegistry);
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]).toBe(expectedRunScope);
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBe(TREE_DIGEST);
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).not.toBe('/tmp/hostile-registry');
        expect(capturedChildEnv!.EPGSTATION_SERVER_COMPILED_SNAPSHOT).toBe(compiledSnapshot);

        expect(capturedConversion).toEqual({
            identityRegistryDir: expectedRegistry,
            runScope: expectedRunScope,
            worktreeContent: { contentTree: TREE_DIGEST, headTree: HEAD_TREE, uncommittedChanges: true },
        });
    });

    it('coverage path: a record git could not produce still runs, with the identity value "unrecorded"', async () => {
        const runner = await import('../../../../scripts/server-test/run-tests.mjs');
        const runAgainstCompiledSnapshot = (
            runner as {
                runAgainstCompiledSnapshot: (input: Record<string, unknown>) => Promise<void>;
            }
        ).runAgainstCompiledSnapshot;
        const rawCoverageDirectory = makeScratchDir('runner-callsite-unrecorded-raw');
        let capturedChildEnv: NodeJS.ProcessEnv | undefined;
        let capturedWorktreeContent: unknown;

        await runAgainstCompiledSnapshot({
            compiledSnapshot: makeScratchDir('runner-callsite-unrecorded-snapshot'),
            filters: [],
            rawCoverageDirectory,
            worktreeContent: UNRECORDED_WORKTREE_CONTENT,
            dependencies: {
                mode: 'coverage',
                processEnv: {},
                enumerateLayerFiles: async (project: string) => [`${project}/synthetic.test.ts`],
                mkdir: async () => undefined,
                run: async (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
                    capturedChildEnv = options.env;
                },
                writeCanonicalCoverageArtifacts: async (input: { worktreeContent?: unknown }) => {
                    capturedWorktreeContent = input.worktreeContent;
                    return { coverageMap: {} };
                },
                summarizeCoverage: () => ({
                    statementsPercent: 100,
                    branchesPercent: 100,
                    statementsCovered: 1,
                    statementsTotal: 1,
                    branchesCovered: 1,
                    branchesTotal: 1,
                    uncoveredFiles: [],
                }),
            },
        });

        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBe('unrecorded');
        expect(capturedWorktreeContent).toEqual(UNRECORDED_WORKTREE_CONTENT);
    });

    it('non-coverage path: hostile identity env scrubbed before child; none forwarded', async () => {
        const runner = await import('../../../../scripts/server-test/run-tests.mjs');
        const runAgainstCompiledSnapshot = (
            runner as {
                runAgainstCompiledSnapshot?: (input: {
                    compiledSnapshot: string;
                    filters: string[];
                    rawCoverageDirectory?: string;
                    worktreeContent?: Record<string, unknown>;
                    dependencies?: Record<string, unknown>;
                }) => Promise<void>;
            }
        ).runAgainstCompiledSnapshot;
        expect(typeof runAgainstCompiledSnapshot).toBe('function');

        let capturedChildEnv: NodeJS.ProcessEnv | undefined;
        await runAgainstCompiledSnapshot!({
            compiledSnapshot: makeScratchDir('runner-callsite-imp-snapshot'),
            filters: [],
            dependencies: {
                mode: 'imp',
                processEnv: {
                    KEEP: 'yes',
                    [ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]: '/tmp/hostile-registry',
                    [ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]: 'hostile-run',
                    [ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]: 'hostile-tree',
                },
                run: async (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
                    capturedChildEnv = options.env;
                },
            },
        });

        expect(capturedChildEnv).toBeDefined();
        expect(capturedChildEnv!.KEEP).toBe('yes');
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV]).toBeUndefined();
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV]).toBeUndefined();
        expect(capturedChildEnv![ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV]).toBeUndefined();
    });

    it('direct CLI entry still runs main: invalid mode yields Unknown server test mode', async () => {
        const { spawn } = await import('node:child_process');
        const scriptPath = resolve('scripts/server-test/run-tests.mjs');

        const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolvePromise, reject) => {
            const child = spawn(process.execPath, [scriptPath, 'not-a-valid-mode'], {
                cwd: process.cwd(),
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk: Buffer) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', reject);
            child.on('close', code => resolvePromise({ code, stderr, stdout }));
        });

        expect(result.code).not.toBe(0);
        expect(`${result.stderr}\n${result.stdout}`).toMatch(/Unknown server test mode/i);
    });
});

/**
 * VideoUtil identity-stable statement exclusion:
 * emit-erased ambient unique-symbol marker + finite one-entry authorization table +
 * actual candidate marker-removal RED / exact-one / zero-delta proof via
 * `discoverCompiledSnapshotCoverage`.
 */
describe('discoverCompiledSnapshotCoverage: identity-stable VideoUtil statement exclusion', () => {
    const TARGET_SOURCE_PATH = 'src/model/api/video/VideoUtil.ts';
    const MARKER_IDENTIFIER =
        '__EPGSTATION_COVERAGE_EXCLUSION_R2_VIDEO_UTIL_SETTLED_TRUE_ARM_20260808';
    const MARKER_LINE = `declare const ${MARKER_IDENTIFIER}: unique symbol;\n`;
    // Compiled byte offsets below are pinned to the current ESM `tsc` output of
    // dist/model/api/video/VideoUtil.js (module: NodeNext). The TS source positions (line:column)
    // are stable; only the compiled offsets shifted by a constant -1110 bytes versus a
    // CommonJS build, because the module's leading import/export boilerplate is
    // shorter under ESM. Re-derive by locating the first (source-line-109) `if (settled) {` block
    // in the compiled file: statement 1 is the opening `{` (3937:3938), statement 2 the whitespace
    // up to `return` (3938:3959), statement 3 is `return;` (3959:3966), statement 4 the whitespace up
    // to `}` (3966:3983), statement 5 the closing `}` (3983:3984).
    //
    // Statement-basis syntax-only rule: `classifyStatementSpan` omits a statement-basis
    // span with no executable token (whitespace/comment/punctuation/bare structural keyword only) from
    // the basis entirely, before authorization is ever consulted. Statements 1, 2, 4 and 5 above are
    // exactly that (`{`, whitespace, whitespace, `}`) and never reach the basis -- only
    // statement 3 (`return;`, the sole span with an executable token) still does, so only its id
    // remains authorized here.
    const AUTHORIZED_STATEMENT_IDS = [
        'statement:src/model/api/video/VideoUtil.ts:110:20-110:27:3959:3966',
    ] as const;
    // Branch-basis extension: the SAME true arm's own branch-outcome entry (the `IfStatement`'s
    // `thenStatement`, spanning the whole `{ return; }` block) is authorized too -- see
    // `COVERAGE_EXCLUSION_VIDEO_UTIL_AUTHORIZED_BRANCH_IDS` in compiled-snapshot-coverage.mjs.
    const AUTHORIZED_BRANCH_IDS = ['branch:src/model/api/video/VideoUtil.ts:109:29-111:17:3937:3984'] as const;
    const TRUE_ARM_COMPILED_SPAN = { endOffset: 3984, startOffset: 3937 } as const;
    const REPOSITORY_ROOT = resolve('.');

    function statementIdOf(sourcePath: string, entry: { start: { line: number; column: number }; end: { line: number; column: number }; startOffset: number; endOffset: number }): string {
        return `statement:${sourcePath}:${entry.start.line}:${entry.start.column}-${entry.end.line}:${entry.end.column}:${entry.startOffset}:${entry.endOffset}`;
    }

    function branchIdOf(sourcePath: string, entry: { start: { line: number; column: number }; end: { line: number; column: number }; startOffset: number; endOffset: number }): string {
        return `branch:${sourcePath}:${entry.start.line}:${entry.start.column}-${entry.end.line}:${entry.end.column}:${entry.startOffset}:${entry.endOffset}`;
    }

    function requireCompiledSnapshotPair(): { jsBody: string; mapJson: string; snapshotRoot: string } {
        const snapshotRoot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        if (typeof snapshotRoot !== 'string' || snapshotRoot.length === 0) {
            throw new Error('EPGSTATION_SERVER_COMPILED_SNAPSHOT is required for actual candidate exclusion proofs');
        }
        const jsPath = join(snapshotRoot, 'model/api/video/VideoUtil.js');
        const mapPath = `${jsPath}.map`;
        const jsFile = readFileSync(jsPath, 'utf8');
        // strip trailing sourceMappingURL for body comparisons; discover reads the file as-is from snapshot
        const jsBody = jsFile;
        const mapJson = readFileSync(mapPath, 'utf8');
        if (jsBody.includes('EPGSTATION_COVERAGE_EXCLUSION') || mapJson.includes('EPGSTATION_COVERAGE_EXCLUSION')) {
            throw new Error('actual compiled VideoUtil pair must not embed the ambient exclusion marker');
        }
        if (!jsBody.includes('if (settled)')) {
            throw new Error('actual compiled VideoUtil.js missing if (settled) true-arm shape');
        }
        const span = jsBody.slice(TRUE_ARM_COMPILED_SPAN.startOffset, TRUE_ARM_COMPILED_SPAN.endOffset);
        if (!span.includes('return')) {
            throw new Error(
                `actual compiled VideoUtil.js span [3937,3984) does not look like the true-arm body: ${JSON.stringify(span)}`,
            );
        }
        return { jsBody, mapJson, snapshotRoot };
    }

    function readActualCandidateSource(): string {
        return readFileSync(join(REPOSITORY_ROOT, TARGET_SOURCE_PATH), 'utf8');
    }

    function markerlessSourceFrom(candidateSource: string): string {
        const markerIndex = candidateSource.lastIndexOf(MARKER_LINE.trimEnd());
        if (markerIndex < 0) {
            throw new Error('actual candidate source is missing the ambient exclusion marker');
        }
        // Keep the exact authorized markerless prefix (slice through the start of the marker line).
        const lineStart = candidateSource.lastIndexOf('\n', markerIndex - 1);
        const start = lineStart < 0 ? 0 : lineStart + 1;
        if (candidateSource.slice(start, start + MARKER_LINE.length) !== MARKER_LINE &&
            candidateSource.slice(start) !== MARKER_LINE.trimEnd() &&
            !candidateSource.slice(start).startsWith(MARKER_LINE.trimEnd())) {
            // Prefer exact trailing marker match used by the design: final statement text.
        }
        const exact = candidateSource.endsWith(MARKER_LINE)
            ? candidateSource.slice(0, candidateSource.length - MARKER_LINE.length)
            : candidateSource.endsWith(MARKER_LINE.trimEnd())
              ? candidateSource.slice(0, candidateSource.length - MARKER_LINE.trimEnd().length)
              : null;
        if (exact === null) {
            throw new Error('actual candidate source does not end with the exact ambient marker declaration');
        }
        return exact;
    }

    function writeVideoUtilRepo(sourceText: string): string {
        const repoRoot = makeScratchDir('video-util-repo');
        writeFile(join(repoRoot, TARGET_SOURCE_PATH), sourceText);
        return repoRoot;
    }

    function writeVideoUtilSnapshot(jsBody: string, mapJson: string, absoluteSourcePath: string): { root: string; scriptPath: string } {
        const root = join(makeScratchDir('video-util-snap'), 'dist');
        const scriptPath = join(root, 'model/api/video/VideoUtil.js');
        mkdirSync(dirname(scriptPath), { recursive: true });
        // Preserve compiled JS bytes (including sourceMappingURL) and only retarget map sources to the
        // temp repository's actual VideoUtil.ts so discovery loads the candidate-bound source.
        const parsed = JSON.parse(mapJson) as {
            file?: string;
            mappings?: string;
            names?: string[];
            sourceRoot?: string;
            sources?: string[];
            version?: number;
        };
        const mapFileName = 'VideoUtil.js.map';
        let body = jsBody;
        if (!body.includes('sourceMappingURL=')) {
            body = `${body}//# sourceMappingURL=${mapFileName}\n`;
        }
        writeFile(scriptPath, body);
        writeJson(`${scriptPath}.map`, {
            ...parsed,
            file: mapFileName,
            sourceRoot: '',
            sources: [sourceEntryFor(scriptPath, absoluteSourcePath)],
        });
        return { root, scriptPath };
    }

    function discoverActualVideoUtil(sourceText: string, jsBody: string, mapJson: string) {
        const repoRoot = writeVideoUtilRepo(sourceText);
        const absoluteSourcePath = join(repoRoot, TARGET_SOURCE_PATH);
        const { root, scriptPath } = writeVideoUtilSnapshot(jsBody, mapJson, absoluteSourcePath);
        const rawCoverageDir = makeScratchDir('video-util-raw');
        // Top-level covered range plus a zero-count nested true-arm span so uncovered IDs are observable.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [
                            { count: 1, endOffset: jsBody.length, startOffset: 0 },
                            {
                                count: 0,
                                endOffset: TRUE_ARM_COMPILED_SPAN.endOffset,
                                startOffset: TRUE_ARM_COMPILED_SPAN.startOffset,
                            },
                        ],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
        });
        expect(result.records).toHaveLength(1);
        return result;
    }

    function populationSets(result: ReturnType<typeof discoverCompiledSnapshotCoverage>) {
        const record = result.records[0];
        const statementIds = new Set(record.entries.map(entry => statementIdOf(record.sourcePath, entry)));
        const statementCounts = new Map(
            record.entries.map(entry => [statementIdOf(record.sourcePath, entry), entry.count] as const),
        );
        const branchIds = new Set((record.branchEntries ?? []).map(entry => branchIdOf(record.sourcePath, entry)));
        const branchCounts = new Map(
            (record.branchEntries ?? []).map(entry => [branchIdOf(record.sourcePath, entry), entry.count] as const),
        );
        return { branchCounts, branchIds, record, statementCounts, statementIds };
    }

    it('GREEN: actual candidate marker drops exactly the one authorized statement ID and the one authorized branch ID; other statements/branches stay', () => {
        const { jsBody, mapJson } = requireCompiledSnapshotPair();
        const candidateSource = readActualCandidateSource();
        expect(candidateSource.includes(MARKER_IDENTIFIER)).toBe(true);
        expect(jsBody.includes(MARKER_IDENTIFIER)).toBe(false);
        expect(mapJson.includes(MARKER_IDENTIFIER)).toBe(false);

        const result = discoverActualVideoUtil(candidateSource, jsBody, mapJson);
        const present = populationSets(result);
        for (const id of AUTHORIZED_STATEMENT_IDS) {
            expect(present.statementIds.has(id)).toBe(false);
        }
        for (const id of AUTHORIZED_BRANCH_IDS) {
            expect(present.branchIds.has(id)).toBe(false);
        }
        // settled = true starts on source line 112 after the class JSDoc insertion.
        expect([...present.statementIds].some(id => id.includes(':112:'))).toBe(true);
        expect(present.statementIds.size).toBeGreaterThan(0);
        expect(present.branchIds.size).toBeGreaterThan(0);

        const summary = summarizeCoverage(toCoverageFinalMap(result.records));
        // The true-arm branch outcome is also authorized (dropped from both total and
        // covered), so the branch gate reaches 100% too, not statements only.
        expect(summary.statementsTotal).toBeGreaterThan(0);
        expect(summary.statementsCovered).toBe(summary.statementsTotal);
        expect(summary.statementsPercent).toBe(100);
        expect(summary.branchesTotal).toBeGreaterThan(0);
        expect(summary.branchesCovered).toBe(summary.branchesTotal);
        expect(summary.branchesPercent).toBe(100);
    });

    it('RED (actual marker removal): removing only the ambient marker restores the exact five statement IDs and the one branch ID, and fails both gates', () => {
        const { jsBody, mapJson } = requireCompiledSnapshotPair();
        const candidateSource = readActualCandidateSource();
        const markerless = markerlessSourceFrom(candidateSource);
        expect(markerless.includes(MARKER_IDENTIFIER)).toBe(false);
        const removedResult = discoverActualVideoUtil(markerless, jsBody, mapJson);
        const removed = populationSets(removedResult);
        for (const id of AUTHORIZED_STATEMENT_IDS) {
            expect(removed.statementIds.has(id)).toBe(true);
        }
        for (const id of AUTHORIZED_BRANCH_IDS) {
            expect(removed.branchIds.has(id)).toBe(true);
        }

        const summary = summarizeCoverage(toCoverageFinalMap(removedResult.records));
        // Nested true-arm span count is 0, so the restored IDs keep both gates below 100%.
        expect(summary.statementsPercent).toBeLessThan(100);
        expect(summary.branchesPercent).toBeLessThan(100);
        expect(summary.uncoveredFiles).toContain(TARGET_SOURCE_PATH);
    });

    it('exact-one / zero-delta: marker-present vs marker-removed differ by exactly the authorized one statement ID and the one branch ID', () => {
        const { jsBody, mapJson } = requireCompiledSnapshotPair();
        const candidateSource = readActualCandidateSource();
        const markerless = markerlessSourceFrom(candidateSource);

        const present = populationSets(discoverActualVideoUtil(candidateSource, jsBody, mapJson));
        const removed = populationSets(discoverActualVideoUtil(markerless, jsBody, mapJson));

        const onlyInRemoved = [...removed.statementIds].filter(id => !present.statementIds.has(id)).sort();
        const onlyInPresent = [...present.statementIds].filter(id => !removed.statementIds.has(id)).sort();
        expect(onlyInRemoved).toEqual([...AUTHORIZED_STATEMENT_IDS].sort());
        expect(onlyInPresent).toEqual([]);

        const onlyInRemovedBranches = [...removed.branchIds].filter(id => !present.branchIds.has(id)).sort();
        const onlyInPresentBranches = [...present.branchIds].filter(id => !removed.branchIds.has(id)).sort();
        expect(onlyInRemovedBranches).toEqual([...AUTHORIZED_BRANCH_IDS].sort());
        expect(onlyInPresentBranches).toEqual([]);

        for (const [id, count] of present.statementCounts) {
            if (AUTHORIZED_STATEMENT_IDS.includes(id as (typeof AUTHORIZED_STATEMENT_IDS)[number])) {
                continue;
            }
            expect(removed.statementCounts.get(id)).toBe(count);
        }
        for (const [id, count] of removed.statementCounts) {
            if (AUTHORIZED_STATEMENT_IDS.includes(id as (typeof AUTHORIZED_STATEMENT_IDS)[number])) {
                continue;
            }
            expect(present.statementCounts.get(id)).toBe(count);
        }

        for (const [id, count] of present.branchCounts) {
            if (AUTHORIZED_BRANCH_IDS.includes(id as (typeof AUTHORIZED_BRANCH_IDS)[number])) {
                continue;
            }
            expect(removed.branchCounts.get(id)).toBe(count);
        }
        for (const [id, count] of removed.branchCounts) {
            if (AUTHORIZED_BRANCH_IDS.includes(id as (typeof AUTHORIZED_BRANCH_IDS)[number])) {
                continue;
            }
            expect(present.branchCounts.get(id)).toBe(count);
        }
    });

    it('RED (branch exact authorization mismatch): a synthetic compiled body that satisfies the authorized statement ID but has no branch construct at all fails closed on the missing authorized branch ID', () => {
        // Isolates `applyAuthorizedBranchExclusions`'s own exact-match check from the statement
        // side's: a hand-built compiled body reproduces the authorized STATEMENT id exactly (via
        // hand-specified mappings, so the statement-side exclusion succeeds) but contains no
        // `if`/ternary/logical-operator/switch construct anywhere, so the branch-outcome basis is
        // empty and can never contain the authorized branch id -- proving the branch check fails
        // closed independently of the statement check ever passing.
        const candidateSource = readActualCandidateSource();
        const repoRoot = writeVideoUtilRepo(candidateSource);
        const absoluteSourcePath = join(repoRoot, TARGET_SOURCE_PATH);
        const root = join(makeScratchDir('branch-mismatch-snap'), 'dist');
        const scriptPath = join(root, 'model/api/video/VideoUtil.js');

        // 3946 spaces of padding + `function f(){` (13 chars) puts `return;` at exactly dist
        // offset [3959, 3966) -- the authorized statement id's own offsets -- with hand-specified
        // mappings pointing that exact range at source 110:20-110:27 (the authorized id's own
        // source position). No `if` (or other branch-outcome construct) appears anywhere.
        const scriptBody = `${' '.repeat(3946)}function f(){return;}`;
        const mappings = buildMappings([
            { genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 },
            { genColumn: 3959, genLine: 0, srcColumn: 20, srcLine: 109 },
            { genColumn: 3966, genLine: 0, srcColumn: 27, srcLine: 109 },
        ]);
        writeCompiledScript(scriptPath, {
            body: scriptBody,
            mappings,
            sources: [sourceEntryFor(scriptPath, absoluteSourcePath)],
        });
        const jsBody = readFileSync(scriptPath, 'utf8');
        const rawCoverageDir = makeScratchDir('branch-mismatch-raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: jsBody.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [root] }),
            ),
        ).toBe('malformed-coverage-exclusion');
    });

    function discoverProbeSource(sourceBody: string, scriptBody = '"use strict";\nexport {};\n', mappings = DEFAULT_MAPPINGS) {
        const repoRoot = makeScratchDir('probe-repo');
        const sourcePath = 'src/model/api/video/Probe.ts';
        writeFile(join(repoRoot, sourcePath), sourceBody);
        const rootA = join(makeScratchDir('probe-snap'), 'dist');
        const scriptPath = join(rootA, 'model/api/video/Probe.js');
        writeCompiledScript(scriptPath, {
            body: scriptBody,
            mappings,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, sourcePath))],
        });
        const rawCoverageDir = makeScratchDir('probe-raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: scriptBody.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        return () =>
            discoverCompiledSnapshotCoverage({
                rawCoverageDir,
                repositoryRoot: repoRoot,
                snapshotRoots: [rootA],
            });
    }

    it('RED (unknown marker): unknown __EPGSTATION_COVERAGE_EXCLUSION_* fails closed', () => {
        const sourceBody = [
            'export const x = 1;',
            'declare const __EPGSTATION_COVERAGE_EXCLUSION_UNKNOWN_MARKER: unique symbol;',
            '',
        ].join('\n');
        expect(reasonOf(discoverProbeSource(sourceBody))).toBe('malformed-coverage-exclusion');
    });

    it('RED (wrong path): authorized marker on a non-VideoUtil source fails closed', () => {
        const sourceBody = ['export const x = 1;', MARKER_LINE].join('\n');
        expect(reasonOf(discoverProbeSource(sourceBody))).toBe('malformed-coverage-exclusion');
    });

    it('RED (duplicate marker): two ambient markers fail closed', () => {
        const sourceBody = ['export const x = 1;', MARKER_LINE, MARKER_LINE].join('');
        expect(reasonOf(discoverProbeSource(sourceBody))).toBe('malformed-coverage-exclusion');
    });

    it('RED (non-final placement): marker before another statement fails closed', () => {
        const sourceBody = [MARKER_LINE, 'export const x = 1;\n'].join('');
        expect(reasonOf(discoverProbeSource(sourceBody))).toBe('malformed-coverage-exclusion');
    });

    it('RED (wrong shape): let / non-declare / initializer / non-unique-symbol fail closed', () => {
        const cases = [
            `export const x = 1;\nlet ${MARKER_IDENTIFIER}: unique symbol;\n`,
            `export const x = 1;\nconst ${MARKER_IDENTIFIER}: unique symbol = Symbol();\n`,
            `export const x = 1;\ndeclare let ${MARKER_IDENTIFIER}: unique symbol;\n`,
            `export const x = 1;\ndeclare const ${MARKER_IDENTIFIER}: string;\n`,
            `export const x = 1;\ndeclare const ${MARKER_IDENTIFIER}: unique symbol = Symbol();\n`,
        ];
        for (const sourceBody of cases) {
            expect(reasonOf(discoverProbeSource(sourceBody))).toBe('malformed-coverage-exclusion');
        }
    });

    it('RED (changed bound unit): authorized marker with a one-byte code edit in the bound unit fails closed, naming the unit', () => {
        const candidateSource = readActualCandidateSource();
        const stale = candidateSource.replace('VideoInfoTimeout', 'VideoInfoTimeouX');
        expect(stale).not.toBe(candidateSource);
        const { jsBody, mapJson } = requireCompiledSnapshotPair();
        const error = errorOf(() => {
            discoverActualVideoUtil(stale, jsBody, mapJson);
        });
        expect(error?.reason).toBe('malformed-coverage-exclusion');
        expect(error?.message).toContain('"VideoUtil.getInfo"');
    });

    it('RED (exact authorization mismatch): authorized marker without the basis ID fails closed', () => {
        // Real VideoUtil marker + tiny compiled body cannot produce the authorized compiled offsets.
        const candidateSource = readActualCandidateSource();
        const repoRoot = writeVideoUtilRepo(candidateSource);
        const absoluteSourcePath = join(repoRoot, TARGET_SOURCE_PATH);
        const root = join(makeScratchDir('mismatch-snap'), 'dist');
        const scriptPath = join(root, 'model/api/video/VideoUtil.js');
        const scriptBody = '"use strict";\nexports.x = 1;\n';
        writeCompiledScript(scriptPath, {
            body: scriptBody,
            mappings: DEFAULT_MAPPINGS,
            sources: [sourceEntryFor(scriptPath, absoluteSourcePath)],
        });
        const rawCoverageDir = makeScratchDir('mismatch-raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: scriptBody.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                }),
            ),
        ).toBe('malformed-coverage-exclusion');
    });
});

/**
 * The exclusion approval table (`COVERAGE_EXCLUSION_AUTHORIZATIONS` in compiled-snapshot-coverage.mjs): its
 * shape and size, and, for every approval, that the real marker on the real source, discovered against the real
 * compiled dist output (`EPGSTATION_SERVER_COMPILED_SNAPSHOT`), removes exactly the entries its anchors name
 * and nothing else, and that stripping only the trailing marker line removes nothing.
 */
describe('discoverCompiledSnapshotCoverage: exclusion approval table (real compiled snapshot)', () => {
    const REPOSITORY_ROOT = resolve('.');

    interface Anchor {
        readonly code: string;
        readonly functionName: string;
        readonly tokenEnd: number;
        readonly tokenStart: number;
    }

    interface Approval {
        readonly boundFunctions: readonly { readonly codeSha256: string; readonly name: string }[];
        readonly branchAnchors: readonly Anchor[];
        readonly markerIdentifier: string;
        readonly sourcePath: string;
        readonly statementAnchors: readonly Anchor[];
    }

    const APPROVALS = (compiledSnapshotCoverage as unknown as { COVERAGE_EXCLUSION_AUTHORIZATIONS: readonly Approval[] })
        .COVERAGE_EXCLUSION_AUTHORIZATIONS;
    const describeBinding = (
        compiledSnapshotCoverage as unknown as {
            describeFunctionUnitBinding: (input: {
                sourcePath: string;
                sourceText: string;
                statementEntries: readonly unknown[];
                branchEntries: readonly unknown[];
            }) => { statements: readonly (Anchor | null)[]; branches: readonly (Anchor | null)[] };
        }
    ).describeFunctionUnitBinding;

    function requireSnapshotRoot(): string {
        const snapshotRoot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        if (typeof snapshotRoot !== 'string' || snapshotRoot.length === 0) {
            throw new Error('EPGSTATION_SERVER_COMPILED_SNAPSHOT is required for actual candidate exclusion proofs');
        }
        return snapshotRoot;
    }

    function stripTrailingMarkerLine(source: string, markerIdentifier: string): string {
        const markerLine = `declare const ${markerIdentifier}: unique symbol;\n`;
        expect(source.endsWith(markerLine)).toBe(true);
        return source.slice(0, source.length - markerLine.length);
    }

    function discoverApproval(approval: Approval, sourceText: string) {
        const jsRelativePath = approval.sourcePath.replace(/^src\//u, '').replace(/\.ts$/u, '.js');
        const jsPath = join(requireSnapshotRoot(), jsRelativePath);
        const jsBody = readFileSync(jsPath, 'utf8');
        const mapJson = readFileSync(`${jsPath}.map`, 'utf8');
        if (jsBody.includes('EPGSTATION_COVERAGE_EXCLUSION') || mapJson.includes('EPGSTATION_COVERAGE_EXCLUSION')) {
            throw new Error(`compiled ${jsRelativePath} must not embed the ambient exclusion marker`);
        }

        const repoRoot = makeScratchDir('approval-repo');
        writeFile(join(repoRoot, approval.sourcePath), sourceText);
        const root = join(makeScratchDir('approval-snap'), 'dist');
        const scriptPath = join(root, jsRelativePath);
        mkdirSync(dirname(scriptPath), { recursive: true });
        writeFile(scriptPath, jsBody);
        writeJson(`${scriptPath}.map`, {
            ...(JSON.parse(mapJson) as Record<string, unknown>),
            sourceRoot: '',
            sources: [sourceEntryFor(scriptPath, join(repoRoot, approval.sourcePath))],
        });
        const rawCoverageDir = makeScratchDir('approval-raw');
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    {
                        functionName: '',
                        isBlockCoverage: true,
                        ranges: [{ count: 1, endOffset: jsBody.length, startOffset: 0 }],
                    },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        const result = discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [root] });
        expect(result.records).toHaveLength(1);
        return result.records[0] as { entries: readonly BasisEntryLike[]; branchEntries: readonly BasisEntryLike[] };
    }

    // Discovering a real source with the compiled output is the expensive step (the largest file has over five
    // thousand statements, and the run is slower under coverage instrumentation), so the two discoveries of an
    // approval's file (with its marker, and with the marker line stripped) are made once and shared by its tests.
    const discoveredPairs = new Map<string, { absent: ReturnType<typeof discoverApproval>; present: ReturnType<typeof discoverApproval>; markerless: string }>();

    function discoverPair(approval: Approval) {
        let pair = discoveredPairs.get(approval.sourcePath);
        if (pair === undefined) {
            const sourceText = readFileSync(join(REPOSITORY_ROOT, approval.sourcePath), 'utf8');
            const markerless = stripTrailingMarkerLine(sourceText, approval.markerIdentifier);
            pair = {
                absent: discoverApproval(approval, markerless),
                markerless,
                present: discoverApproval(approval, sourceText),
            };
            discoveredPairs.set(approval.sourcePath, pair);
        }
        return pair;
    }

    function spanKey(entry: BasisEntryLike): string {
        return `${entry.startOffset}:${entry.endOffset}`;
    }

    function anchorKey(anchor: Anchor): string {
        return `${anchor.functionName}|${anchor.tokenStart}|${anchor.tokenEnd}|${anchor.code}`;
    }

    it('lists 16 approvals in the function-unit-bound form only, with 67 statement anchors and 20 branch anchors', () => {
        expect(APPROVALS).toHaveLength(16);
        expect(new Set(APPROVALS.map(approval => approval.sourcePath)).size).toBe(16);
        expect(new Set(APPROVALS.map(approval => approval.markerIdentifier)).size).toBe(16);
        expect(APPROVALS.reduce((total, approval) => total + approval.statementAnchors.length, 0)).toBe(67);
        expect(APPROVALS.reduce((total, approval) => total + approval.branchAnchors.length, 0)).toBe(20);
        for (const approval of APPROVALS) {
            expect(Object.keys(approval).sort()).toEqual([
                'alternativeOwnerEntries',
                'boundFunctions',
                'branchAnchors',
                'decisionIdentity',
                'markerIdentifier',
                'owner',
                'sourcePath',
                'statementAnchors',
            ]);
            const bound = approval.boundFunctions.map(unit => unit.name);
            expect(new Set(bound).size).toBe(bound.length);
            for (const unit of approval.boundFunctions) {
                expect(unit.codeSha256).toMatch(/^[0-9a-f]{64}$/u);
            }
            for (const anchor of [...approval.statementAnchors, ...approval.branchAnchors]) {
                expect(bound).toContain(anchor.functionName);
                expect(anchor.tokenStart).toBeLessThan(anchor.tokenEnd);
            }
        }
    });

    for (const approval of APPROVALS) {
        describe(approval.sourcePath, () => {
            it('GREEN: the real marker on the real source removes exactly the entries its anchors name', () => {
                const { absent, markerless, present } = discoverPair(approval);

                const removedOf = (kept: readonly BasisEntryLike[], all: readonly BasisEntryLike[]) => {
                    const keptSpans = new Set(kept.map(spanKey));
                    return all.filter(entry => !keptSpans.has(spanKey(entry)));
                };
                const removedStatements = removedOf(present.entries, absent.entries);
                const removedBranches = removedOf(present.branchEntries, absent.branchEntries);
                expect(removedStatements).toHaveLength(approval.statementAnchors.length);
                expect(removedBranches).toHaveLength(approval.branchAnchors.length);
                expect(present.entries.length).toBe(absent.entries.length - approval.statementAnchors.length);
                expect(present.branchEntries.length).toBe(absent.branchEntries.length - approval.branchAnchors.length);

                const described = describeBinding({
                    branchEntries: removedBranches,
                    sourcePath: approval.sourcePath,
                    sourceText: markerless,
                    statementEntries: removedStatements,
                });
                expect(described.statements.map(entry => anchorKey(entry!)).sort()).toEqual(
                    approval.statementAnchors.map(anchorKey).sort(),
                );
                expect(described.branches.map(entry => anchorKey(entry!)).sort()).toEqual(
                    approval.branchAnchors.map(anchorKey).sort(),
                );
            }, REAL_SOURCE_DISCOVERY_TIMEOUT_MS);

            it('RED: stripping only the trailing marker line removes nothing, so the entries come back', () => {
                const { absent, present } = discoverPair(approval);
                expect(absent.entries.length).toBe(present.entries.length + approval.statementAnchors.length);
                expect(absent.branchEntries.length).toBe(present.branchEntries.length + approval.branchAnchors.length);
            }, REAL_SOURCE_DISCOVERY_TIMEOUT_MS);
        });
    }
});

/**
 * Vitest's own SSR module runner (`VitestModuleEvaluator#_runInlinedModule`,
 * `node_modules/vitest/dist/module-evaluator.js`) always re-transforms a compiled-snapshot
 * `dist/**\/*.js` script (rewriting `import`/`export` into `__vite_ssr_import__`/`__vite_ssr_exportName__`
 * runtime calls -- confirmed empirically against this repo's own `dist/util/FileUtil.js`)
 * and wraps it in `'use strict';async (${argumentsList.join(',')})=>{{${code}\n}}` before
 * `vm.runInThisContext` ever executes it, so a real coverage run's raw V8 byte offsets index that
 * WRAPPED, TRANSFORMED text -- never the on-disk `dist` file `discoverCompiledSnapshotCoverage`
 * otherwise reads. `transformCaptureDir` (optional; omitted entirely, discovery treats every record as dist-native) lets a caller supply, per script,
 * `test/server/harness/coverage-transform-capture.ts`'s own captured `{ code, map, wrapperPrefixLength,
 * distSourceHash }` so raw ranges are translated into the on-disk `dist` file's own coordinate space --
 * the same coordinate space `buildStatementBasisEntries`'s basis spans already use -- before the
 * count-attribution logic (`countForSpanStart` et al.) ever sees them.
 *
 * Once `transformCaptureDir` is supplied, every raw record
 * in every script must additionally prove *which* coordinate space its own offsets live in -- its own
 * top-level range end (`functionName: ''`, a range starting at offset 0) is measured and compared
 * against the on-disk dist length and every candidate capture's own reconstructed wrapped length
 * (`wrapperPrefixLength + code.length + '\n}}'.length`). Every raw-record fixture below therefore
 * carries an explicit top-level function entry whose own `endOffset` is deliberately computed to match
 * exactly one of those two lengths -- never a value chosen independently of both, which the discovery
 * pass refuses to guess about (`unverified-raw-offset-space` /
 * `ambiguous-raw-offset-space`).
 */
describe('discoverCompiledSnapshotCoverage: executed-code transform-capture translation', () => {
    /** Writes one worker's transform-capture JSON file, matching `coverage-transform-capture.ts`'s own on-disk naming (`transform-<pid>-<timestamp>-<uuid>.json`) and shape. */
    function writeTransformCapture(
        transformCaptureDir: string,
        pid: string,
        captures: Array<{
            url: string;
            code: string;
            map: { version: number; mappings: string; sources: string[]; sourceRoot?: string; names: string[] } | null;
            wrapperPrefixLength: number;
            distSourceHash: string;
        }>,
        disambiguator = 'a',
    ): void {
        writeJson(join(transformCaptureDir, `transform-${pid}-1700000000000-${disambiguator}.json`), { captures });
    }

    /** Writes one process's raw dump JSON file, matching Node's own `NODE_V8_COVERAGE` naming (`coverage-<pid>-<timestamp>-<n>.json`) so the converter's pid-extraction can bind it to a same-pid transform capture. */
    function writeRawCoverageForPid(
        rawCoverageDir: string,
        pid: string,
        records: Array<{ url: string; functions?: unknown }>,
        disambiguator = '0',
    ): void {
        writeRawCoverage(rawCoverageDir, `coverage-${pid}-1700000000000-${disambiguator}.json`, records);
    }

    /** The record's own top-level function entry -- exactly one function named `''` with a range starting at offset 0 and ending at `endOffset`. */
    function topLevelFunctionEntry(endOffset: number, count = 0) {
        return { functionName: '', isBlockCoverage: true, ranges: [{ count, endOffset, startOffset: 0 }] };
    }

    /** A non-top-level function entry carrying arbitrary inner ranges (never itself a `startOffset: 0` candidate as long as `ranges` never includes one). */
    function innerFunctionEntry(ranges: Array<{ count: number; endOffset: number; startOffset: number }>) {
        return { functionName: '', isBlockCoverage: true, ranges };
    }

    /** Mirrors the converter's own `wrappedLength`: `wrapperPrefixLength + code.length + '\n}}'.length`. */
    function wrappedLengthOf(wrapperPrefixLength: number, code: string): number {
        return wrapperPrefixLength + code.length + 3;
    }

    const FOO_SOURCE_MAPPINGS = buildMappings([
        { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
        { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
    ]);
    const DIST_BODY = '"use strict";\nexports.a = 1;\nexports.b = 2;\n';
    // The EXECUTED text Vitest actually ran: a distinct, longer injected line 0 (standing in for
    // `__vite_ssr_exportName__(...)`) that does not exist in `DIST_BODY` at all, then the identical two
    // statement lines. Line numbers are therefore off-by-one from `DIST_BODY`'s own -- exactly the
    // shape that a raw-offset-is-a-dist-offset assumption cannot survive.
    const EXECUTED_CODE = '__vite_ssr_exportName__("default", () => {});\nexports.a = 1;\nexports.b = 2;\n';
    // Stands in for `'use strict';async (${argumentsList.join(',')})=>{{` -- its own exact text never
    // matters to the converter, only its length.
    const WRAPPER_PREFIX_LENGTH = 64;
    const FOO_WORKER_TOP_LEVEL_END = wrappedLengthOf(WRAPPER_PREFIX_LENGTH, EXECUTED_CODE);

    function writeFooDist(scriptPath: string, repoRoot: string): string {
        writeCompiledScript(scriptPath, {
            body: DIST_BODY,
            mappings: FOO_SOURCE_MAPPINGS,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        return readFileSync(scriptPath, 'utf8');
    }

    function fooCapture(scriptPath: string, repoRoot: string, jsSource: string) {
        return {
            code: EXECUTED_CODE,
            distSourceHash: sha256Hex(jsSource),
            map: {
                mappings: FOO_SOURCE_MAPPINGS,
                names: [],
                sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                version: 3,
            },
            url: pathToFileURL(scriptPath).href,
            wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
        };
    }

    function fooExecutedRanges() {
        const codeLine1 = lineStartOffset(EXECUTED_CODE, 1);
        const codeLine2 = lineStartOffset(EXECUTED_CODE, 2);
        return [
            {
                count: 5,
                endOffset: WRAPPER_PREFIX_LENGTH + codeLine2,
                startOffset: WRAPPER_PREFIX_LENGTH + codeLine1,
            },
            {
                count: 0,
                endOffset: WRAPPER_PREFIX_LENGTH + EXECUTED_CODE.length,
                startOffset: WRAPPER_PREFIX_LENGTH + codeLine2,
            },
        ];
    }

    function fooWorkerFunctions() {
        // Inner (narrow, correct) entry listed BEFORE the wide top-level entry: `countForSpanStart`'s
        // own smallest-width tie-break only replaces its current best on a STRICTLY smaller width, so
        // if this fixture's coarse 2-point mapping ever degenerates the top-level's own translated span
        // to the exact same width as a real statement's (both floor/ceiling to the same two points, an
        // artifact of a deliberately minimal synthetic source map -- never possible for a real `tsc`
        // build's much finer-grained mapping), the narrow, correct entry must already be `best` before
        // the wide one is even considered.
        return [innerFunctionEntry(fooExecutedRanges()), topLevelFunctionEntry(FOO_WORKER_TOP_LEVEL_END)];
    }

    it('translates raw offsets that index Vitest-transformed code back to the correct on-disk dist statement, matching the untranslated fixture\'s own counts exactly', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const distLine2 = lineStartOffset(DIST_BODY, 2);

        const pid = '910001';
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeTransformCapture(transformCaptureDir, pid, [fooCapture(scriptPath, repoRoot, jsSource)]);

        // Raw V8 offsets as Vitest's own evaluator would actually record them: offsets into
        // `WRAPPER_PREFIX_LENGTH + EXECUTED_CODE`, not into `DIST_BODY`. Written by the *same* pid as
        // the capture above, so the converter's pid-scoped dispatch actually consults it.
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: fooWorkerFunctions(), url: pathToFileURL(scriptPath).href },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        const [record] = result.records;
        expect(record.sourcePath).toBe('src/model/Foo.ts');
        expect(record.entries).toHaveLength(2);
        // Exactly the untranslated fixture's own two entries (same start/end/dist-offset shape as the
        // "positive multiple-snapshot discovery" describe block above) -- translation recovers the
        // identical result a byte-for-byte-unwrapped raw dump would have produced directly.
        expect(record.entries[0]).toEqual({
            count: 5,
            end: { column: 8, line: 7 },
            endOffset: distLine2,
            start: { column: 8, line: 5 },
            startOffset: distLine1,
        });
        expect(record.entries[1]).toEqual({
            count: 0,
            end: { column: 8, line: 7 },
            endOffset: DIST_BODY.length,
            start: { column: 8, line: 7 },
            startOffset: distLine2,
        });
    });

    it('RED: without transformCaptureDir, the same wrapped/transformed raw offsets silently misattribute instead of resolving to the correct dist statement (documents the pre-fix bug this fixture reproduces)', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeFooDist(scriptPath, repoRoot);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, '910002', [
            {
                functions: [{ functionName: '', isBlockCoverage: true, ranges: fooExecutedRanges() }],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        // No transformCaptureDir: the whole per-record verification is gated on
        // the caller opting in at all -- raw offsets are trusted as dist offsets directly
        // (no top-level range needed in this fixture at all). They
        // exceed `DIST_BODY`'s own length by `WRAPPER_PREFIX_LENGTH`, so both ranges land past every
        // real mapping point; `offsetToPosition`'s own clamping resolves them to the LAST dist line
        // instead of throwing, so this never fails closed -- it silently produces an entries shape that
        // does not match the translated fixture's own correct result above.
        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
        });
        const [record] = result.records;
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const distLine2 = lineStartOffset(DIST_BODY, 2);
        const translatedShape = [
            { count: 5, endOffset: distLine2, startOffset: distLine1 },
            { count: 0, endOffset: DIST_BODY.length, startOffset: distLine2 },
        ];
        const untranslatedShape = record.entries.map(entry => ({
            count: entry.count,
            endOffset: entry.endOffset,
            startOffset: entry.startOffset,
        }));
        expect(untranslatedShape).not.toEqual(translatedShape);
    });

    it('a native script (top-level range end == on-disk length) with no capture at all succeeds untranslated, alongside a Vitest-worker script that does have one', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Bar.ts'), 'export const bar = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const fooScript = join(root, 'model/Foo.js');
        const barScript = join(root, 'model/Bar.js');
        const fooJsSource = writeFooDist(fooScript, repoRoot);
        // Bar: a plain on-disk dist script, never touched by Vite -- e.g. loaded via
        // `createRequire()` from within a test harness (this repository's own `correlation.spec`
        // loading `dist/model/ipc/IPCClient.js` directly), or by a spawned child process running a
        // `dist/**\/*.js` entry point on its own. Its own top-level range end is exactly the on-disk
        // file's own length -- the measured, provable signature of native execution.
        writeCompiledScript(barScript, { sources: [sourceEntryFor(barScript, join(repoRoot, 'src/model/Bar.ts'))] });
        const barJsSource = readFileSync(barScript, 'utf8');

        const transformCaptureDir = makeScratchDir('transform-capture');
        // A capture exists for Foo (pid 910011) -- proving the harness *did* engage for this run --
        // but none at all for Bar, under any pid.
        writeTransformCapture(transformCaptureDir, '910011', [fooCapture(fooScript, repoRoot, fooJsSource)]);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, '910011', [
            { functions: fooWorkerFunctions(), url: pathToFileURL(fooScript).href },
        ]);
        // Bar's own raw record, from a *different* pid that never wrote any transform capture at all.
        writeRawCoverageForPid(rawCoverageDir, '910012', [
            {
                functions: [topLevelFunctionEntry(barJsSource.length, 1)],
                url: pathToFileURL(barScript).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(2);
        const barRecord = result.records.find(record => record.sourcePath === 'src/model/Bar.ts');
        // Bar's raw offsets are already dist-file offsets (its own measured top-level range proves it)
        // -- never translated, never rejected, exactly the pre-existing behavior for a record with no
        // capture.
        expect(barRecord?.entries[0]?.count).toBe(1);
    });

    it('a native (untranslated) record and a Vitest-worker (translated) record for the SAME resolved script path are each attributed independently, with no cross-contamination', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const distLine2 = lineStartOffset(DIST_BODY, 2);

        const nativePid = '910021';
        const workerPid = '910022';
        const transformCaptureDir = makeScratchDir('transform-capture');
        // Only the worker pid has a capture -- the native pid's own record must never be translated
        // through it.
        writeTransformCapture(transformCaptureDir, workerPid, [fooCapture(scriptPath, repoRoot, jsSource)]);

        const rawCoverageDir = makeScratchDir('raw');
        // Native record: raw offsets are ALREADY dist-file offsets (e.g. a plain `require()` load),
        // its own top-level range proving that, targeting statement 1 with a distinctive count.
        writeRawCoverageForPid(rawCoverageDir, nativePid, [
            {
                functions: [
                    topLevelFunctionEntry(jsSource.length),
                    innerFunctionEntry([{ count: 3, endOffset: distLine2, startOffset: distLine1 }]),
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        // Worker record: raw offsets index the WRAPPED/transformed executed text, its own top-level
        // range proving that, targeting statement 2 with a distinctive count.
        writeRawCoverageForPid(rawCoverageDir, workerPid, [
            {
                functions: [
                    innerFunctionEntry([fooExecutedRanges()[1]]),
                    topLevelFunctionEntry(FOO_WORKER_TOP_LEVEL_END),
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        const [record] = result.records;
        expect(record.entries).toHaveLength(2);
        // Statement 1 (native pid's own dist-native offset): count 3, untouched by the worker pid's
        // capture. If the pid-wide translation rule were applied, this record would be blindly translated too
        // (its dist-native offset misread as an executed-text offset), corrupting this count.
        expect(record.entries.find(entry => entry.startOffset === distLine1)?.count).toBe(3);
        // Statement 2 (worker pid's own translated offset): count 1 (fooExecutedRanges()[1]'s own
        // count), correctly translated onto the same statement the synthetic fixture above resolves to.
        expect(record.entries.find(entry => entry.startOffset === distLine2)?.count).toBe(
            fooExecutedRanges()[1].count,
        );
    });

    it('a wrong-pid capture surviving pid reuse across two Vitest CLI invocations is harmless -- a differing top-level end never matches it, so the record fails closed instead of being silently mistranslated', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);

        // run-tests.mjs's own non-shard coverage mode spawns multiple SEPARATE sequential Vitest CLI
        // invocations into the same raw directory (the parallel batch, then the real-process files)
        // -- an OS pid an earlier invocation's worker used can, in principle, be reused by a later
        // invocation's own worker. Simulate that: a capture was written for pid `reusedPid` by an
        // EARLIER invocation, but the raw record actually presented under that same pid belongs to a
        // LATER invocation and has a genuinely different top-level length.
        const reusedPid = '910111';
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeTransformCapture(transformCaptureDir, reusedPid, [fooCapture(scriptPath, repoRoot, jsSource)]);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, reusedPid, [
            {
                // A top-level length that matches NEITHER the on-disk dist length NOR the stale
                // same-pid capture's own wrapped length (`FOO_WORKER_TOP_LEVEL_END`) -- standing in for
                // "this pid's own real capture was simply never written" (e.g. this second invocation's
                // own worker crashed before its own `afterAll`/`afterEach` fired).
                functions: [topLevelFunctionEntry(FOO_WORKER_TOP_LEVEL_END + 1)],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('a capture for the same path from a DIFFERENT pid of the same run rescues a record when its distSourceHash matches the on-disk file and its wrapped length matches the record\'s own top-level end', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);

        const capturingPid = '910121';
        const recordPid = '910122';
        const transformCaptureDir = makeScratchDir('transform-capture');
        // Captured by a DIFFERENT pid than the one whose own raw record needs translating -- e.g. this
        // module was loaded by another worker of the same run, and this pid's own capture attempt
        // raced a `vi.resetModules()` and lost.
        writeTransformCapture(transformCaptureDir, capturingPid, [fooCapture(scriptPath, repoRoot, jsSource)]);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, recordPid, [
            { functions: fooWorkerFunctions(), url: pathToFileURL(scriptPath).href },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });
        const [record] = result.records;
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        expect(record.entries.find(entry => entry.startOffset === distLine1)?.count).toBe(5);
    });

    it('a cross-pid capture is never borrowed when its distSourceHash does not match the on-disk file the discovery pass is actually looking at', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeFooDist(scriptPath, repoRoot);

        const capturingPid = '910131';
        const recordPid = '910132';
        const transformCaptureDir = makeScratchDir('transform-capture');
        // Same wrapped length as `fooWorkerFunctions()` expects, but a `distSourceHash` that belongs to
        // some other (unrelated) on-disk content -- must never be trusted as this script's own capture.
        writeTransformCapture(transformCaptureDir, capturingPid, [
            { ...fooCapture(scriptPath, repoRoot, jsSourceForHashMismatch()), distSourceHash: sha256Hex('unrelated content') },
        ]);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, recordPid, [
            { functions: fooWorkerFunctions(), url: pathToFileURL(scriptPath).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');

        function jsSourceForHashMismatch(): string {
            return readFileSync(scriptPath, 'utf8');
        }
    });

    it('an unverifiable record is excluded with a diagnostic -- never failed closed -- when another record for the SAME script IS verified, and never contributes any count', () => {
        // Reproduces test/server/persistence/harness.ts#installDataSourceFactory's own real shape: a
        // module-top-level `require()` (native, verified: top-level end == on-disk length) coexists with
        // a live `import()` performed immediately after `vi.mock('typeorm')` + `vi.resetModules()`,
        // whose own transformed code is invalidated by that SAME test's own later `vi.resetModules()`
        // (in its cleanup) before any `afterEach`/`afterAll` capture opportunity ever runs -- so this
        // repository's own real coverage data for `dist/model/db/DBOperator.js` legitimately has NO
        // capture for that second record's own top-level end (measured: 35580, ~3.4x the on-disk 10337 --
        // far too large to be `wrapperPrefixLength` drift; it is Vite's real SSR import-rewrite overhead
        // for an 8-import file, executed but simply never captured).
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const distLine2 = lineStartOffset(DIST_BODY, 2);

        const nativePid = '910151';
        const unverifiablePid = '910152';
        const transformCaptureDir = makeScratchDir('transform-capture');
        // Some OTHER path has a capture under this run (proving the harness engaged at all), but nothing
        // at all for this exact (pid, path) or any cross-pid-hash-matched candidate -- exactly "this
        // record's own capture attempt was lost to a mid-test resetModules, and no other pid observed
        // this exact on-disk file being transformed either".
        writeFile(join(repoRoot, 'src/model/Other.ts'), 'export const other = 1;');
        const otherScript = join(root, 'model/Other.js');
        writeCompiledScript(otherScript, {
            body: DIST_BODY,
            mappings: FOO_SOURCE_MAPPINGS,
            sources: [sourceEntryFor(otherScript, join(repoRoot, 'src/model/Other.ts'))],
        });
        const otherJsSource = readFileSync(otherScript, 'utf8');
        writeTransformCapture(transformCaptureDir, '910199', [
            {
                code: EXECUTED_CODE,
                distSourceHash: sha256Hex(otherJsSource),
                map: {
                    mappings: FOO_SOURCE_MAPPINGS,
                    names: [],
                    sources: [sourceEntryFor(otherScript, join(repoRoot, 'src/model/Other.ts'))],
                    version: 3,
                },
                url: pathToFileURL(otherScript).href,
                wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
            },
        ]);

        const rawCoverageDir = makeScratchDir('raw');
        // Native record: verified (top-level end == on-disk length), targeting statement 1.
        writeRawCoverageForPid(rawCoverageDir, nativePid, [
            {
                functions: [
                    topLevelFunctionEntry(jsSource.length),
                    innerFunctionEntry([{ count: 4, endOffset: distLine2, startOffset: distLine1 }]),
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        // Unverifiable record: top-level end matches neither on-disk length nor any candidate capture's
        // wrapped length (a large, "3.4x"-style value standing in for real Vite SSR import-rewrite
        // overhead) -- this is the DBOperator.js shape.
        writeRawCoverageForPid(rawCoverageDir, unverifiablePid, [
            { functions: [topLevelFunctionEntry(jsSource.length * 4)], url: pathToFileURL(scriptPath).href },
        ]);
        // A raw record for `Other.js` under the SAME unverifiable pid, so the pid genuinely exists and
        // wrote more than one record in this run (matching the real multi-script shape) -- this one IS
        // verifiable via its own capture.
        writeRawCoverageForPid(rawCoverageDir, unverifiablePid, [
            { functions: fooWorkerFunctions(), url: pathToFileURL(otherScript).href },
        ], '1');

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        // Never failed closed: Foo.js has one verified record, so the script as a whole has real
        // evidence, even though its second record could not be verified.
        expect(result.records).toHaveLength(2);
        const fooRecord = result.records.find(record => record.sourcePath === 'src/model/Foo.ts');
        expect(fooRecord).toBeDefined();
        // Only the native record's own count (4) is attributed -- the excluded record contributes
        // nothing at all, positive or zero, to any basis span.
        expect(fooRecord?.entries.find(entry => entry.startOffset === distLine1)?.count).toBe(4);

        // The exclusion is reported as a diagnostic, not silently dropped.
        expect(result.excludedRecordDiagnostics).toHaveLength(1);
        const diagnostic = result.excludedRecordDiagnostics[0];
        expect(diagnostic.relativeScriptPath).toBe('model/Foo.js');
        expect(diagnostic.pid).toBe(unverifiablePid);
        expect(diagnostic.topLevelEnd).toBe(jsSource.length * 4);
        expect(diagnostic.distLength).toBe(jsSource.length);
    });

    it('still fails closed as unverified-raw-offset-space when EVERY record for a script is unverifiable (no other record proves any evidence at all)', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeFile(join(repoRoot, 'src/model/Other.ts'), 'export const other = 1;');
        const otherScript = join(root, 'model/Other.js');
        writeCompiledScript(otherScript, {
            body: DIST_BODY,
            mappings: FOO_SOURCE_MAPPINGS,
            sources: [sourceEntryFor(otherScript, join(repoRoot, 'src/model/Other.ts'))],
        });
        const otherJsSource = readFileSync(otherScript, 'utf8');
        writeTransformCapture(transformCaptureDir, '910299', [
            {
                code: EXECUTED_CODE,
                distSourceHash: sha256Hex(otherJsSource),
                map: {
                    mappings: FOO_SOURCE_MAPPINGS,
                    names: [],
                    sources: [sourceEntryFor(otherScript, join(repoRoot, 'src/model/Other.ts'))],
                    version: 3,
                },
                url: pathToFileURL(otherScript).href,
                wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
            },
        ]);

        const rawCoverageDir = makeScratchDir('raw');
        // TWO unverifiable records for the SAME script, both under pids with no matching capture --
        // zero trustworthy evidence for this script at all.
        writeRawCoverageForPid(rawCoverageDir, '910251', [
            { functions: [topLevelFunctionEntry(jsSource.length * 4)], url: pathToFileURL(scriptPath).href },
        ]);
        writeRawCoverageForPid(
            rawCoverageDir,
            '910252',
            [{ functions: [topLevelFunctionEntry(jsSource.length * 5)], url: pathToFileURL(scriptPath).href }],
            '1',
        );

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('capture loss under vi.resetModules(): an earlier, no-longer-current transformed version captured via afterEach (not just the worker-final afterAll) is still found and correctly applied by its own matching wrapped length', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);

        const pid = '910141';
        const transformCaptureDir = makeScratchDir('transform-capture');
        // Two distinct capture files for the SAME pid+path: an `afterEach` capture of the version that
        // was actually live when the raw range below was recorded, and a LATER `afterAll` capture of a
        // second, differently-transformed version (standing in for `vi.resetModules()` between the two
        // -- Vite's own `invalidateModule` clears `node.meta`, so a naive worker-final-only capture
        // would only ever see this second version, never the first).
        const earlierVersionCode = EXECUTED_CODE;
        const laterVersionCode = `${EXECUTED_CODE}// re-transformed after resetModules\n`;
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: earlierVersionCode,
                    distSourceHash: sha256Hex(jsSource),
                    map: {
                        mappings: FOO_SOURCE_MAPPINGS,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
                },
            ],
            'aftereach',
        );
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: laterVersionCode,
                    distSourceHash: sha256Hex(jsSource),
                    map: {
                        mappings: FOO_SOURCE_MAPPINGS,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
                },
            ],
            'afterall',
        );

        // The raw range's own top-level length matches the EARLIER version only.
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: fooWorkerFunctions(), url: pathToFileURL(scriptPath).href },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });
        const [record] = result.records;
        expect(record.entries.find(entry => entry.startOffset === distLine1)?.count).toBe(5);
    });

    it('fails closed as unverified-raw-offset-space (not a run-wide missing-transform-capture) when transformCaptureDir is supplied but contains no captures at all and the one relevant raw record genuinely cannot be verified (the capture harness never engaged for a run that needed it)', () => {
        // A blanket, run-wide `missing-transform-capture` the instant
        // `transformCapturesByPidAndPath.size === 0` while any relevant raw record exists would be wrong --
        // see the GREEN test right below, which proves that shape is not always a defect. The real defect this test reproduces is narrower and still caught: THIS
        // record has no functions array at all, so it has no unambiguous top-level range
        // (`topLevelRangeEndOffset` returns `null`) and is excluded; since it is the only record for this
        // script, the whole script has no verified evidence at all and fails closed regardless -- now
        // with the more precise `unverified-raw-offset-space` reason instead of a coarser, run-wide one.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, '910031', [{ url: pathToFileURL(scriptPath).href }]);
        const transformCaptureDir = makeScratchDir('transform-capture-empty');

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('GREEN: transformCaptureDir supplied but contains zero captures anywhere, while every relevant raw record is genuinely dist-native (a legitimate narrow test selection with nothing routed through the module runner) -- succeeds, never fails run-wide over an absence of evidence it never needed', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const body = '"use strict";\nexports.foo = 1;\n';
        writeCompiledScript(scriptPath, {
            body,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        // The on-disk file's own full length (including the trailing `sourceMappingURL` comment
        // `writeCompiledScript` appends after `body`) -- the measured, provable signature of native
        // execution the per-record disposition compares a record's own top-level range end against.
        const jsSource = readFileSync(scriptPath, 'utf8');
        const rawCoverageDir = makeScratchDir('raw');
        // A native `require()`-style record: its own top-level range end equals the on-disk dist length
        // exactly, verifiable without any transform capture at all.
        writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
            {
                functions: [
                    { functionName: '', isBlockCoverage: true, ranges: [{ count: 3, endOffset: jsSource.length, startOffset: 0 }] },
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        // Supplied (this run opted into capture verification) but genuinely empty -- nothing in this
        // narrow selection ever went through Vitest's module runner at all.
        const transformCaptureDir = makeScratchDir('transform-capture-empty-legitimate');

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        expect(result.excludedRecordDiagnostics).toEqual([]);
        expect(result.records[0].entries.some(entry => entry.count === 3)).toBe(true);
    });

    it('fails closed as unverified-raw-offset-space when a raw record has no unambiguous top-level range at all', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const pid = '910035';
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeTransformCapture(transformCaptureDir, pid, [fooCapture(scriptPath, repoRoot, jsSource)]);
        const rawCoverageDir = makeScratchDir('raw');
        // No function named '' has a range starting at offset 0 at all.
        writeRawCoverageForPid(rawCoverageDir, pid, [
            {
                functions: [innerFunctionEntry([{ count: 1, endOffset: 10, startOffset: 1 }])],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('GREEN: a later same-pid dump with no top-level anchor of its own borrows the coordinate space an earlier dump of the same pid+script already established, and its own count still sums in', () => {
        // Real shape observed in a preserved raw dump directory: our harness
        // calls v8.takeCoverage() once per test file without ever stopping collection until
        // the worker's own SIGTERM, so one pid can flush MANY raw dumps for the identical script over its
        // life. v8.takeCoverage() resets/deltas per Node's own documented contract, so a LATER dump only
        // ever contains what changed since the previous flush -- a script whose top-level (module
        // evaluation) scope only ever runs once has nothing new to report there on a later flush, while
        // an already-loaded inner function invoked again still does, with no top-level "" anchor
        // anywhere in that same dump at all (for example, the third dump of the pid observed had exactly one function
        // also named "" by V8's own anonymous-closure convention, at a NON-zero startOffset).
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const distLine2 = lineStartOffset(DIST_BODY, 2);

        const pid = '910061';
        const rawCoverageDir = makeScratchDir('raw');
        // First flush: full, coherent, NATIVE record (topLevelEnd === on-disk length exactly) --
        // establishes this pid's own coordinate space for this script.
        writeRawCoverageForPid(
            rawCoverageDir,
            pid,
            [
                {
                    functions: [
                        topLevelFunctionEntry(jsSource.length, 1),
                        innerFunctionEntry([{ count: 5, endOffset: distLine2, startOffset: distLine1 }]),
                    ],
                    url: pathToFileURL(scriptPath).href,
                },
            ],
            '0',
        );
        // Second flush, same pid, moments later: no top-level anchor at all in THIS dump.
        writeRawCoverageForPid(
            rawCoverageDir,
            pid,
            [
                {
                    functions: [innerFunctionEntry([{ count: 4, endOffset: distLine2, startOffset: distLine1 }])],
                    url: pathToFileURL(scriptPath).href,
                },
            ],
            '1',
        );
        const transformCaptureDir = makeScratchDir('transform-capture-empty');

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        // Both dumps' own counts at distLine1 sum: 5 (first) + 4 (second, borrowed coordinate space) = 9
        // -- never silently dropped (which would undercount) and never doubled (which would overcount).
        expect(result.records[0].entries.find(entry => entry.startOffset === distLine1)?.count).toBe(9);
    });

    it('RED (soundness check): a same-pid anchor-less dump whose own ranges do not fit inside the established top-level end is never borrowed -- fails closed exactly as with no candidate at all', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);

        const pid = '910062';
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(
            rawCoverageDir,
            pid,
            [{ functions: [topLevelFunctionEntry(jsSource.length, 1)], url: pathToFileURL(scriptPath).href }],
            '0',
        );
        // Second flush, same pid: no anchor of its own, AND its own range overruns the established
        // top-level end -- this is NOT the same coordinate space (a genuinely different, unrelated shape
        // that happens to share a pid), so it must never be borrowed.
        writeRawCoverageForPid(
            rawCoverageDir,
            pid,
            [
                {
                    functions: [innerFunctionEntry([{ count: 4, endOffset: jsSource.length + 1000, startOffset: distLine1 }])],
                    url: pathToFileURL(scriptPath).href,
                },
            ],
            '1',
        );
        const transformCaptureDir = makeScratchDir('transform-capture-empty');

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('RED (soundness): two coexisting script instances (different scriptIds) of the identical url under one pid -- an anchor-less delta belonging to the RUNNER instance must never borrow the NATIVE instance\'s topLevelEnd merely because its own ranges happen to fit inside it', () => {
        // Real shape confirmed against this run's own preserved raw dumps
        // (test/server/.artifacts/coverage-raw/v8-7P48qm/coverage-1760879-1790241868238-0.json): pid
        // 1760879 held TWO simultaneously-live script instances of the identical url `lib/TailStream.js`
        // at once -- scriptId 488 (native, topLevelEnd 8605) and scriptId 517 (a wrapped/transformed
        // evaluation, topLevelEnd 31555) -- confirming a single pid can genuinely hold more than one
        // script instance for one url (a native `require()` plus a separate Vitest module-runner-wrapped
        // evaluation, e.g. `test/server/persistence/harness.ts`'s own pattern for `DBOperator.js`).
        //
        // A bare bound check keyed only by pid cannot tell them apart: if the RUNNER instance's own
        // anchor is never independently visible in any dump (only the NATIVE instance's is -- exactly
        // this fixture's own shape), a pid-only bookkeeping would see only ONE distinct established value
        // for the whole pid and happily accept ANY later same-pid delta whose own ranges are numerically
        // small enough to fit inside it, even one that actually belongs to the never-anchored runner
        // instance -- silently misattributing it to the wrong coordinate space. Keying by
        // `(pid, scriptId)` instead correctly refuses: scriptId "runner" has no established anchor of its
        // own to borrow, so its own anchor-less delta must fail closed here, never borrow scriptId
        // "native"'s value just because it happens to be the pid's only established one.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        // Deliberately long native body -- long enough that the runner instance's own small delta offsets
        // fit comfortably inside it by pure coincidence.
        const nativeBody = `"use strict";\n${'exports.pad = 1;\n'.repeat(30)}exports.x = 1;\n`;
        writeCompiledScript(scriptPath, {
            body: nativeBody,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const jsSource = readFileSync(scriptPath, 'utf8');
        const url = pathToFileURL(scriptPath).href;

        const pid = '910099';
        const rawCoverageDir = makeScratchDir('raw');
        // First flush: the native instance's own anchored record ONLY -- the runner instance never gets
        // an anchored dump anywhere in this pid's own lifetime.
        writeJson(join(rawCoverageDir, `coverage-${pid}-1700000000000-0.json`), {
            result: [{ functions: [topLevelFunctionEntry(jsSource.length, 1)], scriptId: 'native', url }],
        });
        // Second flush, same pid: an anchor-less delta for a DIFFERENT script instance (scriptId
        // "runner") -- small offsets that fit inside the native instance's own end by coincidence, but
        // this is not the native instance's own topology at all.
        writeJson(join(rawCoverageDir, `coverage-${pid}-1700000000000-1.json`), {
            result: [
                {
                    functions: [innerFunctionEntry([{ count: 3, endOffset: 20, startOffset: 10 }])],
                    scriptId: 'runner',
                    url,
                },
            ],
        });
        const transformCaptureDir = makeScratchDir('transform-capture-empty');

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('unverified-raw-offset-space');
    });

    it('GREEN: an anchor-less delta correctly borrows ITS OWN script instance\'s established end, never a different, coexisting instance\'s end under the same pid', () => {
        // Companion to the RED test above, mirroring the exact real shape
        // (coverage-1760879-1790241868238-0.json: one dump, one url, two scriptIds) where BOTH instances
        // are independently anchored -- proving the fix does not just fail closed more often, it also
        // correctly attributes a later delta to its OWN matching instance instead of either failing
        // unnecessarily or drifting to the wrong one.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        const jsSource = writeFooDist(scriptPath, repoRoot);
        const distLine1 = lineStartOffset(DIST_BODY, 1);
        const url = pathToFileURL(scriptPath).href;

        const pid = '910100';
        const rawCoverageDir = makeScratchDir('raw');
        // First flush: ONE dump, both script instances present, each with its own anchor -- the real
        // pid-1760879 shape exactly (one file, one url, two distinct scriptIds).
        writeJson(join(rawCoverageDir, `coverage-${pid}-1700000000000-0.json`), {
            result: [
                { functions: [topLevelFunctionEntry(jsSource.length, 1)], scriptId: 'native', url },
                { functions: fooWorkerFunctions(), scriptId: 'runner', url },
            ],
        });
        // Second flush, same pid: an anchor-less delta for scriptId "runner" only -- the SAME inner
        // closure (fooExecutedRanges()) invoked again.
        writeJson(join(rawCoverageDir, `coverage-${pid}-1700000000000-1.json`), {
            result: [{ functions: [innerFunctionEntry(fooExecutedRanges())], scriptId: 'runner', url }],
        });
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeTransformCapture(transformCaptureDir, pid, [fooCapture(scriptPath, repoRoot, jsSource)]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        // The native instance's own single whole-script range [0, jsSource.length) contains distLine1
        // too (an always-taken top-level statement, correctly inheriting the module's own call count) --
        // 1. The runner instance's first dump contributes 5, and the anchor-less delta -- correctly
        // reverse-translated through the runner instance's own capture, never treated as the coexisting
        // native instance's identity mapping -- contributes another 5. Sum: 1 + 5 + 5 = 11.
        expect(result.records[0].entries.find(entry => entry.startOffset === distLine1)?.count).toBe(11);
    });

    it('fails closed as malformed-transform-capture when a same-pid captured code (matched by its own wrapped length) has no usable source map', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const pid = '910041';
        const code = 'this differs from the on-disk dist body entirely;\n';
        const wrapperPrefixLength = 0;
        const topEnd = wrappedLengthOf(wrapperPrefixLength, code);
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(topEnd)], url: pathToFileURL(scriptPath).href },
        ]);
        const transformCaptureDir = makeScratchDir('transform-capture-no-map');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                code,
                distSourceHash: sha256Hex(readFileSync(scriptPath, 'utf8')),
                map: null,
                url: pathToFileURL(scriptPath).href,
                wrapperPrefixLength,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('malformed-transform-capture');
    });

    it('fails closed as malformed-transform-capture when a same-pid captured code\'s own map resolves to a different source than the dist file\'s own map', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        writeFile(join(repoRoot, 'src/model/Other.ts'), 'export const other = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const pid = '910051';
        const code = 'this differs from the on-disk dist body entirely;\n';
        const wrapperPrefixLength = 0;
        const topEnd = wrappedLengthOf(wrapperPrefixLength, code);
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(topEnd)], url: pathToFileURL(scriptPath).href },
        ]);
        const transformCaptureDir = makeScratchDir('transform-capture-wrong-source');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                code,
                distSourceHash: sha256Hex(readFileSync(scriptPath, 'utf8')),
                map: {
                    mappings: DEFAULT_MAPPINGS,
                    names: [],
                    sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Other.ts'))],
                    version: 3,
                },
                url: pathToFileURL(scriptPath).href,
                wrapperPrefixLength,
            },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('malformed-transform-capture');
    });

    it('fails closed as malformed-transform-capture when the same pid writes two byte-identical-content captures for the same path with disagreeing distSourceHash', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const pid = '910061';
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [{ url: pathToFileURL(scriptPath).href }]);
        const transformCaptureDir = makeScratchDir('transform-capture-disagree');
        const capture = (distSourceHash: string) => ({
            code: 'identical code;\n',
            distSourceHash,
            map: { mappings: DEFAULT_MAPPINGS, names: [], sources: ['unset.ts'], version: 3 },
            url: pathToFileURL(scriptPath).href,
            wrapperPrefixLength: 0,
        });
        // Same pid, same code+wrapperPrefixLength (would otherwise be deduplicated as a harmless
        // duplicate observation) -- but disagreeing distSourceHash is a genuine contradiction: the same
        // pid captured the same resolved path, so it can only ever have transformed it from the one
        // on-disk file that pid sees.
        writeTransformCapture(transformCaptureDir, pid, [capture(sha256Hex('content-a'))], 'a');
        writeTransformCapture(transformCaptureDir, pid, [capture(sha256Hex('content-b'))], 'b');

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('malformed-transform-capture');
    });

    it('fails closed as ambiguous-raw-offset-space when two distinct-code captures for the same pid+path both match the record\'s own (non-native) top-level end', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const distSourceHash = sha256Hex(readFileSync(scriptPath, 'utf8'));
        const pid = '910065';
        // Two captures, deliberately constructed to share the exact same wrapped length despite
        // different content and different wrapperPrefixLength (e.g. `injectCjsGlobals` detection
        // genuinely differed between two distinct observations for some reason) -- a real ambiguity the
        // discovery pass must never silently resolve by picking one.
        const codeA = 'aaaa';
        const codeB = 'bb';
        const wrapperPrefixLengthA = 0;
        const wrapperPrefixLengthB = 2;
        const topEnd = wrappedLengthOf(wrapperPrefixLengthA, codeA);
        expect(wrappedLengthOf(wrapperPrefixLengthB, codeB)).toBe(topEnd);

        const transformCaptureDir = makeScratchDir('transform-capture-ambiguous');
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeA,
                    distSourceHash,
                    map: { mappings: DEFAULT_MAPPINGS, names: [], sources: ['unset.ts'], version: 3 },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength: wrapperPrefixLengthA,
                },
            ],
            'a',
        );
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeB,
                    distSourceHash,
                    map: { mappings: DEFAULT_MAPPINGS, names: [], sources: ['unset.ts'], version: 3 },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength: wrapperPrefixLengthB,
                },
            ],
            'b',
        );

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(topEnd)], url: pathToFileURL(scriptPath).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('ambiguous-raw-offset-space');
    });

    it('fails closed as ambiguous-raw-offset-space when the on-disk dist length coincidentally equals a candidate capture\'s own wrapped length and its content genuinely differs', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const jsSource = readFileSync(scriptPath, 'utf8');
        const pid = '910066';
        // A capture whose OWN wrapped length is deliberately engineered to equal the on-disk dist
        // length exactly, with genuinely different content -- the record's own top-level end (below)
        // also equals that same shared length, so this measurement alone cannot tell "native" from
        // "wrapped, coincidentally the same total length" apart.
        const wrapperPrefixLength = 0;
        const collidingCodeLength = jsSource.length - 3;
        const collidingCode = 'x'.repeat(Math.max(0, collidingCodeLength));
        expect(wrappedLengthOf(wrapperPrefixLength, collidingCode)).toBe(jsSource.length);

        const transformCaptureDir = makeScratchDir('transform-capture-collision');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                code: collidingCode,
                distSourceHash: sha256Hex(jsSource),
                map: { mappings: DEFAULT_MAPPINGS, names: [], sources: ['unset.ts'], version: 3 },
                url: pathToFileURL(scriptPath).href,
                wrapperPrefixLength,
            },
        ]);

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(jsSource.length)], url: pathToFileURL(scriptPath).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('ambiguous-raw-offset-space');
    });

    it('GREEN: two distinct-content candidate captures matching the same wrapped length are accepted when their own translations agree at every dist position', () => {
        // Real shape of `model/Configuration.js`: two same-pid transform captures for the
        // identical resolved script, textually different (so the exact-content dedup above does not
        // collapse them into one) yet sharing the exact same wrapped length -- plausible for a script
        // like `Configuration.js`, loaded through Vitest's module runner by more than one test in this
        // repository with its own, differently-worded `fs`/`node:fs` mock (mocking what a script IMPORTS
        // never changes Vite's own transform of that script's OWN source text, so two runs are normally
        // byte-identical, UNLESS something else attached per evaluation happens to differ while
        // preserving the exact total length -- e.g. same-length identifiers, as here). When the two
        // candidates' own translations provably agree everywhere (identical source map, identical code
        // line structure, identical wrapperPrefixLength -- only a same-length identifier differs), the
        // choice between them carries no risk, so this is accepted instead of failing closed.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const distSourceHash = sha256Hex(readFileSync(scriptPath, 'utf8'));
        const pid = '3978929';
        // Two captures differing ONLY in a same-length identifier ('aaa' vs 'bbb') -- identical length,
        // identical line structure, identical wrapperPrefixLength, and (critically) the SAME explicit
        // source map, since renaming a local identifier does not change which source positions the
        // surrounding statements map to.
        const sharedMapping = buildMappings([{ genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 }]);
        const codeA = 'const aaa = 1;\nexports.x = aaa;\n';
        const codeB = 'const bbb = 1;\nexports.x = bbb;\n';
        expect(codeA.length).toBe(codeB.length);
        const wrapperPrefixLength = 10;
        const topEnd = wrappedLengthOf(wrapperPrefixLength, codeA);
        expect(wrappedLengthOf(wrapperPrefixLength, codeB)).toBe(topEnd);

        const transformCaptureDir = makeScratchDir('transform-capture-equivalent');
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeA,
                    distSourceHash,
                    map: {
                        mappings: sharedMapping,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength,
                },
            ],
            'a',
        );
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeB,
                    distSourceHash,
                    map: {
                        mappings: sharedMapping,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength,
                },
            ],
            'b',
        );

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(topEnd, 4)], url: pathToFileURL(scriptPath).href },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });

        expect(result.records).toHaveLength(1);
        // The record is accepted (never excluded/failed) and its count is attributed -- exactly the same
        // result no matter which of the two equivalent candidates the discovery pass happened to pick.
        expect(result.records[0].entries.some(entry => entry.count === 4)).toBe(true);
    });

    it('RED: two same-length, distinct-content candidate captures matching the same wrapped length still fail closed when their own translations diverge for some dist position', () => {
        // Same overall shape as the GREEN test above (same-length code, same wrapperPrefixLength -- the
        // real `Configuration.js` shape this is modeled on) but the two candidates' own source maps
        // point the SAME dist query at two DIFFERENT generated lines -- a genuine, not merely textual,
        // difference in what each candidate's own translation would produce. `candidateTranslationsAreEquivalent`
        // must detect this divergence and this must still fail closed exactly as before, never guess
        // which of the two disagreeing candidates is correct.
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const distSourceHash = sha256Hex(readFileSync(scriptPath, 'utf8'));
        const pid = '3978930';
        const codeA = 'const aaa = 1;\nexports.x = aaa;\n';
        const codeB = 'const bbb = 1;\nexports.x = bbb;\n';
        expect(codeA.length).toBe(codeB.length);
        const wrapperPrefixLength = 10;
        const topEnd = wrappedLengthOf(wrapperPrefixLength, codeA);
        expect(wrappedLengthOf(wrapperPrefixLength, codeB)).toBe(topEnd);
        // Candidate A maps the dist file's one query point to generated line 1 (`exports.x = aaa;`);
        // candidate B maps the SAME dist query point to generated line 0 (`const bbb = 1;`) instead --
        // different generated offsets, a real divergence.
        const mappingA = buildMappings([{ genColumn: 0, genLine: 1, srcColumn: 0, srcLine: 0 }]);
        const mappingB = buildMappings([{ genColumn: 0, genLine: 0, srcColumn: 0, srcLine: 0 }]);

        const transformCaptureDir = makeScratchDir('transform-capture-divergent');
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeA,
                    distSourceHash,
                    map: {
                        mappings: mappingA,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength,
                },
            ],
            'a',
        );
        writeTransformCapture(
            transformCaptureDir,
            pid,
            [
                {
                    code: codeB,
                    distSourceHash,
                    map: {
                        mappings: mappingB,
                        names: [],
                        sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                        version: 3,
                    },
                    url: pathToFileURL(scriptPath).href,
                    wrapperPrefixLength,
                },
            ],
            'b',
        );

        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            { functions: [topLevelFunctionEntry(topEnd, 4)], url: pathToFileURL(scriptPath).href },
        ]);

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('ambiguous-raw-offset-space');
    });

    it('fails closed as malformed-transform-capture when a capture filename does not follow the transform-<pid>-... naming convention', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, '910071', [{ url: pathToFileURL(scriptPath).href }]);
        const transformCaptureDir = makeScratchDir('transform-capture-bad-name');
        writeJson(join(transformCaptureDir, 'not-a-transform-capture.json'), { captures: [] });

        expect(
            reasonOf(() =>
                discoverCompiledSnapshotCoverage({
                    rawCoverageDir,
                    repositoryRoot: repoRoot,
                    snapshotRoots: [root],
                    transformCaptureDir,
                }),
            ),
        ).toBe('malformed-transform-capture');
    });

    it('a capture whose code is byte-identical to the on-disk dist file is still translated when its own top-level range proves it was wrapped (byte-identical content does not imply the wrapper was skipped)', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        writeCompiledScript(scriptPath, {
            body: DIST_BODY,
            mappings: FOO_SOURCE_MAPPINGS,
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const jsSource = readFileSync(scriptPath, 'utf8');
        const wrapperPrefixLength = 64;
        const topEnd = wrappedLengthOf(wrapperPrefixLength, jsSource);
        const pid = '910081';
        const rawCoverageDir = makeScratchDir('raw');
        const line1 = lineStartOffset(jsSource, 1);
        const line2 = lineStartOffset(jsSource, 2);
        writeRawCoverageForPid(rawCoverageDir, pid, [
            {
                functions: [
                    innerFunctionEntry([{ count: 7, endOffset: wrapperPrefixLength + line2, startOffset: wrapperPrefixLength + line1 }]),
                    topLevelFunctionEntry(topEnd),
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);
        const transformCaptureDir = makeScratchDir('transform-capture-identical');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                // Byte-identical to the on-disk dist file's own full text -- Vitest's wrapper is applied
                // unconditionally regardless of whether the SSR transform changed any content, so this
                // record's offsets still need the same shift.
                code: jsSource,
                distSourceHash: sha256Hex(jsSource),
                map: {
                    mappings: FOO_SOURCE_MAPPINGS,
                    names: [],
                    sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                    version: 3,
                },
                url: pathToFileURL(scriptPath).href,
                wrapperPrefixLength,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });
        expect(result.records[0].entries.find(entry => entry.startOffset === line1)?.count).toBe(7);
    });

    it('a raw range ending mid-token does not truncate the last token off the translated dist span', () => {
        const repoRoot = makeScratchDir('repo');
        writeFile(join(repoRoot, 'src/model/Foo.ts'), 'export const foo = 1;');
        const root = join(makeScratchDir('artifacts'), 'compiled-dist-a/dist');
        const scriptPath = join(root, 'model/Foo.js');
        // Three dist mapping points on three separate lines -- the middle one is the span whose own
        // *end* this test's translated range must resolve to (the *next* point's own offset, line 2),
        // never its *own* start (line 1's offset, which would truncate the whole middle statement to
        // zero width).
        const distBody = '"use strict";\nexports.a = 1;\nexports.b = 2;\nexports.c = 3;\n';
        const distLine1 = lineStartOffset(distBody, 1);
        const distLine2 = lineStartOffset(distBody, 2);
        const distLine3 = lineStartOffset(distBody, 3);
        writeCompiledScript(scriptPath, {
            body: distBody,
            mappings: buildMappings([
                { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
                { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
                { genColumn: 0, genLine: 3, srcColumn: 8, srcLine: 8 },
            ]),
            sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
        });
        const jsSource = readFileSync(scriptPath, 'utf8');

        // Executed code identical in shape (one injected line 0, then the same three statement lines).
        const executedCode =
            '__vite_ssr_exportName__("default", () => {});\nexports.a = 1;\nexports.b = 2;\nexports.c = 3;\n';
        const codeLine2 = lineStartOffset(executedCode, 2);
        const codeLine3 = lineStartOffset(executedCode, 3);
        const topEnd = wrappedLengthOf(WRAPPER_PREFIX_LENGTH, executedCode);
        const pid = '910091';
        const transformCaptureDir = makeScratchDir('transform-capture');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                code: executedCode,
                distSourceHash: sha256Hex(jsSource),
                map: {
                    mappings: buildMappings([
                        { genColumn: 0, genLine: 1, srcColumn: 8, srcLine: 4 },
                        { genColumn: 0, genLine: 2, srcColumn: 8, srcLine: 6 },
                        { genColumn: 0, genLine: 3, srcColumn: 8, srcLine: 8 },
                    ]),
                    names: [],
                    sources: [sourceEntryFor(scriptPath, join(repoRoot, 'src/model/Foo.ts'))],
                    version: 3,
                },
                url: pathToFileURL(scriptPath).href,
                wrapperPrefixLength: WRAPPER_PREFIX_LENGTH,
            },
        ]);

        // A raw range that starts exactly at the middle statement's own line and ends 1 byte INTO the
        // next line (mid-token, mirroring how a real V8 range's own end can fall strictly inside the
        // generated text a mapping point starts, not exactly on a later point) -- the translated dist
        // end must still be `distLine3` (the *next* dist mapping point's own offset), not
        // `distLine2` (the containing point's own start, which would report the whole `exports.b = 2;`
        // statement as zero width / truncated).
        const rawCoverageDir = makeScratchDir('raw');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            {
                functions: [
                    innerFunctionEntry([
                        {
                            count: 9,
                            endOffset: WRAPPER_PREFIX_LENGTH + codeLine3 + 1,
                            startOffset: WRAPPER_PREFIX_LENGTH + codeLine2,
                        },
                    ]),
                    topLevelFunctionEntry(topEnd),
                ],
                url: pathToFileURL(scriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: repoRoot,
            snapshotRoots: [root],
            transformCaptureDir,
        });
        const [record] = result.records;
        const translated = record.entries.find(entry => entry.startOffset === distLine2);
        expect(translated).toBeDefined();
        expect(translated?.endOffset).toBe(distLine3);
        expect(translated?.count).toBe(9);
        // The first statement (distLine1..distLine2) is untouched by this range -- still its own
        // genuinely-unobserved 0, not swallowed into the translated span.
        expect(record.entries.find(entry => entry.startOffset === distLine1)?.count).toBe(0);
    });

    it('a REAL Vitest-transformed module capture (obtained via a live dynamic import inside this test file own Vitest worker, not a hand-authored stand-in) translates correctly against a hand-authored dist file mapped to the same source', async () => {
        // A tiny, real compiled-snapshot-shaped module, actually imported through Vite's own SSR
        // module runner (this test file itself runs under that same runner) so `node.meta.code` below
        // is genuinely whatever Vite's real SSR transform produces today -- not a hand-authored guess
        // at its shape.
        const fixtureRoot = join(resolve('test/server/.artifacts'), `d5-real-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        scratchDirs.push(fixtureRoot);
        const realScriptPath = join(fixtureRoot, 'dist/RealFixture.js');
        const realSourcePath = join(fixtureRoot, 'src/RealFixture.ts');
        writeFile(realSourcePath, 'export const realFixtureValue = 42;\n');
        const realDistBody =
            '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.realFixtureValue = 42;\n';
        writeCompiledScript(realScriptPath, {
            body: realDistBody,
            mappings: buildMappings([{ genColumn: 0, genLine: 2, srcColumn: 0, srcLine: 0 }]),
            sources: [sourceEntryFor(realScriptPath, realSourcePath)],
        });
        const realJsSource = readFileSync(realScriptPath, 'utf8');

        await import(/* @vite-ignore */ pathToFileURL(realScriptPath).href);

        const state = (globalThis as { __vitest_worker__?: unknown }).__vitest_worker__ as
            | {
                  config?: { injectCjsGlobals?: boolean };
                  evaluatedModules?: {
                      idToModuleMap: Map<string, { meta?: { code?: unknown; moduleType?: unknown } }>;
                      getModuleSourceMapById(id: string): { map?: { mappings?: string; sources?: string[] } } | null;
                  };
              }
            | undefined;
        const node = state?.evaluatedModules?.idToModuleMap.get(realScriptPath);
        expect(node).toBeDefined();
        const realCode = node?.meta?.code;
        expect(typeof realCode).toBe('string');
        const realMap = state?.evaluatedModules?.getModuleSourceMapById(realScriptPath)?.map;
        expect(realMap?.mappings).toBeDefined();
        expect(realMap?.sources?.[0]).toContain('RealFixture.ts');

        // This is genuinely different from the on-disk dist body -- Vite's real SSR transform rewrites
        // the CJS export shape -- so the translation path (not the byte-identical fast path) is what
        // this assertion below actually exercises.
        expect(realCode).not.toBe(realDistBody);

        const injectCjsGlobals = (state?.config?.injectCjsGlobals ?? true) || node?.meta?.moduleType === 'cjs';
        const wrapperPrefixLength = computeWrapperPrefixLength(injectCjsGlobals);
        const topEnd = wrappedLengthOf(wrapperPrefixLength, realCode as string);

        // Find "exports.realFixtureValue" inside the REAL captured code at test time (never
        // hand-computed), so this test adapts to whatever Vite's real transform actually emits instead
        // of asserting an exact byte offset that could silently drift with a Vite upgrade. This is the
        // dist file's ONE mapping point's own generated text (`{ genColumn: 0, genLine: 2, srcColumn: 0,
        // srcLine: 0 }`, the start of `exports.realFixtureValue = 42;`, mapped to source (0,0) --
        // `export const realFixtureValue = 42;`'s own start) -- not "42" itself: a source map's mapping
        // segment names where a SOURCE POSITION's generated STATEMENT begins, not an arbitrary later
        // substring inside it, so the reverse-translated query lands here, at the statement's own start.
        const statementText = 'exports.realFixtureValue';
        const statementIndex = (realCode as string).indexOf(statementText);
        expect(statementIndex).toBeGreaterThan(-1);

        // The query for
        // this dist file's ONE statement basis span is translated *backward* into executed-code space
        // (`reverseTranslateDistOffsetToExecuted`) and must land at the nearest-preceding mapping point
        // in Vite's REAL, live-captured map for that dist position.
        //
        // This raw range is the precise window around `exports.realFixtureValue`'s own start, not
        // widened to start from `wrapperPrefixLength` (the very start of the executed body): a wide range
        // would contain whatever position a fallback (`?? mappingPoints[0]` /
        // `?? codeMappingPointsBySource[0]`) happened to land on too, so this fixture could not tell a
        // correct reverse translation apart from a fallback one. An unresolvable query returns `null`,
        // contributing 0, never a fabricated position -- if the reverse translation ever regresses back
        // to landing anywhere else (a `null` result, or any other generated position), this range no
        // longer contains that position and the assertion below goes red instead of silently staying
        // green.
        const pid = '910101';
        const transformCaptureDir = makeScratchDir('transform-capture-real');
        writeTransformCapture(transformCaptureDir, pid, [
            {
                code: realCode as string,
                distSourceHash: sha256Hex(realJsSource),
                map: realMap as { version: number; mappings: string; sources: string[]; names: string[] },
                url: pathToFileURL(realScriptPath).href,
                wrapperPrefixLength,
            },
        ]);
        const rawCoverageDir = makeScratchDir('raw-real');
        writeRawCoverageForPid(rawCoverageDir, pid, [
            {
                functions: [
                    innerFunctionEntry([
                        {
                            count: 6,
                            endOffset: wrapperPrefixLength + statementIndex + statementText.length,
                            startOffset: wrapperPrefixLength + statementIndex,
                        },
                    ]),
                    topLevelFunctionEntry(topEnd),
                ],
                url: pathToFileURL(realScriptPath).href,
            },
        ]);

        const result = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot: fixtureRoot,
            snapshotRoots: [join(fixtureRoot, 'dist')],
            transformCaptureDir,
        });
        expect(result.records).toHaveLength(1);
        const [record] = result.records;
        expect(record.sourcePath).toBe('src/RealFixture.ts');
        // The one dist mapping point (line 2, `exports.realFixtureValue = 42;`) is the only statement
        // basis span -- the reverse-translated query must land exactly inside the precise
        // `exports.realFixtureValue` window
        // above (`exports.realFixtureValue`'s own value literal), not a fallback position, for this count
        // to come through at all.
        expect(record.entries).toHaveLength(1);
        expect(record.entries[0].count).toBe(6);
    });
});

const RECOMPILE_ROOT = resolve('.');
const RECOMPILE_COMPILER_OPTIONS = ts.parseJsonConfigFileContent(
    ts.readConfigFile(join(RECOMPILE_ROOT, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    RECOMPILE_ROOT,
).options;

function sliceSource(text: string, start: { line: number; column: number }, end: { line: number; column: number }): string {
    const lines = text.split('\n');
    const offsetOf = (position: { line: number; column: number }): number =>
        lines.slice(0, position.line - 1).reduce((total, line) => total + line.length + 1, 0) + position.column;
    return text.slice(offsetOf(start), offsetOf(end));
}

interface BasisEntryLike {
    readonly start: { line: number; column: number };
    readonly end: { line: number; column: number };
    readonly startOffset: number;
    readonly endOffset: number;
}

function discoverRecompiled(sourcePath: string, sourceText: string) {
    const repoRoot = makeScratchDir('rewrite-repo');
    writeFile(join(repoRoot, sourcePath), sourceText);
    const compiled = ts.transpileModule(sourceText, {
        compilerOptions: { ...RECOMPILE_COMPILER_OPTIONS, sourceMap: true },
        fileName: sourcePath,
    });
    const root = join(makeScratchDir('rewrite-snap'), 'dist');
    const scriptPath = join(root, sourcePath.replace(/^src\//u, '').replace(/\.ts$/u, '.js'));
    const mapFileName = `${scriptPath.split('/').pop()}.map`;
    const jsBody = `${compiled.outputText.replace(/\/\/# sourceMappingURL=.*\n?$/u, '')}//# sourceMappingURL=${mapFileName}\n`;
    writeFile(scriptPath, jsBody);
    writeJson(`${scriptPath}.map`, {
        ...(JSON.parse(compiled.sourceMapText as string) as Record<string, unknown>),
        file: mapFileName,
        sourceRoot: '',
        sources: [sourceEntryFor(scriptPath, join(repoRoot, sourcePath))],
    });
    const rawCoverageDir = makeScratchDir('rewrite-raw');
    writeRawCoverage(rawCoverageDir, 'coverage-1.json', [
        {
            functions: [
                {
                    functionName: '',
                    isBlockCoverage: true,
                    ranges: [{ count: 1, endOffset: jsBody.length, startOffset: 0 }],
                },
            ],
            url: pathToFileURL(scriptPath).href,
        },
    ]);
    const result = discoverCompiledSnapshotCoverage({ rawCoverageDir, repositoryRoot: repoRoot, snapshotRoots: [root] });
    expect(result.records).toHaveLength(1);
    return result.records[0] as {
        entries: readonly BasisEntryLike[];
        branchEntries: readonly BasisEntryLike[];
    };
}

/**
 * The coverage exclusion approval binds to the excluded code, the function unit that contains it, and the function
 * units recorded as its premise -- not to the whole file's bytes or to a position in it. The real `VideoUtil.ts`
 * and `ReservationManageModel.ts` are rewritten, compiled again with `ts.transpileModule` using the repository's
 * `tsconfig.json`, and passed through discovery: edits that do not touch the bound code keep the approval valid
 * (the same code is excluded, the population shrinks by the same amount), and edits to the bound code fail closed.
 */
describe('discoverCompiledSnapshotCoverage: exclusion approval binds to code content (re-compiled real sources)', () => {
    const REPOSITORY_ROOT = resolve('.');

    interface RewriteTarget {
        readonly sourcePath: string;
        readonly markerIdentifier: string;
        readonly expectedStatements: number;
        readonly expectedBranches: number;
        // Edits that must keep the approval valid. Each receives the marker-less source text.
        readonly keepsApproval: Readonly<Record<string, (text: string) => string>>;
        // Edits that change bound code and must fail the judgment, naming the function unit the failure reports.
        readonly failsApproval: Readonly<Record<string, { readonly unit: string; readonly rewrite: (text: string) => string }>>;
    }

    function replaceOnce(text: string, from: string | RegExp, to: string): string {
        const replaced = text.replace(from, to);
        if (replaced === text) {
            throw new Error(`rewrite did not change the source: ${String(from)}`);
        }
        return replaced;
    }

    function insertBeforeLineContaining(text: string, needle: string, inserted: readonly string[]): string {
        const lines = text.split('\n');
        const index = lines.findIndex(line => line.includes(needle));
        if (index < 0) {
            throw new Error(`no line contains ${needle}`);
        }
        return [...lines.slice(0, index), ...inserted, ...lines.slice(index)].join('\n');
    }

    function addClassMember(text: string, className: string): string {
        const classIndex = text.indexOf(`class ${className}`);
        const braceIndex = text.indexOf('{', classIndex) + 1;
        return `${text.slice(0, braceIndex)}\n    public static unrelatedProbe(): number {\n        return 1;\n    }\n${text.slice(braceIndex)}`;
    }

    const TARGETS: readonly RewriteTarget[] = [
        {
            sourcePath: 'src/model/api/video/VideoUtil.ts',
            markerIdentifier: '__EPGSTATION_COVERAGE_EXCLUSION_R2_VIDEO_UTIL_SETTLED_TRUE_ARM_20260808',
            expectedStatements: 1,
            expectedBranches: 1,
            keepsApproval: {
                'comment lines inside the unit that holds the excluded code': text =>
                    insertBeforeLineContaining(text, 'if (settled) {', ['                // added', '                /* added */']),
                'comment at the top of the file': text => `// header comment\n${text}`,
                'whitespace and line breaks around the excluded code': text =>
                    replaceOnce(text, 'if (settled) {', 'if (settled)\n                {'),
                'trailing comma added by a line break': text =>
                    replaceOnce(text, "reject(new Error('VideoInfoTimeout'));", "reject(\n                    new Error('VideoInfoTimeout'),\n                );"),
                'a member that holds no excluded code added to the class': text => addClassMember(text, 'VideoUtil'),
            },
            failsApproval: {
                'the excluded code changed': {
                    rewrite: text => replaceOnce(text, /if \(settled\) \{\n(\s*)return;/u, 'if (settled) {\n$1return undefined;'),
                    unit: 'VideoUtil.getInfo',
                },
                'other code in the unit that holds the excluded code changed': {
                    rewrite: text => replaceOnce(text, 'const stopGraceMilliseconds = 3_000;', 'const stopGraceMilliseconds = 3_001;'),
                    unit: 'VideoUtil.getInfo',
                },
            },
        },
        {
            sourcePath: 'src/model/operator/reservation/ReservationManageModel.ts',
            markerIdentifier: '__EPGSTATION_COVERAGE_EXCLUSION_RESERVATION_MANAGE_DIFF_LOG_AND_SORT_20260924',
            expectedStatements: 5,
            expectedBranches: 3,
            keepsApproval: {
                'comment lines inside the unit that holds the excluded code': text =>
                    insertBeforeLineContaining(text, 'insert: typeof diff.insert', ['                // added', '                /* added */']),
                'comment at the top of the file': text => `// header comment\n// second line\n${text}`,
                'whitespace and line breaks around the excluded code': text =>
                    replaceOnce(
                        text,
                        "update: typeof diff.update === 'undefined' ? 0 : diff.update.length,",
                        "update: typeof diff.update === 'undefined'\n                    ? 0\n                    : diff.update.length,",
                    ),
                'trailing comma removed by a line break': text =>
                    replaceOnce(text, 'diff.delete.length,\n            });', 'diff.delete.length\n            });'),
                'a member that holds no excluded code added to the class': text => addClassMember(text, 'ReservationManageModel'),
            },
            failsApproval: {
                'the excluded code changed': {
                    rewrite: text =>
                        replaceOnce(text, "insert: typeof diff.insert === 'undefined' ? 0 :", "insert: typeof diff.insert === 'undefined' ? 1 :"),
                    unit: 'ReservationManageModel.createDiff',
                },
                'other code in the unit that holds the excluded code changed': {
                    rewrite: text =>
                        replaceOnce(text, 'if (isSuppressLog === false) {\n            this.log.system.info({', 'if (isSuppressLog !== true) {\n            this.log.system.info({'),
                    unit: 'ReservationManageModel.createDiff',
                },
                'code in a unit recorded as the premise changed': {
                    rewrite: text => replaceOnce(text, 'diff.update = [];', 'diff.update = [];\n        diff.update.length = 0;'),
                    unit: 'ReservationManageModel.createReservesDiff',
                },
            },
        },
    ];

    function withMarker(target: RewriteTarget, markerlessText: string): string {
        return `${markerlessText}declare const ${target.markerIdentifier}: unique symbol;\n`;
    }

    function readMarkerlessSource(target: RewriteTarget): string {
        const markerLine = `declare const ${target.markerIdentifier}: unique symbol;\n`;
        const text = readFileSync(join(REPOSITORY_ROOT, target.sourcePath), 'utf8');
        expect(text.endsWith(markerLine)).toBe(true);
        return text.slice(0, text.length - markerLine.length);
    }

    // The code text of every entry the approval removes: the entries of the marker-less compile that the
    // marker-bearing compile no longer has (both compile the same code, so entries pair by compiled span).
    function removedCodes(target: RewriteTarget, markerlessText: string) {
        const present = discoverRecompiled(target.sourcePath, withMarker(target, markerlessText));
        const absent = discoverRecompiled(target.sourcePath, markerlessText);
        const spanOf = (entry: BasisEntryLike): string => `${entry.startOffset}:${entry.endOffset}`;
        const removedOf = (presentEntries: readonly BasisEntryLike[], absentEntries: readonly BasisEntryLike[]) => {
            const kept = new Set(presentEntries.map(spanOf));
            return absentEntries
                .filter(entry => !kept.has(spanOf(entry)))
                .map(entry => sliceSource(markerlessText, entry.start, entry.end))
                .sort();
        };
        return {
            branches: removedOf(present.branchEntries, absent.branchEntries),
            presentBranches: present.branchEntries.length,
            presentStatements: present.entries.length,
            statements: removedOf(present.entries, absent.entries),
            totalBranches: absent.branchEntries.length,
            totalStatements: absent.entries.length,
        };
    }

    for (const target of TARGETS) {
        describe(target.sourcePath, () => {
            const markerless = readMarkerlessSource(target);
            let memoizedBaseline: ReturnType<typeof removedCodes> | undefined;
            const baseline = () => {
                memoizedBaseline ??= removedCodes(target, markerless);
                return memoizedBaseline;
            };

            it('the unmodified source resolves the approval and removes exactly the approved entries', () => {
                const removed = baseline();
                expect(removed.statements).toHaveLength(target.expectedStatements);
                expect(removed.branches).toHaveLength(target.expectedBranches);
            }, REAL_SOURCE_DISCOVERY_TIMEOUT_MS);

            for (const [name, rewrite] of Object.entries(target.keepsApproval)) {
                it(`keeps the approval valid: ${name}`, () => {
                    const before = baseline();
                    const rewritten = rewrite(markerless);
                    expect(rewritten).not.toBe(markerless);
                    const after = removedCodes(target, rewritten);
                    expect(after.statements).toEqual(before.statements);
                    expect(after.branches).toEqual(before.branches);
                    // The population shrinks by exactly the removed entries.
                    expect(after.presentStatements).toBe(after.totalStatements - after.statements.length);
                    expect(after.presentBranches).toBe(after.totalBranches - after.branches.length);
                }, REAL_SOURCE_DISCOVERY_TIMEOUT_MS);
            }

            for (const [name, { rewrite, unit }] of Object.entries(target.failsApproval)) {
                it(`fails the judgment: ${name}`, () => {
                    const rewritten = rewrite(markerless);
                    expect(rewritten).not.toBe(markerless);
                    const error = errorOf(() => discoverRecompiled(target.sourcePath, withMarker(target, rewritten)));
                    expect(error?.reason).toBe('malformed-coverage-exclusion');
                    // The message names the function unit that changed, so the approval can be reviewed again.
                    expect(error?.message).toContain(`"${unit}"`);
                }, REAL_SOURCE_DISCOVERY_TIMEOUT_MS);
            }
        });
    }
});

/**
 * Function units, their fingerprints, and resolving an approval's anchors against the basis, exercised on a
 * synthetic source with synthetic approvals: `describeFunctionUnitBinding` derives the units, fingerprints and
 * entry anchors, and `applyCoverageExclusions` resolves an approval given as an argument.
 */
describe('applyCoverageExclusions: function unit binding of an approval (synthetic source and approvals)', () => {
    const SOURCE_PATH = 'src/synthetic/Subject.ts';
    const SOURCE = [
        'export class Subject {',
        '    private readonly seen: number[] = [];',
        '    public constructor(private readonly limit: number) {}',
        '    public check(value: number): number {',
        '        if (value > this.limit) {',
        '            return -1;',
        '        }',
        '        const doubled = [',
        '            value,',
        '            value,',
        '        ];',
        '        return doubled.length + this.seen.length;',
        '    }',
        '    public premise(): number {',
        '        return this.limit;',
        '    }',
        '}',
        'export function helper(x: number): number {',
        '    return x + 1;',
        '}',
        'export const arrow = (x: number): number => x * 2;',
        '',
    ].join('\n');

    interface Described {
        readonly code: string;
        readonly functionName: string;
        readonly tokenEnd: number;
        readonly tokenStart: number;
    }

    const api = compiledSnapshotCoverage as unknown as {
        applyCoverageExclusions: (input: {
            sourcePath: string;
            sourceText: string;
            authorization: unknown;
            statementEntries: readonly unknown[];
            branchEntries: readonly unknown[];
        }) => { statementEntries: readonly unknown[]; branchEntries: readonly unknown[] };
        describeFunctionUnitBinding: (input: {
            sourcePath: string;
            sourceText: string;
            statementEntries: readonly unknown[];
            branchEntries: readonly unknown[];
        }) => {
            statements: readonly (Described | null)[];
            branches: readonly (Described | null)[];
            units: readonly { name: string; codeSha256: string; tokenCount: number; tokens: readonly string[] }[];
        };
    };

    function basisOf(sourceText: string, sourcePath = SOURCE_PATH) {
        const record = discoverRecompiled(sourcePath, sourceText);
        return { branchEntries: record.branchEntries, statementEntries: record.entries };
    }

    function describeSource(sourceText: string, sourcePath = SOURCE_PATH) {
        return api.describeFunctionUnitBinding({ sourcePath, sourceText, ...basisOf(sourceText, sourcePath) });
    }

    function fingerprintOf(sourceText: string, unitName: string): string {
        const unit = describeSource(sourceText).units.find(candidate => candidate.name === unitName);
        if (unit === undefined) {
            throw new Error(`no unit ${unitName}`);
        }
        return unit.codeSha256;
    }

    function approvalFor(sourceText: string, picked: { statement?: Described; branch?: Described }, bound: readonly string[]) {
        const { units } = describeSource(sourceText);
        const anchorOf = (described: Described) => ({
            code: described.code,
            functionName: described.functionName,
            tokenEnd: described.tokenEnd,
            tokenStart: described.tokenStart,
        });
        return {
            boundFunctions: bound.map(name => ({
                codeSha256: units.find(unit => unit.name === name)!.codeSha256,
                name,
            })),
            branchAnchors: picked.branch === undefined ? [] : [anchorOf(picked.branch)],
            statementAnchors: picked.statement === undefined ? [] : [anchorOf(picked.statement)],
        };
    }

    // The first entry of `functionName` whose code is exactly `code`, provided no other entry has the same range.
    function pick(described: readonly (Described | null)[], functionName: string, code: string): Described {
        const found = described.filter(
            (entry): entry is Described => entry !== null && entry.functionName === functionName && entry.code === code,
        );
        expect(found.length).toBeGreaterThan(0);
        const first = found[0];
        expect(found.filter(entry => entry.tokenStart === first.tokenStart && entry.tokenEnd === first.tokenEnd)).toHaveLength(1);
        return first;
    }

    function applyTo(sourceText: string, authorization: unknown, basis = basisOf(sourceText)) {
        return api.applyCoverageExclusions({
            authorization,
            branchEntries: basis.branchEntries,
            sourcePath: SOURCE_PATH,
            sourceText,
            statementEntries: basis.statementEntries,
        });
    }

    function failureOf(run: () => unknown) {
        const error = errorOf(run);
        expect(error?.reason).toBe('malformed-coverage-exclusion');
        return error?.message ?? '';
    }

    it('names the function units: class members, property initializers, constructors, and declarations directly in the file', () => {
        expect(describeSource(SOURCE).units.map(unit => unit.name)).toEqual([
            'Subject.seen',
            'Subject.constructor',
            'Subject.check',
            'Subject.premise',
            'function helper',
            'const arrow',
        ]);
    });

    it('fingerprints a unit by its tokens: comments, whitespace, line breaks and a trailing comma before a closing bracket do not change it', () => {
        const base = fingerprintOf(SOURCE, 'Subject.check');
        const rewrites = [
            SOURCE.replace('        if (value', '        // a comment\n        /* another */\n        if (value'),
            SOURCE.replace('    public check', '    /** doc comment */\n    public check'),
            SOURCE.replace('if (value > this.limit) {', 'if (value   >\n this.limit)\n {'),
            SOURCE.replace('            value,\n        ];', '            value\n        ];'),
            SOURCE.replace('const doubled = [', 'const doubled = [ // trailing line comment'),
        ];
        for (const rewritten of rewrites) {
            expect(rewritten).not.toBe(SOURCE);
            expect(fingerprintOf(rewritten, 'Subject.check')).toBe(base);
        }
    });

    it('fingerprints a unit by its code: a changed token, a string quote, or an added statement changes it, and other units keep theirs', () => {
        const base = fingerprintOf(SOURCE, 'Subject.check');
        for (const rewritten of [
            SOURCE.replace('return -1;', 'return -2;'),
            SOURCE.replace('this.limit)', 'this.limit);\n        void 0;\n        if (false'),
            SOURCE.replace('value > this.limit', 'value >= this.limit'),
        ]) {
            expect(rewritten).not.toBe(SOURCE);
            expect(fingerprintOf(rewritten, 'Subject.check')).not.toBe(base);
            expect(fingerprintOf(rewritten, 'Subject.premise')).toBe(fingerprintOf(SOURCE, 'Subject.premise'));
        }
        expect(fingerprintOf(SOURCE.replace('return x + 1;', "return x + 1; 'a';"), 'function helper')).not.toBe(
            fingerprintOf(SOURCE.replace('return x + 1;', 'return x + 1; "a";'), 'function helper'),
        );
    });

    it('describes each basis entry by its unit and token range, and removes exactly the entry an anchor resolves to', () => {
        const basis = basisOf(SOURCE);
        const { statements } = describeSource(SOURCE);
        const target = pick(statements, 'Subject.check', 'return');
        expect(target.code).toBe('return');
        const authorization = approvalFor(SOURCE, { statement: target }, ['Subject.check']);

        const result = applyTo(SOURCE, authorization, basis);
        expect(result.statementEntries).toHaveLength(basis.statementEntries.length - 1);
        expect(result.branchEntries).toHaveLength(basis.branchEntries.length);
        const removed = basis.statementEntries.filter(entry => !result.statementEntries.includes(entry));
        expect(removed).toHaveLength(1);
    });

    it('resolves a branch anchor independently of the statement anchors', () => {
        const { branches } = describeSource(SOURCE);
        const branch = pick(branches, 'Subject.check', '{ return - 1 ; }');
        const basis = basisOf(SOURCE);
        const result = applyTo(SOURCE, approvalFor(SOURCE, { branch }, ['Subject.check']), basis);
        expect(result.branchEntries).toHaveLength(basis.branchEntries.length - 1);
        expect(result.statementEntries).toHaveLength(basis.statementEntries.length);
    });

    it('keeps resolving the same entry after a comment, a line break, and code added outside the bound units', () => {
        const target = pick(describeSource(SOURCE).statements, 'Subject.check', 'return');
        const authorization = approvalFor(SOURCE, { statement: target }, ['Subject.check']);
        const rewritten = `// header\n${SOURCE.replace('    public premise', '    public added(): number {\n        return 3;\n    }\n    public premise').replace('            return -1;', '            // why\n            return -\n                1;')}`;
        const basis = basisOf(rewritten);
        const result = applyTo(rewritten, authorization, basis);
        expect(result.statementEntries).toHaveLength(basis.statementEntries.length - 1);
        const removedIndexes = basis.statementEntries.flatMap((entry, index) => (result.statementEntries.includes(entry) ? [] : [index]));
        expect(removedIndexes).toHaveLength(1);
        expect(describeSource(rewritten).statements[removedIndexes[0]]?.code).toBe(target.code);
    });

    it('fails when an anchor resolves to no basis entry, naming the anchor and the count', () => {
        const authorization = {
            boundFunctions: [{ codeSha256: fingerprintOf(SOURCE, 'Subject.premise'), name: 'Subject.premise' }],
            branchAnchors: [],
            statementAnchors: [{ code: 'public premise', functionName: 'Subject.premise', tokenEnd: 2, tokenStart: 0 }],
        };
        const message = failureOf(() => applyTo(SOURCE, authorization));
        expect(message).toContain('Subject.premise[0,2)');
        expect(message).toContain('resolves to 0 basis entries');
    });

    it('fails when an anchor resolves to two basis entries (two compiled spans on one source range), naming the count', () => {
        const source = ['export class Holder {', '    public constructor(private readonly value: number) {}', '}', ''].join('\n');
        const basis = basisOf(source, 'src/synthetic/Holder.ts');
        const described = api.describeFunctionUnitBinding({
            sourcePath: 'src/synthetic/Holder.ts',
            sourceText: source,
            ...basis,
        });
        const keys = described.statements.filter((entry): entry is Described => entry !== null).map(entry => `${entry.tokenStart}:${entry.tokenEnd}`);
        const duplicated = keys.find((key, index) => keys.indexOf(key) !== index);
        expect(duplicated).toBeDefined();
        const target = described.statements.find(
            (entry): entry is Described => entry !== null && `${entry.tokenStart}:${entry.tokenEnd}` === duplicated,
        )!;
        const authorization = {
            boundFunctions: [
                { codeSha256: described.units.find(unit => unit.name === 'Holder.constructor')!.codeSha256, name: 'Holder.constructor' },
            ],
            branchAnchors: [],
            statementAnchors: [{ ...target }],
        };
        const message = errorOf(() =>
            api.applyCoverageExclusions({
                authorization,
                branchEntries: basis.branchEntries,
                sourcePath: 'src/synthetic/Holder.ts',
                sourceText: source,
                statementEntries: basis.statementEntries,
            }),
        )?.message;
        expect(message).toContain('resolves to 2 basis entries');
    });

    it('fails when two anchors resolve to the same basis entry', () => {
        const target = pick(describeSource(SOURCE).statements, 'Subject.check', 'return');
        const authorization = approvalFor(SOURCE, { statement: target }, ['Subject.check']);
        const twice = { ...authorization, statementAnchors: [...authorization.statementAnchors, ...authorization.statementAnchors] };
        expect(failureOf(() => applyTo(SOURCE, twice))).toContain('another anchor already removes');
    });

    it('fails when a bound unit name matches no unit or more than one unit, naming the name and the count', () => {
        const authorization = { boundFunctions: [{ codeSha256: 'x', name: 'Subject.missing' }], branchAnchors: [], statementAnchors: [] };
        const missing = failureOf(() => applyTo(SOURCE, authorization));
        expect(missing).toContain('"Subject.missing"');
        expect(missing).toContain('0 units have that name');

        const twin = ['function twin(): number {', '    return 1;', '}', 'function twin(): number {', '    return 2;', '}', ''].join('\n');
        const ambiguous = failureOf(() =>
            applyTo(twin, { boundFunctions: [{ codeSha256: 'x', name: 'function twin' }], branchAnchors: [], statementAnchors: [] }, {
                branchEntries: [],
                statementEntries: [],
            }),
        );
        expect(ambiguous).toContain('"function twin"');
        expect(ambiguous).toContain('2 units have that name');
    });

    it('fails when a bound unit changed, showing the approved and the current codeSha256', () => {
        const target = pick(describeSource(SOURCE).statements, 'Subject.check', 'return');
        const authorization = approvalFor(SOURCE, { statement: target }, ['Subject.check', 'Subject.premise']);
        const changed = SOURCE.replace('return this.limit;', 'return this.limit + 1;');
        const message = failureOf(() => applyTo(changed, authorization));
        expect(message).toContain('"Subject.premise"');
        expect(message).toContain(`approved codeSha256 ${fingerprintOf(SOURCE, 'Subject.premise')}`);
        expect(message).toContain(`current codeSha256 ${fingerprintOf(changed, 'Subject.premise')}`);
    });

    it('fails when an anchor names an unbound unit, has an empty range, or records code that differs from the unit tokens', () => {
        const target = pick(describeSource(SOURCE).statements, 'Subject.check', 'return');
        const valid = approvalFor(SOURCE, { statement: target }, ['Subject.check']);
        const withAnchor = (anchor: Record<string, unknown>) => ({ ...valid, statementAnchors: [{ ...valid.statementAnchors[0], ...anchor }] });

        expect(failureOf(() => applyTo(SOURCE, withAnchor({ functionName: 'Subject.premise' })))).toContain('is not bound');
        expect(failureOf(() => applyTo(SOURCE, withAnchor({ tokenEnd: target.tokenStart })))).toContain('empty token range');
        const mismatch = failureOf(() => applyTo(SOURCE, withAnchor({ code: 'throw' })));
        expect(mismatch).toContain('"throw"');
        expect(mismatch).toContain('"return"');
    });
});
