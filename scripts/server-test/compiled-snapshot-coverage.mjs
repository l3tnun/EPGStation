import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';


/**
 * Compiled snapshot raw V8 converter.
 *
 * Discovers, per compiled-snapshot script, the raw V8 coverage record produced for it during a test
 * run, the `src/**\/*.ts` file its compiled-snapshot source map resolves to, and -- via that same
 * compiled JS + source map -- converts every V8 range into an Istanbul-compatible `{ start, end,
 * count }` source entry (1-based line, 0-based column, matching Istanbul's own `statementMap`
 * convention). Both the total entry population and the covered (count > 0) subset come from this one
 * conversion; nothing here falls back to Vitest's `all: true` zero-fill for totals.
 *
 * This is deliberately only the "collection + conversion" half of the
 * coverage pipeline, not the whole pipeline: it never claims
 * C0/C1, never builds a canonical `coverage-final.json`, and never runs a process or a real build --
 * every input (snapshot `dist/` trees, raw `NODE_V8_COVERAGE` dump files) is supplied by the caller
 * (or, in this module's own tests, a synthetic fixture tree). It also does not replicate a real
 * coverage engine's nested-range diffing (Istanbul derives per-statement counts by subtracting a
 * containing range's hits from its children's; V8's raw `functions[].ranges[]` already come back
 * partially nested to represent that same containment). Statement entries (see
 * `buildStatementBasisEntries` below) and branch entries (see
 * `buildBranchBasisEntries` below) are both bases derived from the compiled JS (+ source map for
 * statements, + a syntax-only AST parse for branches) alone, never one-per-raw-range: the *set* of
 * statement/branch locations is identical across every shard of one candidate tree regardless of which
 * raw V8 ranges that shard's own tests happened to produce; a raw range only ever supplies the count
 * for the basis span it falls inside.
 *
 * §8 step 2 explicitly requires not assuming a single snapshot ("単一snapshot前提にしない") -- a run
 * may have created more than one `compiled-dist-*` snapshot, each with its own `dist` tree (one per
 * Vitest worker, one per nested Vitest, etc). `discoverCompiledSnapshotCoverage` therefore takes an explicit `snapshotRoots` array
 * rather than re-deriving snapshot locations from a directory-naming convention (that convention
 * lives in, and can drift independently of, `compiled-snapshot.mjs`'s `withCompiledSnapshot`,
 * which this module does not import and must not modify -- re-deriving its private naming scheme
 * here would silently couple the two).
 *
 * The source map itself is decoded by a small, dependency-free Source Map V3 base64-VLQ reader
 * (`decodeMappings`/`decodeVlqSegment` below) rather than importing the `source-map` package: it is
 * only present in `node_modules` transitively (via `source-map-support`, already used elsewhere in
 * this repository), never declared in `package.json`; declaring it there directly is out of scope
 * for this module -- depending on an undeclared transitive package here would be
 * fragile (it can disappear on an unrelated lockfile change) for what the Source Map V3 spec makes a
 * genuinely small, self-contained algorithm. The branch-outcome basis (`buildBranchBasisEntries`
 * below), by contrast, does import `typescript` -- an existing *direct* `package.json` devDependency
 * (unlike `source-map`), so this adds no new dependency -- for a syntax-only `ts.createSourceFile`
 * parse; unlike a source map's mapping table, a compiled script's branch/block boundaries have no
 * small self-contained encoding to hand-roll a reader for.
 *
 * Fail-closed rejection reasons (exactly five):
 *   - `missing-raw-record`: a `.js` file exists under a snapshot root but no raw V8 record's `url`
 *     resolves to its path -- the script was part of the snapshot but its execution was never
 *     captured. A script that is not under any snapshot root is not a rejection at all: it is
 *     snapshot-external (Node internals, Vitest itself, `node_modules`, test files) and is silently
 *     excluded from the discovered set, never evaluated against any of the rules below: snapshot-external
 *     scripts must not become coverage entries.
 *   - `missing-source-map`: the script has a raw record, but no readable, parseable source map --
 *     either it has no trailing `//# sourceMappingURL=` comment, the comment is a `data:` URI (this
 *     repository's `tsconfig.json` sets `sourceMap: true` without `inlineSourceMap`, so a real build
 *     never emits one; treating it as unsupported here is a deliberate, documented narrowing, not an
 *     oversight), the comment is a malformed percent-escape (`decodeURIComponent` throws -- a real
 *     `tsc` build never emits one, so this fails closed rather than propagating the raw `URIError`), or
 *     the referenced `.map` file is missing/unparsable JSON.
 *   - `source-map-outside-src`: the source map does not resolve to exactly one file under
 *     `<repositoryRoot>/src/**\/*.ts` (excluding `.d.ts`). Zero or more than one resolved `sources`
 *     entry is folded into `duplicate-inconsistent-mapping` instead (see below) -- this reason is
 *     reserved for the single-source case that resolves to the wrong place.
 *   - `duplicate-inconsistent-mapping`: covers every way the discovered set fails to be a clean 1:1
 *     bijection between compiled-snapshot scripts and `src/**\/*.ts` files: a source map whose
 *     `sources` array is empty or has more than one entry (ambiguous within a single script), the same
 *     dist-relative script path resolving to a different source across snapshot roots, or the same
 *     source path being claimed by two different dist-relative script paths. Grounded in §8 step 6's
 *     aggregation requirement that shard/snapshot-relative location identity be decided once and stay
 *     consistent, not re-derived differently per copy.
 *   - `no-representable-source-location`: a V8 range's end byte offset, converted to a generated
 *     `{ line, column }` in the compiled JS, has no mapping segment at or before it anywhere in the
 *     source map (the standard "nearest preceding segment" lookup returns nothing) -- or the source map
 *     has no mapping segment at all, so neither endpoint resolves -- the range genuinely cannot be
 *     attributed to any source position, so it cannot become an entry. This (and every other rule above)
 *     is bypassed entirely, never even reached, when the compiled body is byte-equal -- after stripping
 *     comments -- to the canonical TypeScript type-erasure stub: such a script has no executable range to
 *     attribute at all, whether or not a raw record exists for it, and is accepted with an explicit 0/0
 *     record instead (see the discovery loop's `isCanonicalTypeErasureStub`
 *     check below, which is not gated on `mappingPoints.length === 0`). A start offset that precedes every segment is not itself
 *     disqualifying for a genuinely non-stub script: when the end still resolves, the range is guaranteed
 *     to contain the first segment, so the start snaps to that first segment instead of rejecting (see
 *     `convertRange` below).
 *
 * Raw merge:
 * more than one raw V8 record can exist for the same resolved script path -- `v8.takeCoverage()` resets
 * its counters per flush, so multiple dump files (one per worker, one per flush) are disjoint partial
 * observations of the identical compiled JS, not competing versions to pick a "last" one from. These are
 * merged additively at `(startOffset, endOffset)` range granularity for the public `functions` field (see
 * `mergeRawRecords` below): identical range keys sum their counts, keys present in only some records
 * union in with their own counts. `isBlockCoverage` is never a merge-conflict key -- it is a per-function
 * invocation-state flag that V8 legitimately flips `false` -> `true` the first time a function is invoked,
 * not a stable property of a range coordinate -- the merged synthetic function reconciles it as the
 * logical OR of contributing values instead. Statement/branch *count attribution* does not use that
 * synthetic union as its topology input (per-record attribution): each raw record keeps its own
 * coherent V8 nesting, `countForSpanStart` runs per record, and the non-negative per-record counts are
 * summed. A sixth fail-closed reason, `incompatible-raw-merge`, rejects: a non-array `functions`/`ranges`,
 * a non-numeric offset, a non-integer or negative count, or the same `(startOffset, endOffset)` coordinate
 * appearing more than once within a single raw record's own flattened ranges -- checked for every resolved
 * script path, including one with only a single raw record -- diagnostics name the offending dump file.
 * A statement or branch query whose innermost-selected raw range belongs to an `isBlockCoverage: false`
 * function with a positive count (function-invocation-only evidence, no block detail -- see
 * `countForSpanStart`) is deliberately NOT a fail-closed reason: that record contributes `0` for that one
 * query instead, reported via `functionGranularityExclusions` (see `COVERAGE_EXCLUDED_RECORDS_FILE_NAME`)
 * -- undercounted, never fabricated, never failing the whole run over what a real (if partial) V8
 * coverage session can legitimately produce.
 *
 * Per-record `branchEntries` are converted into `branchMap`/`b` by `toCoverageFinalMap` alongside the
 * statement conversion. The branch *location* basis is itself shard-independent, the same way
 * `buildStatementBasisEntries` makes the statement basis shard-independent: `buildBranchBasisEntries` below derives it from a static
 * parse of the compiled JS, not from a shard's own raw ranges -- a shard's own raw ranges decide only a
 * branch basis span's *count*, never whether that span exists at all.
 *
 * Single count rule for statements AND branches (see `countForSpanStart`): both
 * bases query the exact same per-record candidate range set -- every range of every function,
 * `isBlockCoverage` carried along only for `countForSpanStart`'s own function-granularity-only fail-closed
 * check, never as a pre-filter. A narrower branch-only candidate set (`isBlockCoverage === true` functions
 * only, each one's `ranges[0]` excluded) would make an always-taken branch (no range of its own; V8 never
 * emits a nested range whose count equals its parent's) silently read `0`, and would make a position
 * inside an uncalled function fall through to whatever wider range happened to enclose it once that
 * function's own zero-count range was excluded -- a phantom nonzero count. Default-parameter initializers are excluded from the branch basis
 * entirely (not merely counted differently): V8 does not instrument a default initializer with any range
 * of its own at all (confirmed with a plain-node probe), so there is no block-level evidence to report a
 * branch outcome for regardless of which candidate set is used -- see `collectBranchSpanNodes`'s own doc.
 *
 * Namespace-merge guard: a TypeScript class+namespace merge's compiled `})(X || (X = {}));` guard tail
 * is provably unreachable (module evaluation order always binds `X` truthy before the IIFE runs), so
 * `findNamespaceMergeGuardRanges` below excludes its `||`-onward statement span and its `||` right-operand
 * branch outcome from both bases -- an anchored, purely textual rule over the compiled JS, never a raw
 * V8 range, shard, or source map, so the excluded set stays identical across every shard.
 *
 * Function-unit-bound statement and branch-outcome exclusion: a
 * product TypeScript source may carry an emit-erased ambient
 * `declare const __EPGSTATION_COVERAGE_EXCLUSION_…: unique symbol` marker as its final AST statement.
 * The converter binds that marker to a fixed-length, per-file authorization table entry. The entry binds to
 * the excluded code, the function unit that holds it, and the function units it records as its premise (their
 * token-sequence fingerprints, `boundFunctions`), and names each excluded statement / branch outcome by an
 * anchor (a function unit and a token range in it). `applyCoverageExclusions` verifies the fingerprints and
 * that each anchor resolves to exactly one entry of its own basis, then drops only those entries -- from both
 * the total and the covered subset, same as any other basis omission. A position in the file, a dist byte
 * offset, or the file's own digest never takes part, so a comment, a whitespace change, or code outside the
 * bound units leaves the approval valid. A single marker/authorization entry MAY authorize statements,
 * branches, both, or (degenerate, never actually used) neither; the two resolutions are independent and
 * either anchor list may be empty. Unknown / misplaced markers, a bound unit that is missing, ambiguous or
 * changed, or an anchor that does not resolve to exactly one entry fail closed as
 * `malformed-coverage-exclusion`.
 *
 * Statement-basis syntax-only rule (measured against a full-run
 * `coverage-final.json`: 2380 of 4041 zero-count statement entries in `src/**` contained no executable
 * token at all -- punctuation-only, whitespace-only, or a bare structural keyword -- and 482 of those had
 * a nonzero neighbour): `buildStatementBasisEntries`'s spans run from one `mappingPoints` entry to the
 * next, i.e. between two SOURCE MAP segments, never between two STATEMENT boundaries -- a span can
 * therefore legitimately start mid-whitespace, land entirely inside a punctuation run (`{`, `}`, `;`,
 * `,`, `:`, `.`), or contain nothing but a bare `try`/`catch`/`finally`/`else`/`default`/`do` keyword with
 * no body of its own. Two independent problems follow from querying such a span's raw COUNT at its own
 * start offset (`offset`, the mapping point itself):
 *   1. V8 opens a fresh zero-count CONTINUATION range immediately after a `return`/`throw`/`break`/
 *      `continue` (control never reaches what follows in that same block), so the leading whitespace of
 *      the NEXT mapping-to-mapping span can sit inside that zero range even though the span's own first
 *      real token sits inside the ENCLOSING (nonzero) range -- observed directly (a plain byte read of
 *      this repository's own compiled output) at `StorageRecordedUseSnapshotAdapter.js` offsets
 *      `[1579,1596)`, a `\n        finally ` span whose leading whitespace [1579,1588) sits inside a
 *      zero-count continuation range opened by the preceding `catch` clause's own `return`, while
 *      `finally` itself (1588) resumes inside the surrounding function's nonzero range. Querying at the
 *      span's raw start (inside the whitespace) reports a phantom `0` for a span whose only real content
 *      was never actually unreached. (This SPECIFIC span is additionally caught by rule 2 below -- a bare
 *      `finally` plus whitespace has no executable token either way -- but the same zero-continuation
 *      shape recurs after any `return`/`throw`/`break`/`continue` regardless of what token follows, so
 *      rule 1 still matters whenever that next token is not itself one of the six bare structural
 *      keywords -- see the "leading-whitespace" converter test below for a case rule 1 alone resolves.)
 *   2. A span containing no token other than whitespace, punctuation, or one of those six bare structural
 *      keywords has no execution semantics of its own to report a count FOR in the first place -- it is a
 *      gap artifact of the mapping-point tessellation, not a statement Istanbul or a human reviewer would
 *      ever recognize as one.
 * The fix (statement basis only; the branch-outcome basis in `buildBranchBasisEntries` below is
 * unaffected -- it is already derived from AST node spans, not mapping-point gaps): `classifyStatementSpan`
 * runs a `ts.createScanner` pass (`skipTrivia: true`, so whitespace AND comments are silently skipped,
 * never regex-matched over raw text) once per span. A span containing zero non-trivia tokens, or whose
 * every non-trivia token is either a punctuation-range `SyntaxKind` (`FirstPunctuation`..`LastPunctuation`
 * -- this deliberately includes a member-access `.`/`?.` and an arrow `=>`, both purely structural without
 * an operand of their own) or one of `try`/`catch`/`finally`/`else`/`default`/`do` in isolation, is omitted
 * from the basis entirely (`continue`d, never converted, never counted in the total or the covered
 * subset) -- rule (2). For every span that is NOT omitted, the raw count is queried at that first non-trivia
 * token's own start offset instead of the span's raw start (`classification.queryOffset`, always inside the
 * span) -- rule (1); the span's reported `start`/`end`/`startOffset`/`endOffset` (and therefore its
 * canonical id) are unchanged, still the mapping-point-to-mapping-point boundaries, so a kept span's
 * identity does not depend on `queryOffset`. `return`, `throw`, `break`, `continue`, `await`, `this`, `super`,
 * `new`, `typeof`, an identifier, a literal, or any other token outside that closed set makes a span
 * executable and keeps it, however that token got there.
 */

/** Hex SHA-256 of a string or byte buffer. */
function sha256Hex(bytesOrString) {
    return createHash('sha256').update(bytesOrString).digest('hex');
}

export class CompiledSnapshotCoverageError extends Error {
    constructor(reason, message) {
        super(message);
        this.name = 'CompiledSnapshotCoverageError';
        this.reason = reason;
    }
}

function fail(reason, message) {
    throw new CompiledSnapshotCoverageError(
        reason,
        `compiled snapshot coverage discovery rejected (${reason}): ${message}`,
    );
}

/**
 * Builds the `(descriptor, range) => void` callback `countForSpanStartAcrossRecords` invokes once per
 * record whose innermost-containing range for some query turned out to be `isBlockCoverage: false` with a
 * positive count (see `countForSpanStart`'s own doc) -- function-invocation-only evidence, no block
 * detail, so that record contributes `0` for the query instead of a fabricated count. Deduplicates on
 * `(sourceFile, startOffset, endOffset)` via `seen` (shared across the whole script's statement AND branch
 * bases, since both can hit the exact same offending range many times over -- once per basis span whose
 * position happens to fall inside it) so one bad function produces exactly ONE diagnostic entry per
 * dump file, not one per span queried inside it. Pushes a frozen
 * `{ relativeScriptPath, root, sourceFile, pid, functionName, startOffset, endOffset, count }` onto
 * `functionGranularityExclusions` the first time each distinct combination is seen.
 */
function makeFunctionGranularityExclusionReporter(relativeScriptPath, root, functionGranularityExclusions, seen) {
    return (descriptor, range) => {
        const key = `${descriptor.sourceFile}:${range.startOffset}:${range.endOffset}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        functionGranularityExclusions.push(
            Object.freeze({
                count: range.count,
                endOffset: range.endOffset,
                functionName: range.functionName,
                pid: descriptor.pid ?? null,
                relativeScriptPath,
                root,
                sourceFile: descriptor.sourceFile,
                startOffset: range.startOffset,
            }),
        );
    };
}

function normalized(path) {
    return path.split(sep).join('/');
}

function isWithin(root, candidate) {
    const rel = relative(root, candidate);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Recursively lists every `.js` file under `root` (skips symlinks; `.js.map`/`.d.ts` are not scripts). */
function walkCompiledScripts(root) {
    const results = [];
    function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const entryPath = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                walk(entryPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                results.push(entryPath);
            }
        }
    }
    walk(root);
    return results;
}

/** Recursively lists every `.ts` file under `root` (skips symlinks and `.d.ts` files -- those are never compiled to a coverable script). */
function walkSourceFiles(root) {
    const results = [];
    function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const entryPath = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                walk(entryPath);
            } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                results.push(entryPath);
            }
        }
    }
    walk(root);
    return results;
}

/** Best-effort `file://` URL -> absolute filesystem path. Non-`file://` urls (node:, node_modules loaders) return `null`. */
function scriptPathFromUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('file://')) {
        return null;
    }
    try {
        return fileURLToPath(url);
    } catch {
        return null;
    }
}

/**
 * Reads every `*.json` file directly under `rawCoverageDir` (the flat `NODE_V8_COVERAGE` dump
 * layout) and returns only the `result` entries whose `url` resolves to a path in `relevantPaths`,
 * each paired with its source dump file's name (for `incompatible-raw-merge` provenance) and its
 * already-resolved absolute path (so callers never re-derive it from `record.url`).
 *
 * `relevantPaths` is the exact, closed set of paths a discovered record can ever be consulted for --
 * every compiled-snapshot script's own resolved path (`walkCompiledScripts` under each
 * `snapshotRoots` entry) plus every `isolatedScriptPath` from a loaded lifecycle-safe identity
 * registry entry (see `discoverCompiledSnapshotCoverage`'s `collectAssociatedRawGroups` -- those two
 * sources are the *only* keys ever looked up in `rawGroupsByPath`). A raw dump commonly contains
 * thousands of `node_modules`/TypeScript/test-runner script records this discovery pass never reads;
 * a shard whose own tests spawn many real child processes can produce dump files whose combined JSON
 * text is tens of megabytes, almost none of it ever consulted. Discarding a script-external record
 * the moment its `url` is resolved -- rather than parsing every dump into one long-lived array and
 * only filtering by path afterward in the caller -- keeps this function's own peak retained memory
 * bounded by the number of *relevant* records, not by how many unrelated child processes happened to
 * flush a dump into `rawCoverageDir`. Every other fail-closed rule in this module (`missing-raw-record`,
 * `incompatible-raw-merge`, duplicate-coordinate detection, …) is decided per resolved script path
 * from records already known to be relevant -- a record this filter discards was never a snapshot
 * script's own record in the first place, and the module doc's own `missing-raw-record` rule already
 * treats "not under any snapshot root" as silently excluded, never a rejection (see the module doc's
 * fail-closed rejection reasons list). Every dump file is still fully JSON-parsed and shape-checked
 * (`malformed-raw-dump`) regardless of how many of its records are relevant, so a corrupt dump still
 * fails closed the same way it always has.
 *
 * Exported (only its production caller, `discoverCompiledSnapshotCoverage` below, actually needs it)
 * so a test can observe the filtered result directly -- the set and count of records this function
 * retains is exactly the memory-bounded behavior it exists to provide, and asserting on
 * `discoverCompiledSnapshotCoverage`'s own output alone cannot distinguish "never parsed" from
 * "parsed, matched, then discarded downstream".
 */
const MALFORMED_RAW_DUMP_EVIDENCE_HEAD_TAIL_BYTES = 512;

/**
 * Best-effort diagnostic capture for a `malformed-raw-dump` rejection that is about to fail closed
 * (`readRawCoverageRecords` below, immediately before each of its own two `fail(...)` calls). Never
 * changes the rejection's own reason, message, or control flow -- this is a pure side effect that
 * runs before the pre-existing `fail(...)` call it sits next to, and its own failure is swallowed so
 * it can never mask that real rejection.
 *
 * Exists because the node-matrix runner (`run-node-acceptance-matrix.mjs`) executes this
 * discovery inside a fresh, per-run workspace that is deleted once the run finishes -- the raw dump
 * this rejection names is already gone by the time a human reads the preflight log. Destination:
 * `EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR` when the caller's environment sets one (an absolute path
 * outside that ephemeral workspace -- e.g. the shared checkout's own `test/server/.artifacts/` --
 * survives the workspace's own cleanup); otherwise a timestamped directory under
 * `test/server/.artifacts/coverage-reject-evidence/` resolved against the current working directory.
 * Neither path is ever removed by `runAgainstCompiledSnapshot`'s own `finally` (`run-tests.mjs`) --
 * that block only ever reclaims the single `rawCoverageDirectory`/`transformCaptureDirectory` paths
 * it was given, never a directory this function creates on its own under a distinct
 * `coverage-reject-evidence` root.
 */
function recordMalformedRawDumpEvidence({ rawCoverageDir, filePath, entryName, rawText, error }) {
    try {
        const pid = pidFromRawDumpFileName(entryName);
        const siblings = [];
        for (const siblingEntry of readdirSync(rawCoverageDir, { withFileTypes: true })) {
            if (!siblingEntry.isFile() || !siblingEntry.name.endsWith('.json')) {
                continue;
            }
            let stat;
            try {
                stat = statSync(join(rawCoverageDir, siblingEntry.name));
            } catch {
                continue;
            }
            const siblingPid = pidFromRawDumpFileName(siblingEntry.name);
            siblings.push({
                mtimeMs: stat.mtimeMs,
                name: siblingEntry.name,
                pid: siblingPid,
                samePid: pid !== null && siblingPid === pid,
                sizeBytes: stat.size,
            });
        }
        const headBytes = rawText.slice(0, MALFORMED_RAW_DUMP_EVIDENCE_HEAD_TAIL_BYTES);
        const tailBytes =
            rawText.length > MALFORMED_RAW_DUMP_EVIDENCE_HEAD_TAIL_BYTES
                ? rawText.slice(-MALFORMED_RAW_DUMP_EVIDENCE_HEAD_TAIL_BYTES)
                : rawText;
        const evidence = {
            capturedAt: new Date().toISOString(),
            headBytes,
            rejectedFile: { name: entryName, parseError: error.message, path: filePath, pid, sizeBytes: rawText.length },
            siblingsInSameRawCoverageDir: siblings,
            tailBytes,
        };

        const sameProcessSiblings = siblings.filter(sibling => sibling.samePid);
        const summaryLines = [
            `malformed-raw-dump evidence: ${filePath} (pid=${pid ?? 'unknown'}, ${rawText.length} bytes): ${error.message}`,
            `  siblings in ${rawCoverageDir}: ${siblings.length} total, ${sameProcessSiblings.length} same-pid`,
            ...sameProcessSiblings.map(
                sibling => `    ${sibling.name}: ${sibling.sizeBytes}B mtime=${new Date(sibling.mtimeMs).toISOString()}`,
            ),
        ];
        process.stderr.write(`${summaryLines.join('\n')}\n`);

        const configuredEvidenceRoot = process.env.EPGSTATION_COVERAGE_REJECT_EVIDENCE_DIR;
        const evidenceRoot =
            typeof configuredEvidenceRoot === 'string' && configuredEvidenceRoot.length > 0
                ? configuredEvidenceRoot
                : resolve('test/server/.artifacts/coverage-reject-evidence');
        const evidenceDir = join(evidenceRoot, `${Date.now()}-${randomUUID().slice(0, 8)}`);
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(join(evidenceDir, `${entryName}.evidence.json`), JSON.stringify(evidence, null, 2));
    } catch {
        // Best-effort diagnostics only: a failure capturing evidence must never replace or mask the
        // real `fail('malformed-raw-dump', ...)` call this always runs immediately before.
    }
}

export function readRawCoverageRecords(rawCoverageDir, relevantPaths) {
    const records = [];
    for (const entry of readdirSync(rawCoverageDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const filePath = join(rawCoverageDir, entry.name);
        let rawText = '';
        let parsed;
        try {
            rawText = readFileSync(filePath, 'utf8');
            parsed = JSON.parse(rawText);
        } catch (error) {
            recordMalformedRawDumpEvidence({ entryName: entry.name, error, filePath, rawCoverageDir, rawText });
            fail('malformed-raw-dump', `${filePath} is not valid JSON: ${error.message}`);
        }
        if (!Array.isArray(parsed?.result)) {
            recordMalformedRawDumpEvidence({
                entryName: entry.name,
                error: new Error('missing "result" array'),
                filePath,
                rawCoverageDir,
                rawText,
            });
            fail('malformed-raw-dump', `${filePath} does not contain a "result" array`);
        }
        for (const scriptRecord of parsed.result) {
            const scriptPath = scriptPathFromUrl(scriptRecord?.url);
            if (scriptPath === null) {
                continue;
            }
            const resolvedPath = resolve(scriptPath);
            if (!relevantPaths.has(resolvedPath)) {
                continue;
            }
            records.push({ record: scriptRecord, resolvedPath, sourceFile: entry.name });
        }
    }
    return records;
}

/** The writing process's pid parsed from a `coverage-<pid>-<timestamp>-<n>.json` raw dump filename (Node's own `NODE_V8_COVERAGE` naming), or `null` if `fileName` does not start with that shape. */
const RAW_DUMP_FILENAME_PID_PATTERN = /^coverage-(\d+)-/u;
function pidFromRawDumpFileName(fileName) {
    const match = RAW_DUMP_FILENAME_PID_PATTERN.exec(fileName);
    return match === null ? null : match[1];
}

/** The writing worker's pid parsed from a `transform-<pid>-<timestamp>-<uuid>.json` capture filename (`coverage-transform-capture.ts`'s own naming), or `null` if `fileName` does not start with that shape. */
const TRANSFORM_CAPTURE_FILENAME_PID_PATTERN = /^transform-(\d+)-/u;
function pidFromTransformCaptureFileName(fileName) {
    const match = TRANSFORM_CAPTURE_FILENAME_PID_PATTERN.exec(fileName);
    return match === null ? null : match[1];
}

/**
 * The record's own top-level range end offset -- the only
 * directly-measured signal for which coordinate space (on-disk dist bytes, or Vitest's own wrapped
 * executed text) a raw record's own offsets actually live in. V8's raw coverage convention always gives
 * the outermost compiled unit's own top-level scope a function entry named `''` whose own range starts
 * at offset 0 and ends at the exact length (UTF-16 code units, matching every offset this module already
 * treats as a JS-string index, never a UTF-8 byte count) of whatever text V8 actually compiled --
 * confirmed empirically against this repository's own real coverage data: a native
 * `require()`-loaded `IPCClient.js` reports a top-level end of exactly `jsSource.length`; a real
 * Vitest-executed `EPGUpdateExecutor.js` reports a top-level end of exactly
 * `wrapperPrefixLength + code.length + '\n}}'.length` (see `wrappedLength` below). Requires *exactly*
 * one function named `''` with a range starting at offset 0 across the whole record; returns `null`
 * (caller fails closed as `unverified-raw-offset-space`) when there is none, or more than one, since this
 * measurement is only trustworthy when unambiguous.
 */
function topLevelRangeEndOffset(record) {
    let candidateEnd;
    let candidateCount = 0;
    for (const fn of record.functions) {
        if (fn?.functionName !== '' || !Array.isArray(fn.ranges)) {
            continue;
        }
        for (const range of fn.ranges) {
            if (range?.startOffset === 0) {
                candidateCount += 1;
                candidateEnd = range.endOffset;
            }
        }
    }
    return candidateCount === 1 ? candidateEnd : null;
}

/**
 * One pid can flush MANY raw dumps for the identical script over its lifetime, because the harness
 * calls `v8.takeCoverage()` per file and never `stopCoverage()` until the worker's own `SIGTERM`. That is
 * why one of them can have no top-level anchor at all: for example, one worker produced three dumps
 * 12-19ms apart for `lib/TailStream.js`. The first has a real, unambiguous
 * top-level range (`""`, `[0, 8605)`, matching the on-disk dist length exactly -- a native record) plus
 * every other function, several still at count 0. The second has no entry for this script at all (no new
 * coverage since the first flush). The third has exactly ONE function -- also named `""` by V8's own
 * anonymous-closure naming convention, not the top-level scope -- at `[1069, 1606)`, the EXACT SAME
 * offsets as an inner closure already visible (at a lower count) in the first dump: `v8.takeCoverage()`
 * resets/deltas per Node's own documented contract ("collect the coverage from a subset of code" between
 * calls), so a dump only ever contains what changed since the previous flush; a script whose top-level
 * scope executed exactly once (module evaluation) simply has nothing new to report there on a later
 * flush, while an already-loaded closure invoked again still does. `topLevelRangeEndOffset` correctly
 * refuses to treat that inner closure's own `""` name as the top-level anchor (it requires
 * `startOffset === 0`, which this closure's range is not) -- this measurement is genuinely absent from
 * THIS ONE dump, not merely miscomputed.
 *
 * The record is not unverifiable, though: this pid's OTHER dump of this exact same script already
 * proved its coordinate space (native, matching the on-disk length) moments earlier.
 *
 * The borrow key here is `(pid, scriptId)`, never `pid` alone. A single
 * pid can hold TWO GENUINELY DIFFERENT script instances for the identical url at once -- V8 recompiles a
 * script every time it is evaluated through a different path (a native `require()` versus Vitest's own
 * module-runner-wrapped evaluation, e.g. `test/server/persistence/harness.ts`'s pattern for
 * `DBOperator.js`), each getting its own `scriptId`, and a bare bounds check (every range fits inside the
 * established end) cannot tell those apart: the wrapped instance's own ranges can easily be numerically
 * smaller than the native instance's end and pass the check anyway, silently borrowing the WRONG
 * instance's coordinate space. For example, one pid's own dump contains lib/TailStream.js TWICE in the same
 * file -- scriptId 488 (topLevelEnd 8605, matching the on-disk dist length -- native) and scriptId 517
 * (topLevelEnd 31555, a wrapped/transformed evaluation) -- two coexisting, simultaneously-live script
 * instances for the identical url and pid. `scriptId` is present in every `NODE_V8_COVERAGE` raw record
 * (confirmed present and STABLE across a pid's own dumps for the same script instance: `lib/TailStream.js`'s
 * `scriptId` is `"238"` in both its first and third dump above), so it is exactly
 * the sound, V8-native identity this borrow needs -- `establishTopLevelEndsByPidAndScriptId` (below)
 * therefore keys on `(pid, scriptId)`, and an anchor-less record whose own `scriptId` is absent/malformed
 * can never borrow at all (falls through to the ordinary fail-closed path), never merely by `pid`.
 *
 * `establishTopLevelEndsByPidAndScriptId` builds a `(pid, scriptId) -> topLevelEnd` map from whichever of
 * THIS SCRIPT's own raw dumps -- across every pid and scriptId, not just the anchor-less one -- already
 * carry an unambiguous anchor, so an anchor-less sibling dump from the SAME pid AND SAME script instance
 * can borrow it instead of failing closed purely for lacking its own copy of information a sibling dump
 * already supplied. A `(pid, scriptId)` whose own anchored dumps disagree with each other (never observed,
 * but not provably impossible) is deliberately left unestablished -- guessing between two conflicting
 * values would be exactly the "fall back without proof" this module's own doc prohibits.
 */
function establishTopLevelEndsByPidAndScriptId(attributionRecords) {
    const distinctEndsByKey = new Map();
    for (const attr of attributionRecords) {
        const pid = pidFromRawDumpFileName(attr.sourceFile);
        const scriptId = attr.record?.scriptId;
        if (pid === null || typeof scriptId !== 'string' || scriptId.length === 0) {
            continue;
        }
        const topLevelEnd = topLevelRangeEndOffset(attr.record);
        if (topLevelEnd === null) {
            continue;
        }
        const key = `${pid}\u0000${scriptId}`;
        const seen = distinctEndsByKey.get(key) ?? new Set();
        seen.add(topLevelEnd);
        distinctEndsByKey.set(key, seen);
    }
    const establishedByKey = new Map();
    for (const [key, seen] of distinctEndsByKey) {
        if (seen.size === 1) {
            establishedByKey.set(key, [...seen][0]);
        }
    }
    return establishedByKey;
}

/**
 * `record`'s own top-level end when it has one; otherwise, when `(pid, record.scriptId)` has an
 * established end from ANOTHER of this same script's dumps
 * (`establishedTopLevelEndsByPidAndScriptId`, see `establishTopLevelEndsByPidAndScriptId`), that borrowed
 * value. `record.scriptId` must be a non-empty string, matching a SPECIFIC other dump's own script
 * instance, or this never borrows at all (`pid` alone is not sound -- two genuinely
 * different script instances, e.g. a native `require()` and a Vitest module-runner-wrapped evaluation of
 * the identical url, can coexist under the same pid with different `scriptId`s and different coordinate
 * spaces). Even after a `scriptId` match, a soundness check still applies (kept as an extra consistency
 * assertion, not the primary proof): every one of `record`'s own ranges must fit inside the borrowed value
 * (`endOffset <= borrowed`) -- a mismatch here would mean this module's own scriptId-to-topLevelEnd
 * bookkeeping is itself broken, not a legitimate coordinate space, so it still returns `null` (never a
 * fabricated fit) rather than trusting the match anyway.
 */
function resolveTopLevelEnd(record, pid, establishedTopLevelEndsByPidAndScriptId) {
    const ownTopLevelEnd = topLevelRangeEndOffset(record);
    if (ownTopLevelEnd !== null) {
        return ownTopLevelEnd;
    }
    const scriptId = record?.scriptId;
    if (pid === null || typeof scriptId !== 'string' || scriptId.length === 0) {
        return null;
    }
    const key = `${pid}\u0000${scriptId}`;
    if (!establishedTopLevelEndsByPidAndScriptId.has(key)) {
        return null;
    }
    const borrowed = establishedTopLevelEndsByPidAndScriptId.get(key);
    let maxRangeEnd = 0;
    for (const fn of record.functions) {
        if (!Array.isArray(fn?.ranges)) {
            continue;
        }
        for (const range of fn.ranges) {
            if (typeof range?.endOffset === 'number' && range.endOffset > maxRangeEnd) {
                maxRangeEnd = range.endOffset;
            }
        }
    }
    return maxRangeEnd <= borrowed ? borrowed : null;
}

/**
 * The exact total length (UTF-16 code units) of the wrapped
 * text `VitestModuleEvaluator#_runInlinedModule` actually compiled for `capture`
 * (`node_modules/vitest/dist/module-evaluator.js`: `const codeDefinition =
 * `'use strict';async (${argumentsList.join(',')})=>{{`; const wrappedCode =
 * `${codeDefinition}${code}\n}}`;` -- confirmed by direct inspection) -- `capture.wrapperPrefixLength`
 * (already `codeDefinition.length`, computed by `coverage-transform-capture.ts`'s own
 * `computeWrapperPrefixLength`) plus `capture.code.length` plus the trailing `'\n}}'` suffix that same
 * source line appends, never guessed or reconstructed differently here.
 */
const WRAPPED_CODE_SUFFIX_LENGTH = '\n}}'.length;
function wrappedLength(capture) {
    return capture.wrapperPrefixLength + capture.code.length + WRAPPED_CODE_SUFFIX_LENGTH;
}

/**
 * Reads every `transform-*.json` file
 * directly under `transformCaptureDir` (one per newly observed distinct version, written by
 * `test/server/harness/coverage-transform-capture.ts`'s `captureWorkerTransformedModulesIfEnabled`) and
 * returns a `Map<pid, Map<resolvedPath, capture[]>>` for every capture whose `url` resolves to a path in
 * `relevantPaths` -- the same closed set `readRawCoverageRecords` above is already scoped to, so a
 * capture for a script this discovery pass never asked about is never even parsed into the returned map.
 *
 * Keyed by **pid** (parsed from the capture file's own name, never from a field inside its JSON body),
 * not by resolved path alone: a raw V8 dump can, and routinely does, carry more than one record for the
 * exact same resolved script path that were captured by entirely different mechanisms in entirely
 * different processes -- a plain `createRequire()`/`require()` call (e.g. this repository's own
 * `correlation.spec` harness loading `dist/model/ipc/IPCClient.js` directly, never through Vite's module
 * runner at all), a spawned child process running a `dist/**\/*.js` entry point directly (e.g.
 * `notification-child.cjs`), or an isolated-runtime copy -- none of which Vitest's SSR transform ever
 * touches, so their raw offsets are already valid dist-file offsets. A blind "same path anywhere
 * in this pid ⇒ translate" rule would corrupt a shared path's untranslated record, and "no matching-pid
 * capture ⇒ assume on-disk" is not trusted either
 * -- `discoverCompiledSnapshotCoverage`'s own per-record dispatch *measures* each record's
 * own top-level range end against both the on-disk length and every candidate capture's own
 * reconstructed wrapped length before ever choosing an interpretation, and fails closed
 * (`unverified-raw-offset-space`/`ambiguous-raw-offset-space`) when neither is provably correct. This
 * function's only job is to hand that dispatch every candidate capture honestly, never to pre-judge
 * which one (if any) applies.
 *
 * Each `(pid, resolvedPath)` maps to an **array**, not a single capture: `vi.resetModules()` (Vite's own
 * `EvaluatedModules#invalidateModule`) can make the same pid observe more than one genuinely distinct
 * transformed version of the same path over its lifetime (capture loss under
 * `resetModules()`) -- both are kept, deduplicated only when two capture files report byte-identical
 * `(code, wrapperPrefixLength)` for the same pid+path (harmless duplicate observations, e.g. an
 * `afterEach` and the final `afterAll` both seeing the same still-live version), never discarded or
 * rejected merely for differing. Two *different* distinct versions for the same pid+path with
 * *different* `distSourceHash` values is impossible for a correct capture writer (the same pid, same
 * resolved path, can only ever be transformed from the one on-disk file that pid sees) and fails closed
 * as `malformed-transform-capture`.
 *
 * A capture filename that does not start with the documented `transform-<pid>-` shape fails closed
 * (`malformed-transform-capture`) rather than being silently skipped -- unlike a raw dump, every file
 * directly under this directory is written exclusively by this capture harness, so a file that
 * does not match its one naming convention is a genuine defect, not a foreign/unrelated file to ignore.
 *
 * Every capture file is still fully JSON-parsed and shape-checked regardless of whether any of its
 * entries are relevant, so a corrupt capture file fails closed the same way a corrupt raw dump does
 * (`malformed-transform-capture` in place of `malformed-raw-dump`).
 */
export function readTransformCaptures(transformCaptureDir, relevantPaths) {
    const capturesByPidAndPath = new Map();
    for (const entry of readdirSync(transformCaptureDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const filePath = join(transformCaptureDir, entry.name);
        const pid = pidFromTransformCaptureFileName(entry.name);
        if (pid === null) {
            fail(
                'malformed-transform-capture',
                `${filePath} does not follow the transform-<pid>-<timestamp>-<uuid>.json naming convention`,
            );
        }
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch (error) {
            fail('malformed-transform-capture', `${filePath} is not valid JSON: ${error.message}`);
        }
        if (!Array.isArray(parsed?.captures)) {
            fail('malformed-transform-capture', `${filePath} does not contain a "captures" array`);
        }
        for (const capture of parsed.captures) {
            const scriptPath = scriptPathFromUrl(capture?.url);
            if (scriptPath === null) {
                continue;
            }
            const resolvedPath = resolve(scriptPath);
            if (!relevantPaths.has(resolvedPath)) {
                continue;
            }
            if (
                typeof capture.code !== 'string' ||
                !isNonNegativeInteger(capture.wrapperPrefixLength) ||
                (capture.map !== null && typeof capture.map !== 'object') ||
                !isSha256HexDigest(capture.distSourceHash)
            ) {
                fail(
                    'malformed-transform-capture',
                    `${filePath} has a transform capture for "${resolvedPath}" with an invalid shape`,
                );
            }
            let byPath = capturesByPidAndPath.get(pid);
            if (byPath === undefined) {
                byPath = new Map();
                capturesByPidAndPath.set(pid, byPath);
            }
            let versions = byPath.get(resolvedPath);
            if (versions === undefined) {
                versions = [];
                byPath.set(resolvedPath, versions);
            }
            const identical = versions.find(
                existing => existing.code === capture.code && existing.wrapperPrefixLength === capture.wrapperPrefixLength,
            );
            if (identical !== undefined) {
                if (identical.distSourceHash !== capture.distSourceHash) {
                    fail(
                        'malformed-transform-capture',
                        `pid ${pid} has byte-identical transform captures for "${resolvedPath}" with disagreeing distSourceHash values (in "${filePath}")`,
                    );
                }
                continue;
            }
            versions.push(capture);
        }
    }
    return capturesByPidAndPath;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validates `record`'s shape (array `functions`, array `ranges` per function, numeric offsets,
 * non-negative integer counts) and flattens every range across every function into one array, failing
 * closed as `incompatible-raw-merge` (naming `sourceFile` and `resolvedPath`) on the first violation --
 * including a duplicate `(startOffset, endOffset)` coordinate appearing more than once within this one
 * record's own ranges (this runs for every resolved path, even one with only a single
 * raw record, so entry population never silently depends on how many dump files happened to exist).
 */
function flattenAndValidateRecordRanges(record, sourceFile, resolvedPath) {
    if (!Array.isArray(record?.functions)) {
        fail(
            'incompatible-raw-merge',
            `raw coverage record for "${resolvedPath}" in dump file "${sourceFile}" has no functions array`,
        );
    }
    const seenKeys = new Set();
    const flattened = [];
    for (const fn of record.functions) {
        if (!Array.isArray(fn?.ranges)) {
            fail(
                'incompatible-raw-merge',
                `raw coverage record for "${resolvedPath}" in dump file "${sourceFile}" has a function with no ranges array`,
            );
        }
        for (const range of fn.ranges) {
            if (!isFiniteNumber(range?.startOffset) || !isFiniteNumber(range?.endOffset)) {
                fail(
                    'incompatible-raw-merge',
                    `raw coverage record for "${resolvedPath}" in dump file "${sourceFile}" has a range with a non-numeric offset`,
                );
            }
            if (!isNonNegativeInteger(range?.count)) {
                fail(
                    'incompatible-raw-merge',
                    `raw coverage record for "${resolvedPath}" in dump file "${sourceFile}" has a range with a non-integer or negative count`,
                );
            }
            const key = `${range.startOffset}:${range.endOffset}`;
            if (seenKeys.has(key)) {
                fail(
                    'incompatible-raw-merge',
                    `raw coverage record for "${resolvedPath}" in dump file "${sourceFile}" has a duplicate range coordinate [${range.startOffset}, ${range.endOffset}) within a single raw record`,
                );
            }
            seenKeys.add(key);
            flattened.push({
                count: range.count,
                endOffset: range.endOffset,
                isBlockCoverage: fn.isBlockCoverage,
                key,
                startOffset: range.startOffset,
            });
        }
    }
    return flattened;
}

/**
 * Additively merges more than one raw V8 record captured for the same resolved script path (see the
 * module doc's raw-merge entry): identical `(startOffset, endOffset)` ranges across `group`'s
 * records sum their counts; ranges present in only some records are retained via union. `isBlockCoverage`
 * is reconciled as the logical OR of contributing values, never a conflict key. Each record's own ranges
 * are validated (shape + no intra-record duplicate coordinate) via `flattenAndValidateRecordRanges`
 * before merging. Never mutates `group`'s records -- always returns a new record object.
 */
function mergeRawRecords(group, resolvedPath) {
    const ranges = new Map();
    for (const { record, sourceFile } of group) {
        for (const range of flattenAndValidateRecordRanges(record, sourceFile, resolvedPath)) {
            const existing = ranges.get(range.key);
            if (existing === undefined) {
                ranges.set(range.key, {
                    count: range.count,
                    endOffset: range.endOffset,
                    isBlockCoverage: range.isBlockCoverage,
                    startOffset: range.startOffset,
                });
                continue;
            }
            existing.count += range.count;
            existing.isBlockCoverage = existing.isBlockCoverage || range.isBlockCoverage;
        }
    }
    const mergedFunctions = [...ranges.values()]
        .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
        .map(range =>
            Object.freeze({
                functionName: '',
                isBlockCoverage: range.isBlockCoverage,
                ranges: Object.freeze([
                    Object.freeze({ count: range.count, endOffset: range.endOffset, startOffset: range.startOffset }),
                ]),
            }),
        );
    return Object.freeze({ functions: Object.freeze(mergedFunctions), url: group[0].record.url });
}

/** Last `//# sourceMappingURL=...` (or legacy `//@`) comment in `jsSource`, or `null` if absent. */
function extractSourceMappingUrl(jsSource) {
    const matches = [...jsSource.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
    return matches.length === 0 ? null : matches[matches.length - 1][1];
}

/**
 * Type-only empty-map disposition: the byte-exact body tsc emits for a source containing only `interface`/`type` declarations -- every
 * construct erases, leaving just the CommonJS `"use strict"` + `__esModule` marker preamble.
 */
// tsc の出力は module target で変わる。CommonJS では exports へ __esModule を立てる 2 行、
// ES module では `export {};` の 1 行になる。どちらも型だけの file が残す骨で、実行可能な
// statement は無い。byte 一致で判定する点は変えない。
const CANONICAL_TYPE_ERASURE_STUBS = Object.freeze([
    '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });',
    'export {};',
]);

/**
 * Removes every `//` line comment and `/* ... *\/` block comment from `jsSource`, leaving string and
 * template literal contents (including any comment-like substrings inside them) untouched. A minimal,
 * single-pass scanner -- not a full JS parser -- that tracks single/double-quoted string and backtick
 * template literal state plus backslash escapes so a `//` or `/*` inside a literal is never mistaken
 * for a comment start. It does not
 * special-case regex literals or template-literal `${...}` interpolation, but the failure direction is
 * safe: any mis-scan leaves residual text that does not byte-equal the canonical stub below, so the
 * script simply falls through to the existing (unaffected) fail-closed conversion path instead of being
 * misclassified as vacuous.
 */
function stripComments(jsSource) {
    let result = '';
    let i = 0;
    const { length } = jsSource;
    while (i < length) {
        const ch = jsSource[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            let literal = ch;
            i += 1;
            while (i < length) {
                const c = jsSource[i];
                literal += c;
                i += 1;
                if (c === '\\' && i < length) {
                    literal += jsSource[i];
                    i += 1;
                    continue;
                }
                if (c === quote) {
                    break;
                }
            }
            result += literal;
            continue;
        }
        if (ch === '/' && jsSource[i + 1] === '/') {
            while (i < length && jsSource[i] !== '\n') {
                i += 1;
            }
            continue;
        }
        if (ch === '/' && jsSource[i + 1] === '*') {
            i += 2;
            while (i < length && !(jsSource[i] === '*' && jsSource[i + 1] === '/')) {
                i += 1;
            }
            i += 2;
            continue;
        }
        result += ch;
        i += 1;
    }
    return result;
}

/**
 * True iff `jsSource`, after stripping every comment (respecting string/template literal boundaries,
 * see `stripComments`) and trimming surrounding whitespace, is byte-equal to one of `CANONICAL_TYPE_ERASURE_STUBS`.
 * Comment-tolerant so a source-preserved comment ahead of an otherwise fully-erased declaration (e.g.
 * `src/Enums.ts`'s `/** ... *\/` block above a lone `export type` alias) still classifies as vacuous,
 * not just the two-line stub with no comment at all.
 */
function isCanonicalTypeErasureStub(jsSource) {
    // A comment stripped from its own line leaves that line blank (its leading and trailing newlines
    // both survive) -- drop whitespace-only lines too so a preserved comment on its own line doesn't
    // block the match; a real statement is never whitespace-only, so this cannot hide one.
    const withoutBlankLines = stripComments(jsSource)
        .split('\n')
        .filter(line => line.trim().length > 0)
        .join('\n');
    return CANONICAL_TYPE_ERASURE_STUBS.includes(withoutBlankLines.trim());
}

/** Reads and JSON-parses the `.map` file `sourceMappingUrl` (percent-decoded per RFC 3986, then resolved relative to `scriptPath`) points to. `null` on any failure, for an unsupported `data:` URI, or for a malformed percent-escape. */
function readSourceMap(scriptPath, sourceMappingUrl) {
    if (sourceMappingUrl.startsWith('data:')) {
        return null;
    }
    let decodedSourceMappingUrl;
    try {
        decodedSourceMappingUrl = decodeURIComponent(sourceMappingUrl);
    } catch {
        return null;
    }
    const mapPath = resolve(dirname(scriptPath), decodedSourceMappingUrl);
    let text;
    try {
        text = readFileSync(mapPath, 'utf8');
    } catch {
        return null;
    }
    try {
        return { map: JSON.parse(text), mapPath };
    } catch {
        return null;
    }
}

/** Resolves every `map.sources` entry (honoring `sourceRoot`) to an absolute path, relative to the map file's own directory. */
function resolveMapSources(map, mapPath) {
    if (!Array.isArray(map?.sources)) {
        return [];
    }
    const base =
        typeof map.sourceRoot === 'string' && map.sourceRoot.length > 0
            ? resolve(dirname(mapPath), map.sourceRoot)
            : dirname(mapPath);
    return map.sources.map(source => resolve(base, source));
}

const BASE64_VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VLQ_DIGIT_VALUES = new Map([...BASE64_VLQ_CHARS].map((char, index) => [char, index]));

/** Decodes one Source Map V3 base64-VLQ segment (e.g. `"AAAA"`) into its sequence of signed integers. `null` on an invalid character. */
function decodeVlqSegment(segment) {
    const values = [];
    let value = 0;
    let shift = 0;
    for (const char of segment) {
        const digit = BASE64_VLQ_DIGIT_VALUES.get(char);
        if (digit === undefined) {
            return null;
        }
        value += (digit & 0x1f) << shift;
        if ((digit & 0x20) !== 0) {
            shift += 5;
            continue;
        }
        const negative = (value & 1) === 1;
        value >>>= 1;
        values.push(negative ? -value : value);
        value = 0;
        shift = 0;
    }
    return values;
}

/**
 * Decodes a Source Map V3 `mappings` string into a `genLine`/`genColumn`-sorted array of
 * `{ genLine, genColumn, srcLine, srcColumn }` points (all 0-based, the spec's own convention).
 * Segments with fewer than 4 fields (no source position, or a parse failure) are skipped -- this
 * module never needs the optional 5th (name index) field, and an unmapped generated position is
 * exactly what `no-representable-source-location` exists to catch. This repository's build has
 * exactly one `sources` entry per map (enforced before this is ever called), so the 2nd field
 * (source index delta) is decoded but intentionally unused.
 */
function decodeMappings(mappings) {
    const points = [];
    if (typeof mappings !== 'string' || mappings.length === 0) {
        return points;
    }
    let srcLine = 0;
    let srcColumn = 0;
    const lines = mappings.split(';');
    for (let genLine = 0; genLine < lines.length; genLine += 1) {
        let genColumn = 0;
        const segments = lines[genLine].length === 0 ? [] : lines[genLine].split(',');
        for (const segment of segments) {
            const fields = decodeVlqSegment(segment);
            if (fields === null || fields.length < 4) {
                continue;
            }
            genColumn += fields[0];
            srcLine += fields[2];
            srcColumn += fields[3];
            points.push({ genColumn, genLine, srcColumn, srcLine });
        }
    }
    points.sort((a, b) => a.genLine - b.genLine || a.genColumn - b.genColumn);
    return points;
}

/** The byte offset each line of `text` starts at (index 0 is always offset 0), for `offsetToPosition`. */
function computeLineStartOffsets(text) {
    const offsets = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '\n') {
            offsets.push(index + 1);
        }
    }
    return offsets;
}

/** Converts a byte `offset` into `text` (via its precomputed `lineStartOffsets`) to a 0-based `{ line, column }`. */
function offsetToPosition(lineStartOffsets, offset) {
    let low = 0;
    let high = lineStartOffsets.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (lineStartOffsets[mid] <= offset) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return { column: offset - lineStartOffsets[low], line: low };
}

/** The nearest `mappingPoints` entry at or before generated `position` (points must already be sorted by `genLine`/`genColumn`), or `null` if every point is strictly after it (including an empty `mappingPoints`). */
function lookupSourcePosition(mappingPoints, position) {
    let candidate = null;
    for (const point of mappingPoints) {
        if (point.genLine > position.line || (point.genLine === position.line && point.genColumn > position.column)) {
            break;
        }
        candidate = point;
    }
    return candidate;
}

/**
 * Converts one raw V8 `{ startOffset, endOffset, count }` range into an Istanbul-style
 * `{ start, end, count }` entry (1-based `line`, 0-based `column`, mirroring Istanbul's own
 * `statementMap`) via `mappingPoints`/`lineStartOffsets`. Returns `{ entry, omit: false }` on success.
 *
 * On failure to resolve an end position, returns `{ entry: null, omit }`: `omit` is `true` (caller
 * silently drops the range: a generated-helper omission) iff `mappingPoints` is
 * non-empty -- the script does have real source attribution, just not for this generated-only range
 * (e.g. a tsc-emitted interop helper's fallback arm) -- and by the same monotone `lookupSourcePosition`
 * proof the statement-endpoint start-snap fallback below relies on (`startOffset <= endOffset` so
 * `endSource === null` implies `startSource === null`), there is no other range shape this can be.
 * `omit` is `false` (caller fails closed as `no-representable-source-location`) when `mappingPoints` is
 * empty -- an absent source map must never silently drop an entire script's coverage. An empty mapping
 * population remains fail-closed unless the compiled body is byte-equal to the canonical TypeScript
 * type-erasure stub; that exception is decided by the discovery caller's pre-check before `convertRange`
 * is ever invoked (type-only empty-map disposition) -- `convertRange` itself is unchanged and still
 * returns `omit: false` for an empty `mappingPoints`.
 */
function convertRange(range, mappingPoints, lineStartOffsets) {
    let startSource = lookupSourcePosition(mappingPoints, offsetToPosition(lineStartOffsets, range.startOffset));
    const endSource = lookupSourcePosition(mappingPoints, offsetToPosition(lineStartOffsets, range.endOffset));
    if (startSource === null && endSource !== null) {
        // The start precedes every mapping point (e.g. an unmapped generated `tsc` preamble line), but
        // the range's own end still resolves -- snap start to the first mapping point instead of
        // failing closed. `mappingPoints` is sorted ascending, so its first entry is exactly that point,
        // and it is guaranteed at or before `endSource`'s point (the nearest one <= end).
        startSource = mappingPoints[0];
    }
    if (endSource === null) {
        return { entry: null, omit: mappingPoints.length > 0 };
    }
    return {
        entry: Object.freeze({
            count: range.count,
            end: Object.freeze({ column: endSource.srcColumn, line: endSource.srcLine + 1 }),
            // Partial shard union: `range`'s own compiled-JS byte offsets, carried through unchanged instead
            // of being discarded once the mapped position is resolved. `convertRange`'s own mapped
            // `start`/`end` are not injective (`lookupSourcePosition` resolves to the nearest preceding
            // mapping point, so more than one `range` can legitimately degenerate to the same mapped
            // position -- e.g. several ranges inside a sparsely-mapped region all snapping to the same
            // zero-width point). `startOffset`/`endOffset` are the one piece of this range's identity
            // that stays content-derived and consistent even when the mapped position degenerates, for
            // any of `convertRange`'s callers: a raw V8 range (`flattenAndValidateRecordRanges` above
            // already enforces no two ranges in the same raw record share a `(startOffset, endOffset)`
            // pair), a statement basis span (`buildStatementBasisEntries` below -- spans run
            // between consecutive `mappingPoints` entries, which are strictly increasing, so no two spans
            // of the same script share a pair either), or a branch basis span
            // (`buildBranchBasisEntries` below -- one span per distinct AST node's own text
            // range, so two spans sharing a pair would require two authorized constructs occupying the
            // exact same compiled bytes, which real `tsc` output never produces). So
            // this pair alone is enough for a consumer to tell two degenerate-mapped entries apart
            // without reintroducing a shard-local array index, raw range, or execution order.
            endOffset: range.endOffset,
            start: Object.freeze({ column: startSource.srcColumn, line: startSource.srcLine + 1 }),
            startOffset: range.startOffset,
        }),
        omit: false,
    };
}

/**
 * The byte offset in `jsSource` where its trailing `sourceMappingURL` comment begins (already known to
 * exist -- this is only ever called once a source map was successfully read from that same comment), or
 * `jsSource.length` if no match is found. This is the right edge for the last mapping point's basis span
 * in `buildStatementBasisEntries` below: real compiled output has no executable statement after this
 * comment for any location to occupy.
 */
function compiledBodyEndOffset(jsSource) {
    const matches = [...jsSource.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
    return matches.length === 0 ? jsSource.length : matches[matches.length - 1].index;
}

/**
 * The generated byte offset `point` (`{ genLine, genColumn }`) resolves to within `lineStartOffsets`, or
 * `null` if `point.genLine` names no line the compiled text actually has (a mapping segment pointing
 * past the file's own content -- unrepresentable, not merely unmapped).
 */
function mappingPointOffset(point, lineStartOffsets) {
    if (point.genLine >= lineStartOffsets.length) {
        return null;
    }
    return lineStartOffsets[point.genLine] + point.genColumn;
}

/**
 * `mappingPoints` sorted by *source* position (`srcLine`/`srcColumn`)
 * instead of `decodeMappings`'s own generated-position order -- the reverse index
 * `lookupGeneratedPositionForSource` below needs for its own "nearest preceding" search. A fresh
 * array (never mutates `mappingPoints`, which callers still use in generated-position order
 * elsewhere); ties broken by generated position so the result is deterministic even when two points
 * share one source position (a real, if unusual, source map shape -- e.g. two generated spans both
 * degenerating to the same zero-width source position).
 */
function buildMappingPointsSortedBySource(mappingPoints) {
    return [...mappingPoints].sort(
        (a, b) =>
            a.srcLine - b.srcLine ||
            a.srcColumn - b.srcColumn ||
            a.genLine - b.genLine ||
            a.genColumn - b.genColumn,
    );
}

/**
 * The reverse of `lookupSourcePosition` above -- the nearest
 * `sortedBySource` entry whose own `(srcLine, srcColumn)` is at or before `sourcePosition` (a "floor"
 * search), or `null` if every entry is strictly after it (including an empty `sortedBySource`). Source
 * maps are not guaranteed strictly monotonic in the source axis (a compiled statement can legitimately
 * reorder relative to its source, e.g. hoisting), so this is the same tolerant "nearest preceding"
 * heuristic `lookupSourcePosition` already applies on the generated axis, mirrored onto the source axis
 * -- not a new approximation this module did not already accept. Used by
 * `reverseTranslateDistOffsetToExecuted` below to find the nearest point in a transform capture's own
 * source map (sorted by source position) for a dist-file source position, the second of that function's
 * two reversed hops.
 */
function lookupFloorGeneratedPositionForSource(sortedBySource, sourcePosition) {
    let candidate = null;
    for (const point of sortedBySource) {
        if (
            point.srcLine > sourcePosition.srcLine ||
            (point.srcLine === sourcePosition.srcLine && point.srcColumn > sourcePosition.srcColumn)
        ) {
            break;
        }
        candidate = point;
    }
    return candidate;
}

/**
 * Converts a **query point** (statement and branch counts must come from one coordinate space) the other
 * direction from translating raw ranges -- a dist-file byte
 * offset (where a statement or branch basis span itself begins) into the corresponding byte offset in
 * the WRAPPED text Vitest's `VitestModuleEvaluator` actually executed for `capture`, so that offset can
 * be compared directly against that capture's own record's raw V8 ranges, which are never translated or
 * rewritten at all (translating the *ranges* instead
 * silently scrambles V8's own range-nesting invariant on a source map far coarser than individual V8
 * ranges).
 *
 * Two hops, reversing `discoverCompiledSnapshotCoverage`'s own forward dist -> src decode: (1)
 * `distOffset` -> generated `(line, column)` in the dist file (`offsetToPosition` over
 * `distLineStartOffsets`) -> nearest-preceding source position via the *same* `mappingPoints`
 * `discoverCompiledSnapshotCoverage` already decoded from the on-disk dist file's own map
 * (`lookupSourcePosition`, forward direction, unchanged); (2) that source position -> nearest-preceding
 * generated position in `capture`'s own composed source map (`codeMappingPointsBySource`, `capture.map`
 * decoded and re-sorted by source position the same way `buildMappingPointsSortedBySource` already does)
 * -> a byte offset in `capture.code` (`mappingPointOffset` over `codeLineStartOffsets`) -> the actual raw
 * V8 offset, by adding back `capture.wrapperPrefixLength` (the wrapper this capture's own code was
 * executed inside of, stripped when the capture was taken, so it must be restored here to land in the
 * SAME coordinate space `capture`'s own raw ranges are already in).
 *
 * Returns `null` (caller attributes `0` for this record, never a fabricated fallback) when either hop
 * has no representable position at all -- an empty mapping population on either side, or a dist
 * position that precedes every source position `capture`'s own map records.
 *
 * Both hops below return `null` on the "precedes every source position" condition rather than
 * substituting `?? mappingPoints[0]` / `?? codeMappingPointsBySource[0]`: snapping a query that precedes
 * every known point to the file's/capture's FIRST mapped position would attribute the query to a wholly
 * unrelated statement's position. The same "no representable position ⇒ this record contributes `0`"
 * handling `codeOffset === null` uses below (and every other `queryOffsetFor` caller in this module
 * relies on) applies instead.
 */
function reverseTranslateDistOffsetToExecuted({
    distOffset,
    distLineStartOffsets,
    mappingPoints,
    codeMappingPointsBySource,
    codeLineStartOffsets,
    wrapperPrefixLength,
}) {
    if (mappingPoints.length === 0 || codeMappingPointsBySource.length === 0) {
        return null;
    }
    const distPosition = offsetToPosition(distLineStartOffsets, distOffset);
    const srcPoint = lookupSourcePosition(mappingPoints, distPosition);
    if (srcPoint === null) {
        // distOffset precedes every mapping point the dist file's own source map records -- no source
        // position exists to reverse-translate through the capture's own map at all.
        return null;
    }
    const codePoint = lookupFloorGeneratedPositionForSource(codeMappingPointsBySource, {
        srcColumn: srcPoint.srcColumn,
        srcLine: srcPoint.srcLine,
    });
    if (codePoint === null) {
        // The capture's own source map never mapped anything at or before this source position (e.g. the
        // capture only observed a later part of a re-exported/aliased module).
        return null;
    }
    const codeOffset = mappingPointOffset(codePoint, codeLineStartOffsets);
    if (codeOffset === null) {
        return null;
    }
    return codeOffset + wrapperPrefixLength;
}

/**
 * `"model/Configuration.js"` can match two distinct candidate transform captures: two same-pid
 * transform captures for the identical resolved script, with different `code` text (so the existing
 * exact-content dedup above does not collapse them into one), can share the exact same wrapped length.
 * This is plausible for `Configuration.js` in this repository's own tests:
 * `test/server/configuration/configuration.spec.test.ts`'s
 * `vi.doMock('node:fs', ...)` + `vi.resetModules()` + dynamic `import()` and at least one other test
 * that also loads `Configuration.js` with its own, differently-worded `fs`/`node:fs` mock (e.g.
 * `test/server/service-interface/imp/upload-lifecycle.test.ts`'s own `vi.doMock('fs'/'node:fs', ...)`)
 * can each independently trigger Vite's SSR transform for `Configuration.js` itself -- and a mock
 * factory difference in what `Configuration.js` IMPORTS never changes Vite's own transform of
 * `Configuration.js`'s OWN source text, so two runs of that transform are normally byte-identical
 * (deduped above) UNLESS something else Vite/Vitest attaches per evaluation (a cache-busting id, a
 * per-load comment, a differently-sized import specifier it rewrites) varies between them while
 * coincidentally preserving the exact total length (same-length identifiers/ids).
 *
 * Regardless of the exact two texts, failing closed here is only ACTUALLY necessary when the choice
 * between the candidates can change the answer. Every basis query this module ever issues against a
 * captured record funnels through `reverseTranslateDistOffsetToExecuted`, and every one of ITS OWN
 * queries is first resolved against `mappingPoints` (the dist file's own decoded source map, shared by
 * every candidate -- `lookupSourcePosition` only ever returns an entry already IN `mappingPoints`, or
 * `null`) before the candidate-specific second hop (source position -> that ONE candidate's own
 * generated position) ever runs. So checking every remaining candidate's own second hop for every entry
 * already in `mappingPoints` -- a finite, known, already-decoded set -- is not merely a sample: it
 * covers every distinct source position ANY basis query (statement or branch, dist offsets bounded by
 * the same file) could ever resolve to. If every candidate's own translation agrees at every one of
 * those positions, the choice among them is PROVABLY inconsequential for this script's own basis, no
 * matter which one is picked; if even one diverges, this still fails closed exactly as before -- never a
 * guess.
 */
function candidateTranslationsAreEquivalent(candidates, mappingPoints, distLineStartOffsets) {
    if (candidates.length <= 1) {
        return true;
    }
    let decodedCandidates;
    try {
        decodedCandidates = candidates.map(candidate => {
            const codeMappingPoints = decodeMappings(candidate.map.mappings);
            return {
                codeLineStartOffsets: computeLineStartOffsets(candidate.code),
                codeMappingPointsBySource: buildMappingPointsSortedBySource(codeMappingPoints),
                wrapperPrefixLength: candidate.wrapperPrefixLength,
            };
        });
    } catch {
        // A candidate whose own map cannot even be decoded here provides no basis for proving
        // equivalence -- fail closed exactly as if this check had never run (the caller's own
        // `ambiguous-raw-offset-space` rejection), never a guess that it would have agreed.
        return false;
    }
    for (const point of mappingPoints) {
        const distOffset = mappingPointOffset(point, distLineStartOffsets);
        if (distOffset === null) {
            continue;
        }
        let reference;
        for (let index = 0; index < decodedCandidates.length; index += 1) {
            const own = decodedCandidates[index];
            const translated = reverseTranslateDistOffsetToExecuted({
                codeLineStartOffsets: own.codeLineStartOffsets,
                codeMappingPointsBySource: own.codeMappingPointsBySource,
                distLineStartOffsets,
                distOffset,
                mappingPoints,
                wrapperPrefixLength: own.wrapperPrefixLength,
            });
            if (index === 0) {
                reference = translated;
            } else if (translated !== reference) {
                return false;
            }
        }
    }
    return true;
}

/**
 * The count assigned
 * to `offset` -- a statement OR branch basis span's own start offset; this is the single rule both
 * bases use (checked with plain-node V8 probes) -- is the `count` of `flatRawRanges`'s *innermost* (smallest-width) entry whose
 * `[startOffset, endOffset)` contains it, mirroring V8's own block-coverage nesting (an inner range's
 * count is always the more precise observation for the sub-region it covers; ties cannot occur for a
 * real V8 dump, whose ranges are properly nested or disjoint, never two distinct same-width ranges both
 * containing the same point). `0` when no raw range contains `offset` at all -- this shard's own tests
 * never reached this span, so it is genuinely unobserved, never a fabricated or another shard's borrowed
 * nonzero value. `flatRawRanges` here MUST be every range of every function in the record -- including
 * each function's own `ranges[0]` (its whole-body extent) and every `isBlockCoverage === false`
 * function's ranges -- never a filtered subset (a filter applied only to the branch basis, such as `isBlockCoverage === true`
 * functions only, gives wrong counts):
 *   - V8 never emits a nested range whose count equals its own parent's -- an always-taken branch (an
 *     `if` whose condition is always true, a ternary/`&&`/`||`/`??` arm always evaluated, a `case` always
 *     matched) therefore has NO range of its own at all, and correctly inherits the innermost ENCLOSING
 *     range's count. Excluding a function's `ranges[0]` throws
 *     that inherited count away for exactly this shape, silently reporting an always-taken branch as
 *     never-taken.
 *   - Excluding every `isBlockCoverage === false` function's ranges entirely
 *     removes the ONE range that correctly scopes an uncalled function's own body -- a position inside
 *     that uncalled function then falls through to whatever wider, unrelated, possibly-positive-count
 *     range encloses it (an enclosing called function, a module-top-level range, …), fabricating a
 *     phantom nonzero count for code that never ran (confirmed empirically against this repository's own
 *     `RecorderModel.ts`/`ReservationManageModel.ts` compiled output).
 * Only AFTER the innermost range is selected: if it belongs to a function with `isBlockCoverage: false`
 * (function-invocation-granularity only -- V8 recorded no block-level detail for it at all) and its own
 * `count` is positive, this specific position has no genuine block-level evidence to report a specific
 * count for -- fabricating one (even the function's own whole-body count) would silently overstate what
 * was actually observed.
 *
 * A real run can reach this shape: once a worker process has called `v8.stopCoverage()` (so precise
 * coverage is disabled), V8 still tracks a coarse, best-effort invocation count for code compiled after
 * that point, surfacing as exactly this shape (`isBlockCoverage: false`, a positive count, no block
 * detail). `test/server/harness/coverage-raw-flush-guard.ts` stops coverage once per worker process
 * (never once per test file), which removes the dominant cause -- but this remains possible in
 * general (any V8 coverage
 * collection genuinely running in "best effort" mode for part of a process's life is a real, valid V8
 * state, not a converter bug), so this function itself never fails the whole run over it: this specific
 * QUERY, for THIS ONE RECORD, contributes `0` -- exactly like a range that does not contain `offset` at
 * all -- and reports which range triggered it via `functionGranularityRange` so the caller can record a
 * diagnostic (never inflated: undercounting is the only direction this can err in). A `count` of `0` on
 * an `isBlockCoverage: false` winner is NOT this case at all -- it is the correct, legitimate "this
 * function/branch was never reached" observation described above, and returns normally.
 *
 * Callers that hold more than one raw script record must invoke this once per record's own coherent
 * topology, then sum the non-negative results (see `countForSpanStartAcrossRecords`) -- never feed a
 * synthetic exact-coordinate union of those records into this function first. Cross-record exact-key
 * merge remains valid for the public `functions` field, but that union drops record-local nesting and
 * can false-zero a parent-positive topology that never carried an exact inner zero range.
 */
function countForSpanStart(offset, flatRawRanges) {
    let best = null;
    for (const range of flatRawRanges) {
        if (range.startOffset <= offset && offset < range.endOffset) {
            if (best === null || range.endOffset - range.startOffset < best.endOffset - best.startOffset) {
                best = range;
            }
        }
    }
    if (best === null) {
        return { count: 0, functionGranularityRange: null };
    }
    if (best.isBlockCoverage === false && best.count > 0) {
        return { count: 0, functionGranularityRange: best };
    }
    return { count: best.count, functionGranularityRange: null };
}

/**
 * For each raw-record topology in `recordRangeSets`, take that record's
 * innermost-containing count via `countForSpanStart`, then add the non-negative integers. A single-record
 * caller passes a one-element array and gets the same result as a direct `countForSpanStart` call.
 *
 * `offset` is always a
 * *dist*-file byte offset (every basis span, statement or branch, is defined in dist coordinates -- see
 * `buildStatementBasisEntries`/`buildBranchBasisEntries`). Each element of `recordRangeSets` is a
 * descriptor `{ flatRawRanges, queryOffsetFor }`, not a bare flat-range array: `flatRawRanges` stays in
 * whatever coordinate space that ONE record's raw V8 ranges actually live in (dist-native for a plain
 * `require()`/child-process record; the WRAPPED executed-text space for a Vitest-module-runner record),
 * and `queryOffsetFor(distOffset)` converts the dist-space query into that SAME space before
 * `countForSpanStart` ever compares it against `flatRawRanges` -- identity for a dist-native record,
 * `distOffset -> src position -> executed position` for a captured one (see
 * `reverseTranslateDistOffsetToExecuted`). The opposite design (translating
 * every RAW RANGE forward into dist coordinates, then reusing `countForSpanStart` as if nothing had
 * changed) is not used: `countForSpanStart`'s own "narrowest range wins" heuristic assumes the *raw* ranges are
 * properly nested by construction (V8's own invariant, true only in V8's OWN coordinate space) --
 * forward-translating each range independently through a source map with far coarser granularity than
 * individual V8 ranges is not injective, so two raw ranges that are properly nested in executed-text
 * space can independently collapse to overlapping or reordered dist spans, silently scrambling which one
 * "wins" for a given basis span. Querying in the record's OWN native space instead never disturbs that
 * nesting at all -- only the single query point is translated, never the ranges being compared against
 * each other. `queryOffsetFor` returning `null` (the dist offset has no representable position at all in
 * this record's own space) contributes `0` for that record, never a fabricated fallback.
 *
 * `onFunctionGranularityExclusion`, when given, is invoked once per record whose own
 * `countForSpanStart` call reported a `functionGranularityRange` (see there) for this query -- with that
 * record's own descriptor and the offending range -- so the caller can record a diagnostic. That record's
 * own contribution for THIS query is `0` either way (never fabricated, never inflated); only the OTHER
 * records in `recordRangeSets` (if any prove real block-level evidence for this same position) still
 * contribute their own counts normally.
 */
function countForSpanStartAcrossRecords(distOffset, recordRangeSets, onFunctionGranularityExclusion) {
    let total = 0;
    for (const descriptor of recordRangeSets) {
        const queryOffset = descriptor.queryOffsetFor(distOffset);
        if (queryOffset === null) {
            continue;
        }
        const { count, functionGranularityRange } = countForSpanStart(queryOffset, descriptor.flatRawRanges);
        if (functionGranularityRange !== null && onFunctionGranularityExclusion !== undefined) {
            onFunctionGranularityExclusion(descriptor, functionGranularityRange);
        }
        total += count;
    }
    return total;
}

/**
 * Identity-stable statement AND branch-outcome exclusion authorization (finite table, one entry per
 * authorized source file). Not a general-purpose ignore registry: new exclusions require an independent
 * review that extends this table. Marker identifiers are emit-erased ambient
 * `declare const …: unique symbol` names. Each entry's `boundFunctions` are the function units whose code the
 * approval depends on (the units holding the excluded code, and the units the rationale relies on), and its
 * `statementAnchors` / `branchAnchors` name the excluded entries; `applyCoverageExclusions` resolves them
 * independently, so an entry may authorize only statements, only branches, or both.
 */
const COVERAGE_EXCLUSION_MARKER_PREFIX = '__EPGSTATION_COVERAGE_EXCLUSION_';
const COVERAGE_EXCLUSION_VIDEO_UTIL_SETTLED_TRUE_ARM_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_R2_VIDEO_UTIL_SETTLED_TRUE_ARM_20260808';
// `VideoUtil.getInfo`'s first `if (settled) { return; }` true arm (the `onTimeout` closure) has one statement
// entry, `return;`, and one branch-outcome entry, the whole `{ return; }` block; both are uncovered because
// the arm never runs. (The punctuation-only and whitespace-only spans of the arm never reach the statement
// basis: `classifyStatementSpan`, see module doc, omits a span with no executable token before the
// authorization is consulted.) All three callers of `onTimeout` -- `onDeadlineExpired` (itself only reachable
// once, guarded the same way), `onResult` (including its own `deadlineReached` branches), and the startup
// `if (!settled)` guard -- synchronously check `settled === false` immediately before calling `onTimeout()`,
// and nothing executes between that check and the call that could set `settled` (no `await`, no callback
// re-entry): `onTimeout` itself is the only place `settled` is ever read inside this arm's guard, and it
// runs to completion synchronously up to the point it sets `settled = true` (see `onTimeout`'s own body). So
// by construction `settled` is always `false` on every entry to `onTimeout`, and the true arm this
// branch/statement pair covers can never execute. All of these closures are inside `VideoUtil.getInfo`,
// the one unit the approval binds to.

// `fs.readFileSync(filePath, 'utf-8')` (with an encoding argument) either returns a `string` or
// throws synchronously -- it never resolves to `undefined` -- and the surrounding `catch` block (a few
// lines above `readLogFile`'s own `if (typeof str === 'undefined')` guard) always calls
// `process.exit(1)`, which terminates the process synchronously before control could ever fall through
// to the guard with `str` left at anything other than its own initial `''`. So `typeof str ===
// 'undefined'` -- and therefore the whole `{ console.error(...); process.exit(1); }` arm it guards -- can
// never be true.
const COVERAGE_EXCLUSION_LOGGER_MODEL_READLOGFILE_UNDEFINED_STR_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_LOGGER_MODEL_READLOGFILE_UNDEFINED_STR_20260924';

// `waiter.resolve` (allocated by `IPCClient.acquireRecordedResourceUse`) is only ever read inside
// `IPCClient.startRequest`. Every waiter reaching `startRequest` came through `IPCClient.drainAllocationWaiters`
// (which calls `waiter.start(id)` for a waiter that has a `start` callback), and every waiter
// `acquireRecordedResourceUse` itself constructs always sets `start`. So the three statement
// spans inside `startRequest`'s own message-assembly (the fields that only `acquireRecordedResourceUse`'s
// waiter shape supplies) always execute for a defined `resolve`/`start` pair; there is no path that
// reaches this construction with `waiter.resolve` left unset. The approval binds to
// `acquireRecordedResourceUse`, `startRequest` and `drainAllocationWaiters`.
const COVERAGE_EXCLUSION_IPC_CLIENT_ACQUIRE_WAITER_START_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_IPC_CLIENT_ACQUIRE_WAITER_START_20260924';

// `ExternalCommandManageModel.startCommand`'s own only caller is `addCommand` (its `return this.startCommand(...)`),
// and every `command` callback `addCommand` is ever invoked with is one of the three arrow functions in
// `addReserve`/`addRecorded`/`addFinishEncode`, each of which calls one of
// `createReserveCmd`/`createRecordedCmd`/`createFinishEncodeCmd` -- `async` methods.
// Calling an `async` function never throws synchronously (any throw inside its body becomes a rejected
// Promise instead); it can only ever reject asynchronously. So `result = command()` can never throw, and
// the surrounding `catch (err: any) { this.failCommand(active, err); return completion; }` can never run.
// The approval binds to `startCommand` and to every unit named above.
const COVERAGE_EXCLUSION_EXTERNAL_COMMAND_SYNC_THROW_CATCH_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_EXTERNAL_COMMAND_SYNC_THROW_CATCH_20260924';

// Two independent `X === null` guards, both provably unreachable at their own call sites.
// (a) `DropCheckerModel.appendFile`'s `if (this.dest === null) throw ...`: `this.dest` is assigned in `prepare`,
//     and `RecorderModel` calls `attach` only after `prepare` succeeded; every `aribts` event listener that can
//     ever lead to `appendFile` is registered inside `attach`, and `onFinish` (the only other path that
//     could run ahead of listener wiring) returns early while `tsPacketAnalyzer` is still
//     `null` -- nothing ever resets `dest` back to `null` afterward.
// (b) `DropCheckerModel.getResult`'s `if (this.result === null) throw ...`: `setResult`'s Promise only resolves
//     either because `result` (aribts' own `Result` object, never `null`) was already assigned before the
//     Promise was even created, or because `FINISH_EVENT` fired (in `onFinish`) strictly after `this.result =
//     result` already ran. Either way, by the time `getResult`'s `await this.setResult()`
//     returns, `this.result` is already non-null.
// The approval binds to `appendFile`, `getResult`, and the units (a) and (b) rely on: `prepare`, `attach`, `onFinish` and
// `setResult`.
const COVERAGE_EXCLUSION_DROP_CHECKER_MODEL_NULL_GUARDS_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_DROP_CHECKER_MODEL_NULL_GUARDS_20260924';

// Four `if (firstDataObserved || outcomeSettled) return;`-shaped guards inside the same
// `start`-time Promise executor of `RecorderModel.doRecord`, all unreachable by the same single-threaded
// synchronization argument.
// `onData` is registered with `stream.once('data', onData)`, so it can run at most once; the very
// first thing it does after its own guard is set `firstDataObserved = true` with no
// `await` before it. `takeOutcome` likewise sets `outcomeSettled = true` and calls
// `releaseListeners` -- which synchronously does `clearTimeout(recordingTimeoutId)` and
// `waitingStream.removeListener('data', onData)` -- before any `await`. Because JavaScript runs
// each of these synchronous prefixes to completion without interleaving, whichever of `onData` or
// the `recordingTimeoutId` callback starts first flips its own flag (and, for the timeout path,
// removes the `data` listener) before the other could ever observe the pre-flip state. So each of these
// guards' own `return;` arm -- `onData`'s, and the `recordingTimeoutId` callback's own copy
// -- can never be taken. (This authorization deliberately excludes the structurally similar
// guards in `settleFailure` (its own `if (!takeOutcome()) return;`) and in the
// registration watchdog -- both remain reachable; do not add them here.)
// Separately, `err instanceof Error ? err : new Error('AddRecordedDBError')` -- the
// `whenFalse` arm is unreachable because `RecorderModel.addRecorded`'s own `catch` block always re-throws via
// `throw new Error('AddRecordedDBError', { cause: err })`, so anything that reaches this
// ternary by rejecting `registration` is already an `Error` instance.
// Finally, the `if (!takeOutcome()) return;` (guarding
// `this.recordedUseProvider.releaseSessionUse(...)`) is reached only after the earlier `outcomeSettled` check
// already found `outcomeSettled === false`, with no `await` and no callback re-entry point
// between that check and here -- so `takeOutcome()` here always succeeds (returns `true`), and the
// `!takeOutcome()` arm can never run.
// The approval binds to `doRecord` and `addRecorded`.
const COVERAGE_EXCLUSION_RECORDER_MODEL_ONDATA_TIMEOUT_GUARDS_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_RECORDER_MODEL_ONDATA_TIMEOUT_GUARDS_20260924';

// `RecordingManageModel.releaseRecordedUse`'s own
// `if (this.normalRecordedUseTerminals.get(active.recorder) === active.recordedUse) { this.normal…delete(...); }`
// is unreachable from either of its two real call sites. The caller in `setEvents`
// (`setFinishRecording`'s callback) only calls `releaseRecordedUse` when
// `!this.isAwaitingNormalRecordedUseTerminal(reserve.id, recorded.id)` -- and that helper's own check
// already compares `normalRecordedUseTerminals.get(active.recorder) === active.recordedUse` for
// the SAME `(reservationId, recordedId)` pair via the same deterministic `findActiveRecordedUse`,
// so a `false` there means the condition above is also `false` here. The caller in
// `observeNormalRecordedUseTerminal` (its `terminal.then` success callback) always runs
// `this.normalRecordedUseTerminals.delete(recorder)` immediately before calling
// `releaseRecordedUse`, so the map entry the condition tests is already gone by the time it runs.
// The approval binds to `releaseRecordedUse`, `setEvents`, `isAwaitingNormalRecordedUseTerminal`,
// `findActiveRecordedUse` and `observeNormalRecordedUseTerminal`.
const COVERAGE_EXCLUSION_RECORDING_MANAGE_RELEASE_USE_TERMINAL_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_RECORDING_MANAGE_RELEASE_USE_TERMINAL_20260924';

// `RecordingScheduleController.scheduleMicrotaskWake`'s own entry guard `if (this.microtaskScheduled) return;` is
// unreachable at either of its two call sites. `requestCoalescedEvaluation` only reaches its own
// call to `scheduleMicrotaskWake` after already checking `if (this.microtaskScheduled) return;`
// with nothing in between that could set the flag back to `true`. `armSingleWake` calls
// `scheduleMicrotaskWake` only from `evaluate`'s own `finally` block, at which point -- by induction
// over `evaluate`'s own control flow, which never leaves `microtaskScheduled` set to `true` across a
// yield point -- the flag is always `false` when `evaluate` runs. So `scheduleMicrotaskWake`'s own guard
// can never observe `this.microtaskScheduled === true`. The approval binds to `scheduleMicrotaskWake`,
// `requestCoalescedEvaluation`, `armSingleWake` and `evaluate`.
const COVERAGE_EXCLUSION_RECORDING_SCHEDULE_MICROTASK_GUARD_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_RECORDING_SCHEDULE_MICROTASK_GUARD_20260924';

// Two independent unreachable arms in the same file.
// (a) `ReservationManageModel.createDiff`'s log statement ternary-tests
//     `typeof diff.insert === 'undefined' ? 0 : diff.insert.length` (and the same shape for
//     `update`/`delete`) -- but `diff` always comes from `ReservationManageModel.createReservesDiff`, which
//     unconditionally assigns all three arrays (`diff.insert = []; diff.update = []; diff.delete = [];`)
//     before returning. So `typeof diff.insert === 'undefined'` (and the `update`/`delete`
//     equivalents) can never be `true`, and the `0` fallback arm never runs. The approval therefore
//     also binds to `ReservationManageModel.createReservesDiff`.
// (b) `ReservationManageModel.sortReserve`'s final `return 0;` is unreachable because the four `if` clauses
//     above it already cover all four `(aIsManual, bIsManual)` combinations: `isManual` is
//     defined as `ruleId === null`, so once both are known non-manual (the only combination not resolved
//     by the first three clauses), `!aIsManual` and `!bIsManual` already imply `a.ruleId !== null` and
//     `b.ruleId !== null` -- exactly the extra condition the fourth clause tests -- so that clause
//     always returns too.
const COVERAGE_EXCLUSION_RESERVATION_MANAGE_DIFF_LOG_AND_SORT_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_RESERVATION_MANAGE_DIFF_LOG_AND_SORT_20260924';

// The `while (1)` loop in the file's only method (`EncodeFileManageModel.getFilePath`) assigns `result`
// unconditionally on every iteration before its own `try`/`catch` ever runs, and the loop's only exit
// (`break`, inside the `catch`) always runs after that same iteration's assignment already
// completed. So by the time the loop exits, `result` always holds a string, and the `if (result ===
// null) throw new Error('GetFilePathError');` guard right after the loop can never fire.
const COVERAGE_EXCLUSION_ENCODE_FILE_MANAGE_WHILE_RESULT_NULL_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_ENCODE_FILE_MANAGE_WHILE_RESULT_NULL_20260924';

// `EncodeManageModel.checkQueue`'s `if (typeof encoder === 'undefined') { ... }` is unreachable. There is no
// `await` between the `this.waitQueue.length === 0` early-return check and `this.waitQueue.shift()`,
// so nothing can mutate `waitQueue` in between; if the length check passed, `shift()` always
// returns an element. The only place anything is ever pushed onto `waitQueue` is `EncodeManageModel.push`, and
// by that point `encoder = await this.encoderModelProvider()` has already been dereferenced
// (`encoder.setOption(option)`), which would throw synchronously for a `null`/`undefined` encoder before
// ever reaching the `push`. So every element ever pushed -- and therefore every element `shift()` can
// ever return when the length check passed -- is a real, defined encoder. The approval binds to `checkQueue`
// and `push`.
const COVERAGE_EXCLUSION_ENCODE_MANAGE_CHECK_QUEUE_UNDEFINED_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_ENCODE_MANAGE_CHECK_QUEUE_UNDEFINED_20260924';

// `HlsStreamIdAllocator.findAvailable`'s closing `if (unavailable.has(candidate)) throw new Error('HLSStreamIdUnavailable');`
// can never fire. Every id involved -- `unavailable`'s members, `cursor`, and every value
// `nextStreamId` can produce -- is an integer in `[0, Number.MAX_SAFE_INTEGER]` (the only sources are the
// `stream<ID>.m3u8` scan regex, `reserve`/`getEmptyStreamId`'s own callers, and `nextStreamId`'s own
// wraparound arithmetic, all `Number.isSafeInteger`-checked at their boundary). `streamIdDistance`
// is injective over that same finite domain for a fixed `cursor` (a cyclic distance function with no two
// distinct `to` values mapping to the same distance), so sorting `unavailable` by distance from `cursor`
// and walking forward through `nextStreamId` from `cursor` can only ever stop (loop `break`, or falling
// through when `unavailable` is exhausted) at a candidate whose distance is strictly less than every
// remaining member of `unavailable` -- which, by injectivity, means that candidate is not itself a member.
// The approval binds to `findAvailable`, `reserve`, `nextStreamId` and `streamIdDistance`.
const COVERAGE_EXCLUSION_HLS_STREAM_ID_ALLOCATOR_UNAVAILABLE_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_HLS_STREAM_ID_ALLOCATOR_UNAVAILABLE_20260924';

// `RecordedStreamBaseModel.observeManagedProcessTerminal`'s own `onTerminal`
// closure guards re-entry with `if (isTerminal) return;`. `onTerminal` is registered
// with `child.once('close', onTerminal)`, `.once('error', onTerminal)`, `.once('exit', onTerminal)`
// -- three separate once-registrations of the SAME function reference. Node's
// `EventEmitter#once` wraps each registration so it self-removes only for the event that actually
// fired, but the wrapper's own `.listener` property is set to the original function, so
// `removeListener(type, onTerminal)`, called synchronously and unconditionally the very
// first time `onTerminal` runs (before `isTerminal` is even set to `true`), matches and removes
// ALL THREE once-wrappers by that shared reference -- not just the one for the event that fired.
// So by the time `onTerminal` returns from its first invocation, `child` has zero listeners left
// for 'close'/'error'/'exit', and no subsequent real emission of any of those three events can
// ever invoke `onTerminal` a second time. (Verified directly against Node's own
// `EventEmitter`/`_onceWrap` behavior, not just by inspection.) The only other call path,
// `ProcessUtil.isExited(child) === true`, invokes `onTerminal()` manually but
// synchronously, before returning control to any event loop turn that could interleave a real
// 'close'/'error'/'exit' emission -- so it cannot race either. `observeManagedProcessTerminal` has
// exactly one call site (`RecordedStreamBaseModel.start`), so each call gets its own independent `onTerminal`
// closure and `isTerminal` flag; no two calls share state. The true arm can therefore
// never execute against a genuine `ChildProcess`/`EventEmitter`. The approval binds to
// `observeManagedProcessTerminal` and `start`.
const COVERAGE_EXCLUSION_RECORDED_STREAM_BASE_ONTERMINAL_REENTRY_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_RECORDED_STREAM_BASE_ONTERMINAL_REENTRY_20260924';

// `StreamManageModel.startRecorded`'s own post-condition
// `if (startedStream === null) throw new Error('RecordedStreamStartNotAdopted');` can
// never fire against the real `startInternal`. `startedStream` is a local variable in
// `startRecorded`'s own closure, only ever assigned (`startedStream = stream;`)
// synchronously, immediately after `this.attachStream(active, stream);`, with no
// `await` in between. `active.startResult` (the promise `startInternal` returns, see
// `createActiveStream`) can only ever RESOLVE from a single call site,
// `runStart`'s own `active.startResult.resolve(active.id);`, which itself is reached only
// after `const stream = active.stream; if (stream === null) { ...; return; }` already
// found `active.stream` non-null -- and `active.stream` is set ONLY by `attachStream`
// (`active.stream = stream;`). So whenever `startInternal`'s promise resolves, `attachStream` (and
// therefore, for the `startRecorded` closure, the synchronous `startedStream = stream;` right
// after it) has already run. Every other settlement of `active.startResult` is a REJECTION
// (`rejectStart`, or `finalizeActive`'s own `StreamStartStopped`), which makes the
// `await this.startInternal(...)` call at `startRecorded`'s own call site throw before
// ever reaching the check. So `await this.startInternal(...)` can only return normally with
// `startedStream` already non-null; the `=== null` arm is unreachable other than by directly
// stubbing `startInternal` itself (which is not a real caller). The approval binds to `startRecorded`,
// `startInternal`, `createActiveStream`, `attachStream`, `runStart`, `rejectStart` and `finalizeActive`.
const COVERAGE_EXCLUSION_STREAM_MANAGE_STARTRECORDED_NOTADOPTED_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_STREAM_MANAGE_STARTRECORDED_NOTADOPTED_20260924';

// `TailStream.checkFile`'s recheck timer callback re-checks
// `if (this.isClosed) return;` right after clearing its own `checkFileTimer` reference.
// This can never observe `isClosed === true` against a real stream. `isClosed` is set to
// `true` in exactly one place, `dispose()` (called from `_destroy()`, the only path
// `Readable#destroy()` reaches), and `dispose()` ALWAYS calls `clearTimers()` in the very
// same synchronous call, which does `clearTimeout(this.checkFileTimer); this.checkFileTimer =
// null;` whenever `checkFileTimer` is non-null. `clearTimeout` on a still-pending timer
// prevents its callback from ever running at all -- so if `isClosed` becomes `true` while this
// timer is still pending, the timer (and therefore this callback) is cancelled synchronously in
// that same turn and never fires; if the timer already fired before `dispose()` ran, `isClosed`
// was still `false` at that point. Either way, by the time this callback body actually executes,
// `isClosed` is guaranteed `false`. Only directly writing the private field (bypassing `dispose()`)
// can desynchronize the two. The approval binds to `checkFile`, `dispose`, `clearTimers` and `_destroy`.
const COVERAGE_EXCLUSION_TAIL_STREAM_CHECKFILE_TIMER_ISCLOSED_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_TAIL_STREAM_CHECKFILE_TIMER_ISCLOSED_20260924';

// `StreamBaseModel.startCheckStreamEnable`'s re-entry
// guard `if (this.streamCheckTimer !== null && this.getStreamType().includes('HLS') === false) {
// return; }` can never take its `return` arm against a real caller. There are exactly
// two production call sites -- `RecordedStreamBaseModel` (inside
// `if (this.getStreamType() === 'RecordedHLS')`) and `LiveStreamBaseModel` (inside
// `if (this.getStreamType() === 'LiveHLS')`) -- and both invoke it ONLY when `getStreamType()` is
// already a `*HLS` variant. So for every real call, `this.getStreamType().includes('HLS')` is
// `true`, making the guard's right-hand operand `=== false` always `false`, short-circuiting the
// `&&` to `false` regardless of `streamCheckTimer`'s value -- the `return` body can only run when
// this method is called directly against a non-HLS stream type, which no production call site
// ever does. The approval binds to `startCheckStreamEnable`; the call sites are in other files.
const COVERAGE_EXCLUSION_STREAM_BASE_STARTCHECK_NONHLS_GUARD_MARKER =
    '__EPGSTATION_COVERAGE_EXCLUSION_STREAM_BASE_STARTCHECK_NONHLS_GUARD_20260924';

export const COVERAGE_EXCLUSION_AUTHORIZATIONS = Object.freeze([
    Object.freeze({
        alternativeOwnerEntries: Object.freeze([
            'test/server/recorded-content/probe.spec.test.ts',
            'test/server/recorded-content/probe.test.ts',
            'test/server/recorded-content/recorded-content-process.integration.test.ts',
        ]),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'ac9680027d448daabfb5442f726c30e81c32e56a7abc142babb96ec6c79695d8', name: 'VideoUtil.getInfo' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ return ; }',
                functionName: 'VideoUtil.getInfo',
                tokenEnd: 301,
                tokenStart: 297,
            }),
        ]),
        decisionIdentity: 'video-util-settled-true-arm-return-statement-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_VIDEO_UTIL_SETTLED_TRUE_ARM_MARKER,
        owner: 'server-recorded-content',
        sourcePath: 'src/model/api/video/VideoUtil.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'VideoUtil.getInfo',
                tokenEnd: 300,
                tokenStart: 298,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/operational-logging/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '601e9cdf9923416f85b43764d8662e02295a7080a7fccc112b58c1b5ddb6b68d', name: 'LoggerModel.readLogFile' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ console . error ( \'log file read error\' ) ; process . exit ( 1 ) ; }',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 96,
                tokenStart: 80,
            }),
        ]),
        decisionIdentity: 'logger-model-readlogfile-undefined-str-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_LOGGER_MODEL_READLOGFILE_UNDEFINED_STR_MARKER,
        owner: 'server-operational-logging',
        sourcePath: 'src/model/LoggerModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'console',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 82,
                tokenStart: 81,
            }),
            Object.freeze({
                code: 'error',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 84,
                tokenStart: 83,
            }),
            Object.freeze({
                code: '\'log file read error\'',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 86,
                tokenStart: 85,
            }),
            Object.freeze({
                code: 'process',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 89,
                tokenStart: 88,
            }),
            Object.freeze({
                code: 'exit',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 91,
                tokenStart: 90,
            }),
            Object.freeze({
                code: '1',
                functionName: 'LoggerModel.readLogFile',
                tokenEnd: 93,
                tokenStart: 92,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze([
            'test/server/process-messaging/correlation.spec.test.ts',
            'test/server/process-messaging/deadlines.spec.test.ts',
            'test/server/process-messaging/imp/correlation-lifecycle.test.ts',
            'test/server/process-messaging/imp/id-allocation.test.ts',
            'test/server/process-messaging/imp/deadline-races.test.ts',
            'test/server/process-messaging/imp/dispatcher-peer.test.ts',
            'test/server/process-messaging/integration/process-messaging.integration.test.ts',
        ]),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '20fe40618bff4aa3ec946900790d795c9538b9821b4e1420778b5f5d71187e59', name: 'IPCClient.acquireRecordedResourceUse' }),
            Object.freeze({ codeSha256: '000b323c475ec34687367f8322156e253a33476f540ec55bd7d70c96fd3f2dbf', name: 'IPCClient.startRequest' }),
            Object.freeze({ codeSha256: 'd6cf0c28d095c674ab93b569805979d7696901b7f36c4c426110678fa3874f1d', name: 'IPCClient.drainAllocationWaiters' }),
        ]),
        branchAnchors: Object.freeze([]),
        decisionIdentity: 'ipc-client-acquire-resource-use-waiter-start-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_IPC_CLIENT_ACQUIRE_WAITER_START_MARKER,
        owner: 'server-process-messaging',
        sourcePath: 'src/model/ipc/IPCClient.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'result',
                functionName: 'IPCClient.acquireRecordedResourceUse',
                tokenEnd: 102,
                tokenStart: 101,
            }),
            Object.freeze({
                code: 'resolve',
                functionName: 'IPCClient.acquireRecordedResourceUse',
                tokenEnd: 104,
                tokenStart: 103,
            }),
            Object.freeze({
                code: 'result',
                functionName: 'IPCClient.acquireRecordedResourceUse',
                tokenEnd: 114,
                tokenStart: 113,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze([
            'test/server/event-and-hook-delivery/external-command-queue.spec.test.ts',
            'test/server/event-and-hook-delivery/external-command-environment.spec.test.ts',
            'test/server/event-and-hook-delivery/external-command-failures.spec.test.ts',
            'test/server/event-and-hook-delivery/external-command-selection.spec.test.ts',
            'test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts',
            'test/server/event-and-hook-delivery/imp/external-command-terminal-characterization.test.ts',
            'test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts',
            'test/server/event-and-hook-delivery/integration/external-command-environment.integration.test.ts',
        ]),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '2b2c54a3b4063ae448add57df7e287d06446f62c50f0d193080c368ac5f77f39', name: 'ExternalCommandManageModel.startCommand' }),
            Object.freeze({ codeSha256: '7ebdec832aef177254f1f20547ec71495888eff8c3023be4cac48564fcf69e23', name: 'ExternalCommandManageModel.addCommand' }),
            Object.freeze({ codeSha256: '47f542b71d2b81f0175d1c7e4407908fa0f6576f646b43cd31935df47532964e', name: 'ExternalCommandManageModel.addReserve' }),
            Object.freeze({ codeSha256: '1b7b0050f0a577a17add01f2a71ba27d3f2c19b80edeb147c335477c30cadb0e', name: 'ExternalCommandManageModel.addRecorded' }),
            Object.freeze({ codeSha256: '749c345c6c7701c1523e002a5f492060ce2a0a5a85b9f81f1b711cc58776482b', name: 'ExternalCommandManageModel.addFinishEncode' }),
            Object.freeze({ codeSha256: 'a9c47e074a20705c4dd3b24d22855888e4655a577d25316a804dac7f80223c31', name: 'ExternalCommandManageModel.createReserveCmd' }),
            Object.freeze({ codeSha256: '735deeea504cd8b845eb152ceb11c13d55a5246434291ecb110d67a411ff9837', name: 'ExternalCommandManageModel.createRecordedCmd' }),
            Object.freeze({ codeSha256: 'cf55d423c53acc93705b30cdb368220ad541b082957891663d21eb260d012085', name: 'ExternalCommandManageModel.createFinishEncodeCmd' }),
        ]),
        branchAnchors: Object.freeze([]),
        decisionIdentity: 'external-command-manage-add-command-sync-throw-catch-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_EXTERNAL_COMMAND_SYNC_THROW_CATCH_MARKER,
        owner: 'server-event-and-hook-delivery',
        sourcePath: 'src/model/operator/externalCommand/ExternalCommandManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'err : any',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 190,
                tokenStart: 187,
            }),
            Object.freeze({
                code: 'this',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 193,
                tokenStart: 192,
            }),
            Object.freeze({
                code: 'failCommand',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 195,
                tokenStart: 194,
            }),
            Object.freeze({
                code: 'active',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 197,
                tokenStart: 196,
            }),
            Object.freeze({
                code: 'err',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 199,
                tokenStart: 198,
            }),
            Object.freeze({
                code: 'return',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 202,
                tokenStart: 201,
            }),
            Object.freeze({
                code: 'completion',
                functionName: 'ExternalCommandManageModel.startCommand',
                tokenEnd: 203,
                tokenStart: 202,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/recording-execution/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'c0f1a2b20e217dadb09b228cc68cacd1109d9a8fd674ba9db947339b2a5e7fb7', name: 'DropCheckerModel.appendFile' }),
            Object.freeze({ codeSha256: '9ac2fe60391959c4dff6f1e6682e479f70f91d532bb60409374d5c3966c43a4c', name: 'DropCheckerModel.getResult' }),
            Object.freeze({ codeSha256: '26de67877ed6ffe9ae6a04f9a2bb5410fb7244665be04554d77e796d7db06d2a', name: 'DropCheckerModel.prepare' }),
            Object.freeze({ codeSha256: '46dbc24044947a2d64d379eedf8231d6b85db835a26db7f800b2b296162412c7', name: 'DropCheckerModel.attach' }),
            Object.freeze({ codeSha256: '93e9b2830bef537b1774356657dfa484bae815aa80f685ff43db8ce4783b3665', name: 'DropCheckerModel.onFinish' }),
            Object.freeze({ codeSha256: '5414ba959c2b6667aa741fd9d417a4bcf5246bbc9a4e72477829d1a90ce37625', name: 'DropCheckerModel.setResult' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ throw new Error ( \'LogFilePathIsNull\' ) ; }',
                functionName: 'DropCheckerModel.appendFile',
                tokenEnd: 31,
                tokenStart: 22,
            }),
            Object.freeze({
                code: '{ throw new Error ( \'GetDropResultError\' ) ; }',
                functionName: 'DropCheckerModel.getResult',
                tokenEnd: 54,
                tokenStart: 45,
            }),
        ]),
        decisionIdentity: 'drop-checker-model-null-guards-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_DROP_CHECKER_MODEL_NULL_GUARDS_MARKER,
        owner: 'server-recording-execution',
        sourcePath: 'src/model/operator/recording/DropCheckerModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'throw',
                functionName: 'DropCheckerModel.appendFile',
                tokenEnd: 24,
                tokenStart: 23,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'DropCheckerModel.appendFile',
                tokenEnd: 25,
                tokenStart: 24,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'DropCheckerModel.appendFile',
                tokenEnd: 26,
                tokenStart: 25,
            }),
            Object.freeze({
                code: '\'LogFilePathIsNull\'',
                functionName: 'DropCheckerModel.appendFile',
                tokenEnd: 28,
                tokenStart: 27,
            }),
            Object.freeze({
                code: 'throw',
                functionName: 'DropCheckerModel.getResult',
                tokenEnd: 47,
                tokenStart: 46,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'DropCheckerModel.getResult',
                tokenEnd: 48,
                tokenStart: 47,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'DropCheckerModel.getResult',
                tokenEnd: 49,
                tokenStart: 48,
            }),
            Object.freeze({
                code: '\'GetDropResultError\'',
                functionName: 'DropCheckerModel.getResult',
                tokenEnd: 51,
                tokenStart: 50,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/recording-execution/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '4a483b283c5a26ee44820a9a90d8bd575f9c75062dbc2536d49c6c4e364a8557', name: 'RecorderModel.doRecord' }),
            Object.freeze({ codeSha256: 'f4507b87eee37b00b07b246302b9ec1735f5a610c82d63debbc709995fd5da78', name: 'RecorderModel.addRecorded' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2002,
                tokenStart: 2000,
            }),
            Object.freeze({
                code: 'new Error ( \'AddRecordedDBError\' )',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2247,
                tokenStart: 2242,
            }),
            Object.freeze({
                code: '{ this . recordedUseProvider . releaseSessionUse ( this , recordedUse ) ; return ; }',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2728,
                tokenStart: 2713,
            }),
            Object.freeze({
                code: 'return ;',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2859,
                tokenStart: 2857,
            }),
        ]),
        decisionIdentity: 'recorder-model-ondata-timeout-guards-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_RECORDER_MODEL_ONDATA_TIMEOUT_GUARDS_MARKER,
        owner: 'server-recording-execution',
        sourcePath: 'src/model/operator/recording/RecorderModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2002,
                tokenStart: 2000,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2243,
                tokenStart: 2242,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2244,
                tokenStart: 2243,
            }),
            Object.freeze({
                code: '\'AddRecordedDBError\'',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2246,
                tokenStart: 2245,
            }),
            Object.freeze({
                code: 'this',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2715,
                tokenStart: 2714,
            }),
            Object.freeze({
                code: 'recordedUseProvider',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2717,
                tokenStart: 2716,
            }),
            Object.freeze({
                code: 'releaseSessionUse',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2719,
                tokenStart: 2718,
            }),
            Object.freeze({
                code: 'this',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2721,
                tokenStart: 2720,
            }),
            Object.freeze({
                code: 'recordedUse',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2723,
                tokenStart: 2722,
            }),
            Object.freeze({
                code: 'return ;',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2727,
                tokenStart: 2725,
            }),
            Object.freeze({
                code: 'return ;',
                functionName: 'RecorderModel.doRecord',
                tokenEnd: 2859,
                tokenStart: 2857,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/recording-execution/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'a01dc451fa8d7b2dcd9b2cadf60158eaf258b6509713c384cdd78c492c1be012', name: 'RecordingManageModel.releaseRecordedUse' }),
            Object.freeze({ codeSha256: '08cc4214679b014b38b90d1cc746fcdb697f8407bcb6eff5346d21ac8b95b244', name: 'RecordingManageModel.setEvents' }),
            Object.freeze({ codeSha256: '25419da5f8b1d1938b77680b425e3ede62e5281739c0f35756606d509e16a2f6', name: 'RecordingManageModel.isAwaitingNormalRecordedUseTerminal' }),
            Object.freeze({ codeSha256: 'b05984b802733ea027401358cc0d4ada63a3ca578097316c4fe7c0562ff2146a', name: 'RecordingManageModel.findActiveRecordedUse' }),
            Object.freeze({ codeSha256: '2bbdab534913493112f4093189ad0259933590ecea0c1f6c14e12ffe22beb6a2', name: 'RecordingManageModel.observeNormalRecordedUseTerminal' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ this . normalRecordedUseTerminals . delete ( active . recorder ) ; }',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 115,
                tokenStart: 102,
            }),
        ]),
        decisionIdentity: 'recording-manage-release-recorded-use-terminal-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_RECORDING_MANAGE_RELEASE_USE_TERMINAL_MARKER,
        owner: 'server-recording-execution',
        sourcePath: 'src/model/operator/recording/RecordingManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'this',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 104,
                tokenStart: 103,
            }),
            Object.freeze({
                code: 'normalRecordedUseTerminals',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 106,
                tokenStart: 105,
            }),
            Object.freeze({
                code: 'delete',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 108,
                tokenStart: 107,
            }),
            Object.freeze({
                code: 'active',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 110,
                tokenStart: 109,
            }),
            Object.freeze({
                code: 'recorder',
                functionName: 'RecordingManageModel.releaseRecordedUse',
                tokenEnd: 112,
                tokenStart: 111,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/recording-execution/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '8e94888db21f53fcc6d1b7d77dbb1e682a453af5c25aba6ec7687e47d36fd636', name: 'RecordingScheduleController.scheduleMicrotaskWake' }),
            Object.freeze({ codeSha256: '79c85cba5e44cbccd6144cccd28e4da53b353a46745fe797cfdd3a3a62f96194', name: 'RecordingScheduleController.requestCoalescedEvaluation' }),
            Object.freeze({ codeSha256: 'dcd23806d13d7470b30f732e4c564ad0dcb1a35d314fd47f12cd1c5e411423f7', name: 'RecordingScheduleController.armSingleWake' }),
            Object.freeze({ codeSha256: '9a6823be1f6a5c09c8cccd0d4f1fce6cc7489d479a89ae383a203cc5189bc3b3', name: 'RecordingScheduleController.evaluate' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'RecordingScheduleController.scheduleMicrotaskWake',
                tokenEnd: 15,
                tokenStart: 13,
            }),
        ]),
        decisionIdentity: 'recording-schedule-controller-microtask-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_RECORDING_SCHEDULE_MICROTASK_GUARD_MARKER,
        owner: 'server-recording-execution',
        sourcePath: 'src/model/operator/recording/RecordingScheduleController.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'RecordingScheduleController.scheduleMicrotaskWake',
                tokenEnd: 15,
                tokenStart: 13,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/reservation-management/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '83ee75609b6891ed31fbde1d0c77f3456707d681425bcb1ec4a6bb9970b2a3e4', name: 'ReservationManageModel.createDiff' }),
            Object.freeze({ codeSha256: '232bc7bfbc1b671c333b01d643aeb4b727c979f4f801388c7492c97b98f8106f', name: 'ReservationManageModel.sortReserve' }),
            Object.freeze({ codeSha256: 'bdcd9e22345faaa610b3605bc7c87c0326d502c4f7b5b76924875f2e7e2eb284', name: 'ReservationManageModel.createReservesDiff' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 170,
                tokenStart: 169,
            }),
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 187,
                tokenStart: 186,
            }),
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 204,
                tokenStart: 203,
            }),
        ]),
        decisionIdentity: 'reservation-manage-diff-log-and-sort-reserve-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_RESERVATION_MANAGE_DIFF_LOG_AND_SORT_MARKER,
        owner: 'server-reservation-management',
        sourcePath: 'src/model/operator/reservation/ReservationManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 170,
                tokenStart: 169,
            }),
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 187,
                tokenStart: 186,
            }),
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.createDiff',
                tokenEnd: 204,
                tokenStart: 203,
            }),
            Object.freeze({
                code: 'return',
                functionName: 'ReservationManageModel.sortReserve',
                tokenEnd: 136,
                tokenStart: 135,
            }),
            Object.freeze({
                code: '0',
                functionName: 'ReservationManageModel.sortReserve',
                tokenEnd: 137,
                tokenStart: 136,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/encoding/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'a4a0f258b4630666da35d8d08682ad144becca5b9252c0aaee5fcae66c47b0af', name: 'EncodeFileManageModel.getFilePath' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ throw new Error ( \'GetFilePathError\' ) ; }',
                functionName: 'EncodeFileManageModel.getFilePath',
                tokenEnd: 156,
                tokenStart: 147,
            }),
        ]),
        decisionIdentity: 'encode-file-manage-while-result-null-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_ENCODE_FILE_MANAGE_WHILE_RESULT_NULL_MARKER,
        owner: 'server-encoding',
        sourcePath: 'src/model/service/encode/EncodeFileManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'throw',
                functionName: 'EncodeFileManageModel.getFilePath',
                tokenEnd: 149,
                tokenStart: 148,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'EncodeFileManageModel.getFilePath',
                tokenEnd: 150,
                tokenStart: 149,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'EncodeFileManageModel.getFilePath',
                tokenEnd: 151,
                tokenStart: 150,
            }),
            Object.freeze({
                code: '\'GetFilePathError\'',
                functionName: 'EncodeFileManageModel.getFilePath',
                tokenEnd: 153,
                tokenStart: 152,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/encoding/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'b37d9f827666837d3d3fbef89a94fcedc7f55242caa0e598f75b1b88031b17f3', name: 'EncodeManageModel.checkQueue' }),
            Object.freeze({ codeSha256: 'c299e58955973f00f65a35afed91cc59862e1fe95303bf0fcfd0736be3534ee7', name: 'EncodeManageModel.push' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ this . executeManagementModel . unLockExecution ( exeId ) ; return ; }',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 90,
                tokenStart: 77,
            }),
        ]),
        decisionIdentity: 'encode-manage-check-queue-undefined-encoder-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_ENCODE_MANAGE_CHECK_QUEUE_UNDEFINED_MARKER,
        owner: 'server-encoding',
        sourcePath: 'src/model/service/encode/EncodeManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'this',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 79,
                tokenStart: 78,
            }),
            Object.freeze({
                code: 'executeManagementModel',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 81,
                tokenStart: 80,
            }),
            Object.freeze({
                code: 'unLockExecution',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 83,
                tokenStart: 82,
            }),
            Object.freeze({
                code: 'exeId',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 85,
                tokenStart: 84,
            }),
            Object.freeze({
                code: 'return ;',
                functionName: 'EncodeManageModel.checkQueue',
                tokenEnd: 89,
                tokenStart: 87,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/media-delivery/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'ee331a6b9a25f1a5147d7c85023495802e09e9dab2ddfe10223dae846e5e45b9', name: 'HlsStreamIdAllocator.findAvailable' }),
            Object.freeze({ codeSha256: '16f3999ae8fcfdbd81b84675f0122be4da958e185c23c2061e8fcdafcd530500', name: 'HlsStreamIdAllocator.reserve' }),
            Object.freeze({ codeSha256: '61f993efedef02bf349d6d3633d503e57fdc84326471cbbc83f3f9f03e5fab1b', name: 'HlsStreamIdAllocator.nextStreamId' }),
            Object.freeze({ codeSha256: '96a881140252da20aaf97be38608cbce1df15d5aaf3883788374be9429d8400e', name: 'HlsStreamIdAllocator.streamIdDistance' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ throw new Error ( \'HLSStreamIdUnavailable\' ) ; }',
                functionName: 'HlsStreamIdAllocator.findAvailable',
                tokenEnd: 103,
                tokenStart: 94,
            }),
        ]),
        decisionIdentity: 'hls-stream-id-allocator-unavailable-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_HLS_STREAM_ID_ALLOCATOR_UNAVAILABLE_MARKER,
        owner: 'server-media-delivery',
        sourcePath: 'src/model/service/stream/manager/HlsStreamIdAllocator.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'throw',
                functionName: 'HlsStreamIdAllocator.findAvailable',
                tokenEnd: 96,
                tokenStart: 95,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'HlsStreamIdAllocator.findAvailable',
                tokenEnd: 97,
                tokenStart: 96,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'HlsStreamIdAllocator.findAvailable',
                tokenEnd: 98,
                tokenStart: 97,
            }),
            Object.freeze({
                code: '\'HLSStreamIdUnavailable\'',
                functionName: 'HlsStreamIdAllocator.findAvailable',
                tokenEnd: 100,
                tokenStart: 99,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/media-delivery/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '8a14ad383ad59694b2b9a25b14570c9cb158ef80a1c47803fb2f9b1d6781e1b0', name: 'RecordedStreamBaseModel.observeManagedProcessTerminal' }),
            Object.freeze({ codeSha256: '06a19763fea06b295b221364556004d9398edfe8c8c1f1c8282d49b4415dae4c', name: 'RecordedStreamBaseModel.start' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ return ; }',
                functionName: 'RecordedStreamBaseModel.observeManagedProcessTerminal',
                tokenEnd: 58,
                tokenStart: 54,
            }),
        ]),
        decisionIdentity: 'recorded-stream-base-onterminal-reentry-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_RECORDED_STREAM_BASE_ONTERMINAL_REENTRY_MARKER,
        owner: 'server-media-delivery',
        sourcePath: 'src/model/service/stream/base/RecordedStreamBaseModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'RecordedStreamBaseModel.observeManagedProcessTerminal',
                tokenEnd: 57,
                tokenStart: 55,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/media-delivery/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: '71e819f72dcb90f95be695c114df989c165ea846a8270359a826b9ec60d816c5', name: 'StreamManageModel.startRecorded' }),
            Object.freeze({ codeSha256: '3338f726560921160f5ecb4da175d62982ac8ecb84cf57da0d9a70042054ea69', name: 'StreamManageModel.startInternal' }),
            Object.freeze({ codeSha256: 'f75db449b58f471fe36682e6e658718ebb5bbdfee7e2b70bf458071694af57da', name: 'StreamManageModel.createActiveStream' }),
            Object.freeze({ codeSha256: 'f875cb885d2814ca938cef81b3b0eaa1ea64247b835a230c1809244517f13501', name: 'StreamManageModel.attachStream' }),
            Object.freeze({ codeSha256: 'ec3ec5440b329ff38a8035780559e5a24756127f84241e2623f12ec224f47f19', name: 'StreamManageModel.runStart' }),
            Object.freeze({ codeSha256: 'b99db1af0f4c4161d6c33536e22e4c6ca0b0635b055c48e3efca3bf1f73bf6b0', name: 'StreamManageModel.rejectStart' }),
            Object.freeze({ codeSha256: 'f9e05c314ea58a577b8411fd095ced8c3790b6bf42b44ebef198313a25ceb80e', name: 'StreamManageModel.finalizeActive' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ throw new Error ( \'RecordedStreamStartNotAdopted\' ) ; }',
                functionName: 'StreamManageModel.startRecorded',
                tokenEnd: 367,
                tokenStart: 358,
            }),
        ]),
        decisionIdentity: 'stream-manage-startrecorded-notadopted-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_STREAM_MANAGE_STARTRECORDED_NOTADOPTED_MARKER,
        owner: 'server-media-delivery',
        sourcePath: 'src/model/service/stream/manager/StreamManageModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'throw',
                functionName: 'StreamManageModel.startRecorded',
                tokenEnd: 360,
                tokenStart: 359,
            }),
            Object.freeze({
                code: 'new',
                functionName: 'StreamManageModel.startRecorded',
                tokenEnd: 361,
                tokenStart: 360,
            }),
            Object.freeze({
                code: 'Error',
                functionName: 'StreamManageModel.startRecorded',
                tokenEnd: 362,
                tokenStart: 361,
            }),
            Object.freeze({
                code: '\'RecordedStreamStartNotAdopted\'',
                functionName: 'StreamManageModel.startRecorded',
                tokenEnd: 364,
                tokenStart: 363,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze([
            'test/server/media-delivery/recorded-delivery.spec.test.ts',
            'test/server/media-delivery/recorded-delivery.test.ts',
        ]),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'c65458a3c32e8834b576116709cfb2d83a6a9554c5e01ed48adac1fd13d021a0', name: 'TailStream.checkFile' }),
            Object.freeze({ codeSha256: '58934b26483836057af89dfac3cbdd36989839dfd6984a8837c4b63fb6f35901', name: 'TailStream.dispose' }),
            Object.freeze({ codeSha256: '1436e146c80e2149e6c60ea1786fd777c352a9578d493dfb7687d94e3e13bcf3', name: 'TailStream.clearTimers' }),
            Object.freeze({ codeSha256: 'b89ebc7ab09d553e05aca3e212e0bbe416540b8c295dd1d9680f3f23079431da', name: 'TailStream._destroy' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'TailStream.checkFile',
                tokenEnd: 48,
                tokenStart: 46,
            }),
        ]),
        decisionIdentity: 'tail-stream-checkfile-timer-isclosed-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_TAIL_STREAM_CHECKFILE_TIMER_ISCLOSED_MARKER,
        owner: 'server-media-delivery',
        sourcePath: 'src/lib/TailStream.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'TailStream.checkFile',
                tokenEnd: 48,
                tokenStart: 46,
            }),
        ]),
    }),
    Object.freeze({
        alternativeOwnerEntries: Object.freeze(['test/server/media-delivery/**/*.test.ts']),
        boundFunctions: Object.freeze([
            Object.freeze({ codeSha256: 'f4e285b7a54146a167aaff6939ea0bb13f75a3cf32c9e33d3b7abbd11b58715b', name: 'StreamBaseModel.startCheckStreamEnable' }),
        ]),
        branchAnchors: Object.freeze([
            Object.freeze({
                code: '{ return ; }',
                functionName: 'StreamBaseModel.startCheckStreamEnable',
                tokenEnd: 37,
                tokenStart: 33,
            }),
        ]),
        decisionIdentity: 'stream-base-startcheckstreamenable-nonhls-guard-authorization',
        markerIdentifier: COVERAGE_EXCLUSION_STREAM_BASE_STARTCHECK_NONHLS_GUARD_MARKER,
        owner: 'server-media-delivery',
        sourcePath: 'src/model/service/stream/base/StreamBaseModel.ts',
        statementAnchors: Object.freeze([
            Object.freeze({
                code: 'return ;',
                functionName: 'StreamBaseModel.startCheckStreamEnable',
                tokenEnd: 36,
                tokenStart: 34,
            }),
        ]),
    }),
]);

const COVERAGE_EXCLUSION_AUTHORIZATION_BY_MARKER = Object.freeze(
    new Map(COVERAGE_EXCLUSION_AUTHORIZATIONS.map(entry => [entry.markerIdentifier, entry])),
);

function isUniqueSymbolType(typeNode) {
    return (
        typeNode !== undefined &&
        typeNode.kind === ts.SyntaxKind.TypeOperator &&
        typeNode.operator === ts.SyntaxKind.UniqueKeyword &&
        typeNode.type !== undefined &&
        typeNode.type.kind === ts.SyntaxKind.SymbolKeyword
    );
}

function isAuthorizedAmbientMarkerDeclaration(statement, sourceFile) {
    if (!ts.isVariableStatement(statement)) {
        return null;
    }
    const hasDeclare = (statement.modifiers ?? []).some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);
    if (!hasDeclare) {
        return null;
    }
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
        return null;
    }
    if (statement.declarationList.declarations.length !== 1) {
        return null;
    }
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || declaration.initializer !== undefined) {
        return null;
    }
    if (!isUniqueSymbolType(declaration.type)) {
        return null;
    }
    return declaration.name.text;
}

/**
 * Reads product TypeScript source and returns either `null` (no coverage-exclusion marker) or a
 * frozen authorization entry for this source path. Fail-closed as `malformed-coverage-exclusion` for
 * unknown markers, wrong shape/path/placement, or duplicates.
 * Never consults compiled JS, source maps, raw V8, or shards to decide authorization validity.
 */
function parseSourceCoverageAuthorization(sourceText, sourcePath) {
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    // Textual scan catches non-declaration uses of the reserved marker namespace.
    const claimedIdentifiers = new Set();
    for (const match of sourceText.matchAll(/\b__EPGSTATION_COVERAGE_EXCLUSION_[A-Za-z0-9_]+\b/gu)) {
        claimedIdentifiers.add(match[0]);
    }

    const markerStatements = [];
    for (const statement of sourceFile.statements) {
        const identifier = isAuthorizedAmbientMarkerDeclaration(statement, sourceFile);
        if (identifier === null) {
            // Any non-conforming declaration that still uses the reserved prefix fails closed below
            // via the textual identifier set when it is not claimed by a valid marker statement.
            continue;
        }
        if (!identifier.startsWith(COVERAGE_EXCLUSION_MARKER_PREFIX)) {
            continue;
        }
        markerStatements.push({ identifier, statement });
    }

    if (claimedIdentifiers.size === 0 && markerStatements.length === 0) {
        return null;
    }

    for (const identifier of claimedIdentifiers) {
        if (!COVERAGE_EXCLUSION_AUTHORIZATION_BY_MARKER.has(identifier)) {
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" declares unknown coverage exclusion marker "${identifier}"`,
            );
        }
    }

    if (markerStatements.length === 0) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" mentions a coverage exclusion marker without a valid final ambient declare const unique symbol declaration`,
        );
    }

    if (markerStatements.length !== 1) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" declares ${markerStatements.length} coverage exclusion markers; exactly one is authorized`,
        );
    }

    const { identifier, statement } = markerStatements[0];
    const authorization = COVERAGE_EXCLUSION_AUTHORIZATION_BY_MARKER.get(identifier);
    if (authorization === undefined) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" declares unknown coverage exclusion marker "${identifier}"`,
        );
    }

    if (authorization.sourcePath !== sourcePath) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" hosts authorized marker "${identifier}" which is bound to "${authorization.sourcePath}"`,
        );
    }

    const lastStatement = sourceFile.statements[sourceFile.statements.length - 1];
    if (lastStatement !== statement) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" coverage exclusion marker must be the final AST statement`,
        );
    }

    // Trailing content after the marker statement (other than whitespace/EOF) is forbidden.
    const trailing = sourceText.slice(statement.end);
    if (trailing.trim().length !== 0) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" coverage exclusion marker must be the final AST statement`,
        );
    }

    // Re-validate exact shape (declare const / unique symbol / no initializer) via the helper result.
    const shapeId = isAuthorizedAmbientMarkerDeclaration(statement, sourceFile);
    if (shapeId !== identifier) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" coverage exclusion marker must be \`declare const ${identifier}: unique symbol\``,
        );
    }

    return authorization;
}

/**
 * Loads and caches coverage-exclusion authorization for `sourcePath` under `repositoryRoot` for one
 * discovery pass. Missing source files fail closed -- a mapped path under `src/` ending in `.ts`
 * without readable bytes cannot authorize exclusions.
 */
function loadSourceCoverageAuthorization(repositoryRoot, sourcePath, cache) {
    if (cache.has(sourcePath)) {
        return cache.get(sourcePath);
    }
    const absoluteSourcePath = join(repositoryRoot, ...sourcePath.split('/'));
    let sourceText;
    try {
        sourceText = readFileSync(absoluteSourcePath, 'utf8');
    } catch (error) {
        fail(
            'malformed-coverage-exclusion',
            `"${sourcePath}" cannot be read for coverage exclusion declarations: ${error.message}`,
        );
    }
    const authorization = parseSourceCoverageAuthorization(sourceText, sourcePath);
    const loaded = authorization === null ? null : { authorization, sourceText };
    cache.set(sourcePath, loaded);
    return loaded;
}

/**
 * Function-unit binding of coverage exclusion approvals.
 *
 * An approval binds to the excluded code, the function unit that contains it, and the function units it
 * records as its premise -- never to a position in the file or to the whole file's bytes. A function unit is a
 * class member (method, constructor, accessor, property with an initializer, static block) or a function /
 * variable declaration directly in the file; a closure nested in a unit belongs to that unit. A unit's code is
 * its token sequence: the leaves of the TypeScript AST (`getChildren`), without comments (JSDoc nodes
 * included), whitespace and line breaks, and without a comma directly before a closing bracket (the trailing
 * comma a formatter adds or removes with a line break). The fingerprint of a unit is the SHA-256 of that
 * sequence's JSON.
 */
const CLOSING_BRACKET_TOKENS = new Set([')', ']', '}', '>']);

function isJsDocNode(node) {
    return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** The token sequence of `node`: `{ text, start }` for each AST leaf, in source order. */
function collectUnitTokens(node, sourceFile) {
    const leaves = [];
    const visit = current => {
        if (isJsDocNode(current)) {
            return;
        }
        const children = current.getChildren(sourceFile);
        if (children.length === 0) {
            const text = current.getText(sourceFile);
            if (text.length > 0) {
                leaves.push({ start: current.getStart(sourceFile), text });
            }
            return;
        }
        for (const child of children) {
            visit(child);
        }
    };
    visit(node);
    return leaves.filter((token, index) => !(token.text === ',' && CLOSING_BRACKET_TOKENS.has(leaves[index + 1]?.text)));
}

function classMemberUnitName(member, sourceFile) {
    const className = member.parent.name === undefined ? '<anonymous-class>' : member.parent.name.text;
    const isStatic = (ts.getModifiers(member) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword);
    let accessor = '';
    if (ts.isGetAccessorDeclaration(member)) {
        accessor = 'get ';
    } else if (ts.isSetAccessorDeclaration(member)) {
        accessor = 'set ';
    }
    const memberName = ts.isConstructorDeclaration(member)
        ? 'constructor'
        : ts.isClassStaticBlockDeclaration(member)
          ? 'static block'
          : member.name.getText(sourceFile);
    return `${isStatic ? 'static ' : ''}${accessor}${className}.${memberName}`;
}

function isClassMemberUnit(member) {
    if (ts.isClassStaticBlockDeclaration(member)) {
        return true;
    }
    if (ts.isPropertyDeclaration(member)) {
        return member.initializer !== undefined;
    }
    return (
        (ts.isMethodDeclaration(member) ||
            ts.isConstructorDeclaration(member) ||
            ts.isGetAccessorDeclaration(member) ||
            ts.isSetAccessorDeclaration(member)) &&
        member.body !== undefined
    );
}

/** Every function unit of `sourceFile`, in source order: `{ name, start, end, tokens, codeSha256 }`. */
function collectFunctionUnits(sourceFile) {
    const units = [];
    const add = (name, node) => {
        const tokens = collectUnitTokens(node, sourceFile);
        units.push({
            codeSha256: sha256Hex(JSON.stringify(tokens.map(token => token.text))),
            end: node.end,
            name,
            start: node.getStart(sourceFile),
            tokens,
        });
    };
    const visit = node => {
        if (ts.isClassElement(node) && ts.isClassLike(node.parent)) {
            if (isClassMemberUnit(node)) {
                add(classMemberUnitName(node, sourceFile), node);
            }
            return;
        }
        if (node.parent === sourceFile) {
            if (ts.isFunctionDeclaration(node)) {
                if (node.body !== undefined) {
                    add(`function ${node.name === undefined ? 'default' : node.name.text}`, node);
                }
                return;
            }
            if (ts.isVariableStatement(node)) {
                const flags = node.declarationList.flags;
                const keyword = (flags & ts.NodeFlags.Const) !== 0 ? 'const' : (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
                for (const declaration of node.declarationList.declarations) {
                    if (declaration.initializer !== undefined) {
                        add(`${keyword} ${declaration.name.getText(sourceFile)}`, declaration);
                    }
                }
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return units;
}

/** Index of the first token whose start is at or after `position` (`tokens.length` when none). */
function firstTokenIndexAtOrAfter(tokens, position) {
    let low = 0;
    let high = tokens.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (tokens[middle].start < position) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function sourcePositionOf(sourceFile, location) {
    const lineStarts = sourceFile.getLineStarts();
    if (location.line < 1 || location.line > lineStarts.length) {
        return null;
    }
    return lineStarts[location.line - 1] + location.column;
}

function unitContaining(units, position) {
    let low = 0;
    let high = units.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (position < units[middle].start) {
            high = middle - 1;
        } else if (position >= units[middle].end) {
            low = middle + 1;
        } else {
            return units[middle];
        }
    }
    return null;
}

/**
 * Locates one basis entry in the function units: the unit holding the entry's start, and the token range
 * `[first token at or after the start, first token at or after the end)` in that unit's token sequence.
 * `null` for an entry outside every unit.
 */
function locateBasisEntry(units, sourceFile, entry) {
    const start = sourcePositionOf(sourceFile, entry.start);
    const end = sourcePositionOf(sourceFile, entry.end);
    if (start === null || end === null) {
        return null;
    }
    const unit = unitContaining(units, start);
    if (unit === null) {
        return null;
    }
    const tokenStart = firstTokenIndexAtOrAfter(unit.tokens, start);
    const tokenEnd = firstTokenIndexAtOrAfter(unit.tokens, end);
    return {
        code: unit.tokens
            .slice(tokenStart, tokenEnd)
            .map(token => token.text)
            .join(' '),
        functionName: unit.name,
        key: `${unit.name}|${tokenStart}|${tokenEnd}`,
        tokenEnd,
        tokenStart,
    };
}

/**
 * Describes where each basis entry sits in the source's function units, and each unit's fingerprint.
 * `statements[i]` / `branches[i]` is `{ functionName, tokenStart, tokenEnd, code }` for the i-th entry of
 * the matching input list, or `null` for an entry outside every function unit. This is the same computation
 * `applyCoverageExclusions` resolves approvals with, so an approval's anchors are derived with it.
 */
export function describeFunctionUnitBinding({ sourcePath, sourceText, statementEntries, branchEntries }) {
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const units = collectFunctionUnits(sourceFile);
    const describeAll = entries =>
        entries.map(entry => {
            const located = locateBasisEntry(units, sourceFile, entry);
            return located === null
                ? null
                : {
                      code: located.code,
                      functionName: located.functionName,
                      tokenEnd: located.tokenEnd,
                      tokenStart: located.tokenStart,
                  };
        });
    return {
        branches: describeAll(branchEntries),
        statements: describeAll(statementEntries),
        units: units.map(unit => ({
            codeSha256: unit.codeSha256,
            name: unit.name,
            tokenCount: unit.tokens.length,
            tokens: unit.tokens.map(token => token.text),
        })),
    };
}

function verifyBoundFunctions(sourcePath, authorization, units) {
    const names = new Set();
    for (const bound of authorization.boundFunctions) {
        if (names.has(bound.name)) {
            fail('malformed-coverage-exclusion', `"${sourcePath}" binds function unit "${bound.name}" more than once`);
        }
        names.add(bound.name);
        const matches = units.filter(unit => unit.name === bound.name);
        if (matches.length !== 1) {
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" function unit "${bound.name}" is bound by an approval but ${matches.length} units have that name; exactly one is required`,
            );
        }
        if (matches[0].codeSha256 !== bound.codeSha256) {
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" function unit "${bound.name}" changed since it was approved: approved codeSha256 ${bound.codeSha256}, current codeSha256 ${matches[0].codeSha256}`,
            );
        }
    }
    return names;
}

function verifyAnchorTable(sourcePath, kind, anchors, boundNames, units) {
    for (const anchor of anchors) {
        const label = `${kind} anchor ${anchor.functionName}[${anchor.tokenStart},${anchor.tokenEnd})`;
        if (!boundNames.has(anchor.functionName)) {
            fail('malformed-coverage-exclusion', `"${sourcePath}" ${label} names a function unit that is not bound`);
        }
        if (!(anchor.tokenStart < anchor.tokenEnd)) {
            fail('malformed-coverage-exclusion', `"${sourcePath}" ${label} has an empty token range`);
        }
        const unit = units.find(candidate => candidate.name === anchor.functionName);
        const code = unit.tokens
            .slice(anchor.tokenStart, anchor.tokenEnd)
            .map(token => token.text)
            .join(' ');
        if (code !== anchor.code) {
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" ${label} records code ${JSON.stringify(anchor.code)} but the unit's tokens there are ${JSON.stringify(code)}`,
            );
        }
    }
}

function removeAnchoredEntries(sourcePath, kind, anchors, entries, locations) {
    const removed = new Set();
    for (const anchor of anchors) {
        const key = `${anchor.functionName}|${anchor.tokenStart}|${anchor.tokenEnd}`;
        const matched = [];
        locations.forEach((location, index) => {
            if (location !== null && location.key === key) {
                matched.push(index);
            }
        });
        if (matched.length !== 1) {
            const candidates = locations
                .filter(location => location !== null && location.functionName === anchor.functionName)
                .slice(0, 8)
                .map(location => `${location.key} ${JSON.stringify(location.code)}`);
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" ${kind} anchor ${anchor.functionName}[${anchor.tokenStart},${anchor.tokenEnd}) ${JSON.stringify(anchor.code)} resolves to ${matched.length} basis entries; exactly one is required (entries in that unit: ${candidates.join('; ') || 'none'})`,
            );
        }
        if (removed.has(matched[0])) {
            fail(
                'malformed-coverage-exclusion',
                `"${sourcePath}" ${kind} anchor ${anchor.functionName}[${anchor.tokenStart},${anchor.tokenEnd}) resolves to a basis entry another anchor already removes`,
            );
        }
        removed.add(matched[0]);
    }
    return entries.filter((_entry, index) => !removed.has(index));
}

/**
 * Removes the basis entries a function-unit-bound approval authorizes. Fail-closed
 * (`malformed-coverage-exclusion`) unless every bound unit exists exactly once with the approved fingerprint,
 * every anchor matches its unit's tokens, and every anchor resolves to exactly one basis entry of its own
 * kind. Statement and branch anchors resolve independently. Returns the remaining `{ statementEntries,
 * branchEntries }`; an approval's anchors never remove more entries than it has anchors.
 */
export function applyCoverageExclusions({ sourcePath, sourceText, authorization, statementEntries, branchEntries }) {
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const units = collectFunctionUnits(sourceFile);
    const boundNames = verifyBoundFunctions(sourcePath, authorization, units);
    verifyAnchorTable(sourcePath, 'statement', authorization.statementAnchors, boundNames, units);
    verifyAnchorTable(sourcePath, 'branch', authorization.branchAnchors, boundNames, units);
    const locate = entries => entries.map(entry => locateBasisEntry(units, sourceFile, entry));
    return {
        branchEntries: removeAnchoredEntries(
            sourcePath,
            'branch',
            authorization.branchAnchors,
            branchEntries,
            locate(branchEntries),
        ),
        statementEntries: removeAnchoredEntries(
            sourcePath,
            'statement',
            authorization.statementAnchors,
            statementEntries,
            locate(statementEntries),
        ),
    };
}

/**
 * Statement-basis syntax-only rule (see module doc): the six bare structural keywords that,
 * standing alone (or alongside only punctuation), never make a statement span executable -- each is a
 * control-flow clause INTRODUCER whose own body/consequent is always a SEPARATE, already-covered AST
 * span (`try`'s block, `catch`'s clause block, `finally`'s block, `else`'s statement, a `switch`
 * `default:` label, `do`'s loop body); the bare keyword token itself never executes anything on its own.
 */
const STATEMENT_NON_EXECUTABLE_KEYWORDS = new Set([
    ts.SyntaxKind.TryKeyword,
    ts.SyntaxKind.CatchKeyword,
    ts.SyntaxKind.FinallyKeyword,
    ts.SyntaxKind.ElseKeyword,
    ts.SyntaxKind.DefaultKeyword,
    ts.SyntaxKind.DoKeyword,
]);

/**
 * True iff `kind` can never by itself make a statement span executable: every punctuation `SyntaxKind`
 * (`FirstPunctuation`..`LastPunctuation` -- includes `.`/`?.` and `=>`, both purely structural without an
 * operand of their own) or one of `STATEMENT_NON_EXECUTABLE_KEYWORDS` above.
 */
function isNonExecutableStatementToken(kind) {
    return (
        (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation) ||
        STATEMENT_NON_EXECUTABLE_KEYWORDS.has(kind)
    );
}

/**
 * Statement-basis syntax-only rule (see module doc): classifies one candidate statement-basis
 * span `[offset, nextOffset)` of `jsSource` with a single `ts.createScanner` pass (`skipTrivia: true`, so
 * whitespace and comments are silently skipped -- never regex-matched over raw text, and never treated as
 * tokens). `scanner` is reused across every span of one script (a fresh `setText` per call resets its
 * state; cheaper than constructing a scanner per span).
 *
 * Returns `{ omit: true, queryOffset: null }` when the span contains zero non-trivia tokens (whitespace-
 * /comment-only) or when every non-trivia token it contains is `isNonExecutableStatementToken` (punctuation
 * and/or a bare structural keyword) -- this span has no execution semantics of its own and must never
 * become a statement basis entry (rule 2). Otherwise returns `{ omit: false, queryOffset }`, where
 * `queryOffset` is the start offset of the span's OWN first non-trivia token -- i.e. the offset of the
 * first non-whitespace, non-comment character in the span (rule 1) -- for the caller to query the raw
 * count at, instead of the span's raw start offset.
 */
function classifyStatementSpan(scanner, jsSource, offset, nextOffset) {
    scanner.setText(jsSource, offset, nextOffset - offset);
    let queryOffset = null;
    let hasExecutableToken = false;
    let kind = scanner.scan();
    while (kind !== ts.SyntaxKind.EndOfFileToken) {
        if (queryOffset === null) {
            queryOffset = scanner.getTokenStart();
        }
        if (!isNonExecutableStatementToken(kind)) {
            hasExecutableToken = true;
        }
        kind = scanner.scan();
    }
    return hasExecutableToken ? { omit: false, queryOffset } : { omit: true, queryOffset: null };
}

/**
 * Builds this script's entire statement location *basis* directly and only from its
 * own compiled JS + source map, never from a shard's own raw V8 ranges, array index, execution order, or
 * shard number -- one span per `mappingPoints` entry, running from that point's own generated offset to
 * the next mapping point's offset (or `compiledBodyEndOffset(jsSource)` for the last point). This makes
 * the *set* of statement locations `discoverCompiledSnapshotCoverage` reports for one compiled script
 * identical across every shard of the same candidate tree, unconditionally -- this is not gated on whether a shard's own raw ranges
 * already "represent" a point (a whole-script `[0, scriptLength)` range would make such a gate inert on
 * every real V8 dump). `recordRangeSets` (one flat raw-range array per raw script
 * record for this path -- see `countForSpanStart` / `countForSpanStartAcrossRecords`) decides only each
 * span's `count`; it is never a basis member itself. Each span is converted through the same
 * `convertRange` a raw range uses, so a span with no representable source location is silently omitted
 * exactly like a real range would be (`convertRange`'s own `omit` contract), never fabricated.
 * Statement population is complete for the compiled body EXCEPT for spans `classifyStatementSpan` (see
 * above) finds syntax-only -- no token other than whitespace, a comment, punctuation, or a bare structural
 * keyword (`try`/`catch`/`finally`/`else`/`default`/`do`) -- which are omitted outright (statement-basis
 * syntax-only rule, module doc); a kept span's raw count is queried at its own first non-trivia
 * token's offset, never the span's raw start (module doc, rule 1). Authorized ID filtering is applied by
 * `applyCoverageExclusions` after this function returns, over whatever this function already
 * kept. Branch basis is never consulted here.
 */
function buildStatementBasisEntries(
    mappingPoints,
    lineStartOffsets,
    jsSource,
    recordRangeSets,
    reportFunctionGranularityExclusion,
) {
    const bodyEndOffset = compiledBodyEndOffset(jsSource);
    const guardRanges = findNamespaceMergeGuardRanges(jsSource);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true, ts.LanguageVariant.Standard);
    const entries = [];
    for (let index = 0; index < mappingPoints.length; index += 1) {
        const offset = mappingPointOffset(mappingPoints[index], lineStartOffsets);
        if (offset === null) {
            continue;
        }
        const nextPoint = mappingPoints[index + 1];
        const nextOffset = nextPoint === undefined ? bodyEndOffset : mappingPointOffset(nextPoint, lineStartOffsets);
        if (nextOffset === null || nextOffset <= offset) {
            continue;
        }
        // Namespace-merge guard: a span running entirely inside a namespace-merge
        // guard's `||`-onward text (e.g. the assignment target identifier and trailing `= {}));`) is
        // never a real, reachable statement -- see `findNamespaceMergeGuardRanges` above.
        if (isWithinNamespaceMergeGuard(offset, nextOffset, guardRanges)) {
            continue;
        }
        // Statement-basis syntax-only rule (module doc, rules 1 + 2): a span with no
        // executable token (whitespace/comment/punctuation/bare structural keyword only) is never a
        // statement -- omitted, not counted. A kept span's raw count is queried at its own first
        // non-trivia token's offset, never the span's raw (mapping-point) start.
        const classification = classifyStatementSpan(scanner, jsSource, offset, nextOffset);
        if (classification.omit) {
            continue;
        }
        const converted = convertRange(
            {
                count: countForSpanStartAcrossRecords(
                    classification.queryOffset,
                    recordRangeSets,
                    reportFunctionGranularityExclusion,
                ),
                endOffset: nextOffset,
                startOffset: offset,
            },
            mappingPoints,
            lineStartOffsets,
        );
        if (!converted.omit && converted.entry !== null) {
            entries.push(converted.entry);
        }
    }
    return entries;
}

/**
 * Namespace-merge guard: a TypeScript class+namespace merge emits `(function (X) { ... })(X || (X = {}));` --
 * module evaluation order always binds `X` to the class value before this IIFE runs, so the `||`
 * right operand `(X = {})` is provably unreachable by construction, for any source-level test. Left in
 * the statement/branch population, this residue is a permanent fail-closed rejection under a 100%
 * gate. `NAMESPACE_MERGE_GUARD_PATTERN` anchors on the exact compiled shape authorized here --
 * `})(` (the IIFE's own closing paren immediately opening its argument list) followed by one identifier,
 * `||`, and a parenthesized assignment of that *same* identifier (backreference `\1`) to an empty object
 * literal, then the call's closing `)` and statement `;` -- so it never matches a product-source `||`
 * that merely happens to assign an empty object (not the IIFE's sole argument), an identifier mismatch,
 * or a non-empty right-hand object. This is a purely textual, static rule over the compiled JS -- never
 * a raw V8 range, shard, or source map -- so the excluded span set is identical for every shard of the
 * same candidate tree, exactly like the statement/branch basis it trims.
 */
const NAMESPACE_MERGE_GUARD_PATTERN = /\}\)\(([A-Za-z_$][\w$]*)(\s*)\|\|\s*\(\s*\1\s*=\s*\{\s*\}\s*\)\s*\)\s*;/g;

/**
 * Every namespace-merge guard `{ guardStart, matchEnd }` region `NAMESPACE_MERGE_GUARD_PATTERN` finds in
 * `jsSource` -- `guardStart` is the compiled byte offset of the guard's own `||` token ("`||`
 * 以降"), `matchEnd` the offset immediately after the matched construct's closing `;`. Both
 * `buildStatementBasisEntries` and `buildBranchBasisEntries` below exclude a span iff it falls entirely
 * within `[guardStart, matchEnd)` of some returned region -- the same bound serves both: a branch
 * outcome's own AST span (`(X = {})`) is always a strict subset of the wider statement span that also
 * carries the guard's trailing `));`.
 */
function findNamespaceMergeGuardRanges(jsSource) {
    const ranges = [];
    for (const match of jsSource.matchAll(NAMESPACE_MERGE_GUARD_PATTERN)) {
        const guardStart = match.index + 3 + match[1].length + match[2].length; // 3 === '})('.length
        const matchEnd = match.index + match[0].length;
        ranges.push(Object.freeze({ guardStart, matchEnd }));
    }
    return ranges;
}

/** True iff `[startOffset, endOffset)` falls entirely inside some region of `guardRanges` (see `findNamespaceMergeGuardRanges`). */
function isWithinNamespaceMergeGuard(startOffset, endOffset, guardRanges) {
    return guardRanges.some(range => startOffset >= range.guardStart && endOffset <= range.matchEnd);
}

/**
 * The branch-outcome AST node kinds authorized here -- an `IfStatement`'s
 * `thenStatement`/`elseStatement` (only when syntactically present; no synthetic else arm is ever
 * fabricated), a `ConditionalExpression`'s `whenTrue`/`whenFalse`, a logical `BinaryExpression`
 * (`&&`/`||`/`??`)'s right operand, and each `switch`'s `CaseClause`/`DefaultClause`. Visits every node
 * in `sourceFile` exactly once (`ts.forEachChild` gives no built-in deep traversal), so a nested branch
 * construct -- an `if` inside a `case` body, a ternary inside a logical operator's right operand, an
 * "else if" chain's own nested `IfStatement` -- is found independently of whichever outer construct
 * encloses it, never skipped once its enclosing node has already contributed its own span. Extending
 * this construct set requires updating this authorized-algorithm step 3 condition.
 *
 * A parameter's own `default` initializer is deliberately NOT a branch-outcome span (a
 * known, permanent V8 limitation, not an oversight): V8 does not instrument a default-parameter
 * initializer with its own range at all -- confirmed with a plain-node probe (`h(a, b = 5)` called as
 * `h(1, 2)`, so `b = 5` never runs) -- so under this module's own single count rule (see
 * `countForSpanStart`) a query at the initializer's own position has no narrower range of its own to
 * fall back on and silently inherits the enclosing FUNCTION's own call count instead, regardless of
 * whether that specific default actually fired. Counting that as a branch outcome would claim
 * per-invocation evidence V8 never recorded. The initializer's *statement* span (the parameter list text
 * itself, which the compiled function body does execute on every call) is unaffected and stays in the
 * statement basis as before -- only the branch-outcome entry is removed.
 */
function collectBranchSpanNodes(sourceFile) {
    const spans = [];
    function visit(node) {
        if (ts.isIfStatement(node)) {
            spans.push(node.thenStatement);
            if (node.elseStatement !== undefined) {
                spans.push(node.elseStatement);
            }
        } else if (ts.isConditionalExpression(node)) {
            spans.push(node.whenTrue, node.whenFalse);
        } else if (ts.isBinaryExpression(node)) {
            const operatorKind = node.operatorToken.kind;
            if (
                operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
                operatorKind === ts.SyntaxKind.BarBarToken ||
                operatorKind === ts.SyntaxKind.QuestionQuestionToken
            ) {
                spans.push(node.right);
            }
        } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
            spans.push(node);
        }
        ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
    return spans;
}

/**
 * Syntax-only parse of this script's own compiled JS (`ts.createSourceFile`, type-checking never
 * invoked) for `buildBranchBasisEntries` below. Fails closed as `branch-basis-parse-error` on a syntax
 * diagnostic instead of silently degrading to an empty branch basis (a quiet degradation to an empty
 * basis is prohibited) -- a real `tsc`-emitted script is never expected to fail this parse, so a
 * diagnostic here means the compiled tree itself is broken, not merely unexecuted. `parseDiagnostics` is
 * an internal (untyped) property of the returned `SourceFile`, not part of the package's public API
 * surface, but is the only way to get syntax diagnostics without the much heavier `ts.createProgram`.
 */
function parseCompiledSourceForBranchBasis(jsSource, relativeScriptPath, root) {
    const sourceFile = ts.createSourceFile(
        'compiled-snapshot.js',
        jsSource,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.JS,
    );
    const diagnostics = sourceFile.parseDiagnostics ?? [];
    if (diagnostics.length > 0) {
        fail(
            'branch-basis-parse-error',
            `"${relativeScriptPath}" in snapshot root "${root}" failed static parse for its branch outcome basis: ${diagnostics[0].messageText}`,
        );
    }
    return sourceFile;
}

/**
 * Builds this script's entire
 * branch-outcome location *basis* directly and only from its own compiled JS syntax tree --
 * `collectBranchSpanNodes`'s authorized construct set -- never from a shard's own raw V8 ranges,
 * `isBlockCoverage` flag, or execution order. This makes the *set* of branch locations
 * `discoverCompiledSnapshotCoverage` reports for one compiled script identical across every shard of
 * the same candidate tree, exactly like the statement basis above.
 *
 * A branch outcome's count is looked up against `recordRangeSets`, the EXACT SAME per-record candidate
 * range sets `buildStatementBasisEntries` builds and queries for statements (every range of every function, `ranges[0]` and
 * `isBlockCoverage === false` functions included -- see `countForSpanStart`'s own doc for why excluding
 * either gives wrong counts, confirmed with plain-node V8 probes: an always-taken branch
 * has no range of its own and must inherit its innermost enclosing range's count, and dropping an
 * uncalled function's own zero-count range lets a span inside it fall through to an unrelated, wider,
 * possibly-positive range instead). Sharing the exact same candidate set and the exact same
 * `countForSpanStart` call as the statement side is also what makes statement/branch counts at an
 * identically-keyed position agree by construction (so no separate divergence invariant is needed at this function's call site).
 *
 * Each span is converted through the same `convertRange` a raw range uses, so a span with no
 * representable source location is silently omitted exactly like a real range would be (`convertRange`'s
 * own `omit` contract), never fabricated, and a span whose end *does* resolve but has no representable
 * location at all fails closed as `no-representable-source-location`, same as a raw range would.
 */
function buildBranchBasisEntries(
    jsSource,
    mappingPoints,
    lineStartOffsets,
    recordRangeSets,
    relativeScriptPath,
    root,
    reportFunctionGranularityExclusion,
) {
    const sourceFile = parseCompiledSourceForBranchBasis(jsSource, relativeScriptPath, root);
    const guardRanges = findNamespaceMergeGuardRanges(jsSource);
    const entries = [];
    for (const spanNode of collectBranchSpanNodes(sourceFile)) {
        const startOffset = spanNode.getStart(sourceFile);
        const endOffset = spanNode.getEnd();
        // Namespace-merge guard: the `||` right operand of a namespace-merge guard
        // (`X || (X = {})`) is a branch-outcome candidate by AST shape alone, but is provably
        // unreachable by construction -- see `findNamespaceMergeGuardRanges` above.
        if (isWithinNamespaceMergeGuard(startOffset, endOffset, guardRanges)) {
            continue;
        }
        const converted = convertRange(
            {
                count: countForSpanStartAcrossRecords(startOffset, recordRangeSets, reportFunctionGranularityExclusion),
                endOffset,
                startOffset,
            },
            mappingPoints,
            lineStartOffsets,
        );
        if (converted.omit) {
            continue;
        }
        if (converted.entry === null) {
            fail(
                'no-representable-source-location',
                `"${relativeScriptPath}" in snapshot root "${root}" has a branch-outcome span [${startOffset}, ${endOffset}) with no representable source location`,
            );
        }
        entries.push(converted.entry);
    }
    return entries;
}

/** Repository-relative `src/**\/*.ts` path for `absoluteSourcePath`, or `null` if it is not one (outside `src/`, not `.ts`, or a `.d.ts`). */
function repoRelativeSrcPath(absoluteSourcePath, repositoryRoot) {
    const rel = normalized(relative(repositoryRoot, absoluteSourcePath));
    if (rel.startsWith('../') || isAbsolute(rel)) {
        return null;
    }
    if (!rel.startsWith('src/') || !rel.endsWith('.ts') || rel.endsWith('.d.ts')) {
        return null;
    }
    return rel;
}

/**
 * Lifecycle-safe isolated-runtime identity association.
 *
 * Persistence tests copy the official compiled snapshot into a temporary
 * `compiled-runtime-*` tree, execute there, then delete the tree in `finally`
 * before the coverage runner converts raw V8 dumps. Exact absolute-path join
 * therefore cannot re-open isolated JS/map bytes at conversion time.
 *
 * Before cleanup, writers under this registry directory record an authenticated
 * binding of: run/tree scope, complete canonical relative script path, official
 * JS/map digests, isolated JS/map digests, and the isolated absolute path / file
 * URL. The converter consumes those records only after validating every field
 * and never associates by URL shape or path suffix alone.
 */
export const ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV = 'EPGSTATION_ISOLATED_RUNTIME_IDENTITY_REGISTRY';
export const ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV = 'EPGSTATION_COVERAGE_RUN_SCOPE';
export const ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV = 'EPGSTATION_COVERAGE_TREE_DIGEST';
export const ISOLATED_RUNTIME_IDENTITY_SCHEMA_VERSION = 1;

/** Exact lowercase hex SHA-256 (64 chars). Empty / uppercase / truncated digests never authenticate. */
function isSha256HexDigest(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

/**
 * Removes the three isolated-runtime identity env vars from a child environment so non-coverage
 * runs never inherit a host's stale registry/run/tree tuple.
 * Coverage mode must re-assign all three after scrubbing.
 */
export function scrubIsolatedRuntimeIdentityEnv(env) {
    if (env === null || typeof env !== 'object') {
        fail('schema-mismatch', 'scrubIsolatedRuntimeIdentityEnv requires an env object');
    }
    const next = { ...env };
    delete next[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV];
    delete next[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV];
    delete next[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV];
    return next;
}

function tryReadCompiledPairDigests(scriptPath) {
    try {
        const jsSource = readFileSync(scriptPath, 'utf8');
        const sourceMappingUrl = extractSourceMappingUrl(jsSource);
        if (sourceMappingUrl === null || sourceMappingUrl.startsWith('data:')) {
            return null;
        }
        let decoded;
        try {
            decoded = decodeURIComponent(sourceMappingUrl);
        } catch {
            return null;
        }
        const mapPath = resolve(dirname(scriptPath), decoded);
        if (!existsSync(mapPath)) {
            return null;
        }
        return {
            jsSha256: sha256Hex(Buffer.from(jsSource, 'utf8')),
            mapPath,
            mapSha256: sha256Hex(readFileSync(mapPath)),
        };
    } catch {
        return null;
    }
}

/**
 * Writes one authenticated identity entry as its own JSON file under `registryDir`
 * (one file per entry so concurrent isolated-runtime creators never share a writer).
 * Returns the written absolute path.
 */
export function writeIsolatedRuntimeIdentityEntry({
    registryDir,
    runScope,
    treeDigest,
    canonicalRelativeScriptPath,
    officialJsSha256,
    officialMapSha256,
    isolatedJsSha256,
    isolatedMapSha256,
    isolatedScriptPath,
    isolatedScriptUrl,
} = {}) {
    if (typeof registryDir !== 'string' || registryDir.length === 0) {
        fail('schema-mismatch', 'registryDir must be a non-empty string');
    }
    if (typeof runScope !== 'string' || runScope.length === 0) {
        fail('schema-mismatch', 'runScope must be a non-empty string');
    }
    if (typeof treeDigest !== 'string' || treeDigest.length === 0) {
        fail('schema-mismatch', 'treeDigest must be a non-empty string');
    }
    if (typeof canonicalRelativeScriptPath !== 'string' || canonicalRelativeScriptPath.length === 0) {
        fail('schema-mismatch', 'canonicalRelativeScriptPath must be a non-empty string');
    }
    for (const [name, value] of [
        ['officialJsSha256', officialJsSha256],
        ['officialMapSha256', officialMapSha256],
        ['isolatedJsSha256', isolatedJsSha256],
        ['isolatedMapSha256', isolatedMapSha256],
    ]) {
        if (!isSha256HexDigest(value)) {
            fail('schema-mismatch', `${name} must be an exact lowercase sha256 hex digest`);
        }
    }
    // Official and isolated compiled pairs must be content-identical. A drifted isolated copy
    // must never become a valid association that later attributes raw counts to the official script.
    if (officialJsSha256 !== isolatedJsSha256) {
        fail(
            'schema-mismatch',
            'official/isolated JS digest cross-pair mismatch: officialJsSha256 must equal isolatedJsSha256',
        );
    }
    if (officialMapSha256 !== isolatedMapSha256) {
        fail(
            'schema-mismatch',
            'official/isolated map digest cross-pair mismatch: officialMapSha256 must equal isolatedMapSha256',
        );
    }
    if (typeof isolatedScriptPath !== 'string' || isolatedScriptPath.length === 0) {
        fail('schema-mismatch', 'isolatedScriptPath must be a non-empty string');
    }
    if (typeof isolatedScriptUrl !== 'string' || !isolatedScriptUrl.startsWith('file://')) {
        fail('schema-mismatch', 'isolatedScriptUrl must be a file:// URL string');
    }
    const resolvedIsolatedPath = resolve(isolatedScriptPath);
    const expectedUrl = pathToFileURL(resolvedIsolatedPath).href;
    if (isolatedScriptUrl !== expectedUrl) {
        fail(
            'schema-mismatch',
            'isolatedScriptUrl/path mismatch: isolatedScriptUrl must be pathToFileURL(isolatedScriptPath).href',
        );
    }

    const entry = {
        schemaVersion: ISOLATED_RUNTIME_IDENTITY_SCHEMA_VERSION,
        runScope,
        treeDigest,
        canonicalRelativeScriptPath: normalized(canonicalRelativeScriptPath),
        officialJsSha256,
        officialMapSha256,
        isolatedJsSha256,
        isolatedMapSha256,
        isolatedScriptPath: resolvedIsolatedPath,
        isolatedScriptUrl,
    };
    mkdirSync(registryDir, { recursive: true });
    const filePath = join(resolve(registryDir), `identity-${randomUUID()}.json`);
    writeFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    return filePath;
}

/**
 * Walks every compiled script under `isolatedSnapshotRoot` that also exists under
 * `officialSnapshotRoot`, and writes one identity entry per script whose JS+map
 * digests can be read on both sides. Used by the persistence harness after copy
 * and before cleanup.
 */
export function registerIsolatedRuntimeScriptIdentities({
    registryDir,
    runScope,
    treeDigest,
    officialSnapshotRoot,
    isolatedSnapshotRoot,
} = {}) {
    if (typeof officialSnapshotRoot !== 'string' || officialSnapshotRoot.length === 0) {
        fail('schema-mismatch', 'officialSnapshotRoot must be a non-empty string');
    }
    if (typeof isolatedSnapshotRoot !== 'string' || isolatedSnapshotRoot.length === 0) {
        fail('schema-mismatch', 'isolatedSnapshotRoot must be a non-empty string');
    }
    const officialRoot = resolve(officialSnapshotRoot);
    const isolatedRoot = resolve(isolatedSnapshotRoot);
    const written = [];
    for (const isolatedScriptPath of walkCompiledScripts(isolatedRoot)) {
        if (!isWithin(isolatedRoot, isolatedScriptPath)) {
            continue;
        }
        const relativeScriptPath = normalized(relative(isolatedRoot, isolatedScriptPath));
        const officialScriptPath = join(officialRoot, ...relativeScriptPath.split('/'));
        if (!existsSync(officialScriptPath)) {
            continue;
        }
        const official = tryReadCompiledPairDigests(officialScriptPath);
        const isolated = tryReadCompiledPairDigests(isolatedScriptPath);
        if (official === null || isolated === null) {
            continue;
        }
        // Skip drifted copies instead of writing a registry that would later mis-attribute coverage.
        if (official.jsSha256 !== isolated.jsSha256 || official.mapSha256 !== isolated.mapSha256) {
            continue;
        }
        written.push(
            writeIsolatedRuntimeIdentityEntry({
                registryDir,
                runScope,
                treeDigest,
                canonicalRelativeScriptPath: relativeScriptPath,
                officialJsSha256: official.jsSha256,
                officialMapSha256: official.mapSha256,
                isolatedJsSha256: isolated.jsSha256,
                isolatedMapSha256: isolated.mapSha256,
                isolatedScriptPath,
                isolatedScriptUrl: pathToFileURL(isolatedScriptPath).href,
            }),
        );
    }
    return written;
}

/**
 * Env-driven registration used by `createIsolatedCompiledRuntime` after a successful copy.
 * No-ops when the registry env is unset (non-coverage runs). Fails closed when the registry
 * env is set but run scope / tree digest / official snapshot are missing.
 */
export function registerIsolatedRuntimeIdentitiesFromEnv({
    officialSnapshotRoot,
    isolatedSnapshotRoot,
} = {}) {
    const registryDir = process.env[ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV];
    if (registryDir === undefined || registryDir.length === 0) {
        return [];
    }
    const runScope = process.env[ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV];
    const treeDigest = process.env[ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV];
    if (typeof runScope !== 'string' || runScope.length === 0) {
        fail(
            'schema-mismatch',
            `${ISOLATED_RUNTIME_IDENTITY_RUN_SCOPE_ENV} must be set when ${ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV} is set`,
        );
    }
    if (typeof treeDigest !== 'string' || treeDigest.length === 0) {
        fail(
            'schema-mismatch',
            `${ISOLATED_RUNTIME_IDENTITY_TREE_DIGEST_ENV} must be set when ${ISOLATED_RUNTIME_IDENTITY_REGISTRY_ENV} is set`,
        );
    }
    return registerIsolatedRuntimeScriptIdentities({
        registryDir,
        runScope,
        treeDigest,
        officialSnapshotRoot,
        isolatedSnapshotRoot,
    });
}

/**
 * Loads identity entry JSON files from `registryDir`. Corrupt / wrong-schema / incomplete /
 * cross-pair-mismatched files are ignored (fail-closed: they never authenticate).
 * Does not validate digests against disk — that happens at association time.
 */
export function loadIsolatedRuntimeIdentityEntries(registryDir) {
    if (typeof registryDir !== 'string' || registryDir.length === 0 || !existsSync(registryDir)) {
        return [];
    }
    const entries = [];
    for (const name of readdirSync(registryDir)) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const filePath = join(registryDir, name);
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
            continue;
        }
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            parsed.schemaVersion !== ISOLATED_RUNTIME_IDENTITY_SCHEMA_VERSION ||
            typeof parsed.runScope !== 'string' ||
            parsed.runScope.length === 0 ||
            typeof parsed.treeDigest !== 'string' ||
            parsed.treeDigest.length === 0 ||
            typeof parsed.canonicalRelativeScriptPath !== 'string' ||
            parsed.canonicalRelativeScriptPath.length === 0 ||
            !isSha256HexDigest(parsed.officialJsSha256) ||
            !isSha256HexDigest(parsed.officialMapSha256) ||
            !isSha256HexDigest(parsed.isolatedJsSha256) ||
            !isSha256HexDigest(parsed.isolatedMapSha256) ||
            typeof parsed.isolatedScriptPath !== 'string' ||
            parsed.isolatedScriptPath.length === 0 ||
            typeof parsed.isolatedScriptUrl !== 'string' ||
            !parsed.isolatedScriptUrl.startsWith('file://')
        ) {
            continue;
        }
        // Persisted cross-pair equality is mandatory even after the isolated tree is deleted.
        if (
            parsed.officialJsSha256 !== parsed.isolatedJsSha256 ||
            parsed.officialMapSha256 !== parsed.isolatedMapSha256
        ) {
            continue;
        }
        const isolatedScriptPath = resolve(parsed.isolatedScriptPath);
        if (parsed.isolatedScriptUrl !== pathToFileURL(isolatedScriptPath).href) {
            continue;
        }
        entries.push({
            ...parsed,
            canonicalRelativeScriptPath: normalized(parsed.canonicalRelativeScriptPath),
            isolatedScriptPath,
            sourceFile: name,
        });
    }
    return markConflictingIdentityEntries(entries);
}

/**
 * Conflict is scoped to the isolated-path binding (run/tree/isolated absolute path), not the
 * whole canonical relative script. Multiple distinct isolated runtimes for the same canonical
 * script with matching digests must all remain authentic (production multi-runtime corpus).
 * When the same isolated path binds to disagreeing canonical path or digest identity, every
 * member of that binding is marked conflicted so association refuses the ambiguous path only.
 * Identical duplicate records for one binding agree and are not conflicted (association
 * de-duplicates by resolved path).
 */
function markConflictingIdentityEntries(entries) {
    const byBinding = new Map();
    for (const entry of entries) {
        const key = `${entry.runScope}\0${entry.treeDigest}\0${entry.isolatedScriptPath}`;
        const group = byBinding.get(key);
        if (group === undefined) {
            byBinding.set(key, [entry]);
        } else {
            group.push(entry);
        }
    }
    const conflictKeys = new Set();
    for (const [key, group] of byBinding) {
        if (group.length < 2) {
            continue;
        }
        const fingerprint = entry =>
            [
                entry.canonicalRelativeScriptPath,
                entry.officialJsSha256,
                entry.officialMapSha256,
                entry.isolatedJsSha256,
                entry.isolatedMapSha256,
                entry.isolatedScriptUrl,
            ].join('\0');
        const first = fingerprint(group[0]);
        if (group.some(entry => fingerprint(entry) !== first)) {
            conflictKeys.add(key);
        }
    }
    return entries.map(entry => {
        const key = `${entry.runScope}\0${entry.treeDigest}\0${entry.isolatedScriptPath}`;
        return conflictKeys.has(key) ? { ...entry, conflicted: true } : entry;
    });
}

/**
 * Returns true when `entry` is an authenticated binding for `relativeScriptPath` under the
 * current run/tree and the official on-disk JS/map digests still match. Stored official and
 * isolated digests must already be equal (enforced at load). When the isolated files still
 * exist, their digests are re-checked against both the stored pair and the official pair;
 * when they are gone (real lifecycle), the persisted cross-pair equality still holds.
 */
function isAuthenticatedIdentityEntry(entry, {
    relativeScriptPath,
    officialScriptPath,
    runScope,
    treeDigest,
}) {
    if (entry.conflicted === true) {
        return false;
    }
    if (entry.runScope !== runScope || entry.treeDigest !== treeDigest) {
        return false;
    }
    if (entry.canonicalRelativeScriptPath !== relativeScriptPath) {
        return false;
    }
    // Defense in depth: refuse cross-pair mismatch even if a non-loader path constructed the entry.
    if (
        entry.officialJsSha256 !== entry.isolatedJsSha256 ||
        entry.officialMapSha256 !== entry.isolatedMapSha256
    ) {
        return false;
    }
    if (entry.isolatedScriptUrl !== pathToFileURL(entry.isolatedScriptPath).href) {
        return false;
    }
    const official = tryReadCompiledPairDigests(officialScriptPath);
    if (official === null) {
        return false;
    }
    if (official.jsSha256 !== entry.officialJsSha256 || official.mapSha256 !== entry.officialMapSha256) {
        return false;
    }
    // When the isolated copy is still present, re-verify stored isolated digests against disk.
    if (existsSync(entry.isolatedScriptPath)) {
        const isolated = tryReadCompiledPairDigests(entry.isolatedScriptPath);
        if (isolated === null) {
            return false;
        }
        if (isolated.jsSha256 !== entry.isolatedJsSha256 || isolated.mapSha256 !== entry.isolatedMapSha256) {
            return false;
        }
        // Live isolated bytes must still match official content identity.
        if (isolated.jsSha256 !== official.jsSha256 || isolated.mapSha256 !== official.mapSha256) {
            return false;
        }
    }
    return true;
}

/**
 * Groups raw dump records by resolved path (preserving dump provenance), then builds the
 * public raw entry shape used by discovery (attributionRecords + merged functions).
 *
 * `group`'s elements are already annotated with the exact
 * `resolvedPath` their own raw dump matched under (see `rawEntryFromAssociatedGroups` below) --
 * `attributionRecords` keeps that same `{ record, sourceFile, resolvedPath }` shape (not a bare
 * `record[]`) so a caller can later decide, *per record*, whether that specific dump file's own pid has
 * a transform capture for that specific resolved path, instead of applying one script-wide decision to
 * every record sharing this path regardless of which process actually produced it.
 */
function rawEntryFromGroup(group, resolvedPath) {
    if (group.length === 1) {
        flattenAndValidateRecordRanges(group[0].record, group[0].sourceFile, resolvedPath);
        return {
            attributionRecords: Object.freeze([
                Object.freeze({ record: group[0].record, resolvedPath: group[0].resolvedPath, sourceFile: group[0].sourceFile }),
            ]),
            functions: group[0].record.functions,
            url: group[0].record.url,
        };
    }
    const merged = mergeRawRecords(group, resolvedPath);
    return {
        attributionRecords: Object.freeze(
            group.map(({ record, resolvedPath: memberResolvedPath, sourceFile }) =>
                Object.freeze({ record, resolvedPath: memberResolvedPath, sourceFile }),
            ),
        ),
        functions: merged.functions,
        url: merged.url,
    };
}

/**
 * Collects exact-path groups plus lifecycle-safe identity-authenticated isolated groups for one
 * official script. Groups are sorted by dump file then URL for deterministic multi-record merge.
 */
function collectAssociatedRawGroups({
    scriptPath,
    relativeScriptPath,
    rawGroupsByPath,
    resolvedRoots,
    identityEntries,
    runScope,
    treeDigest,
}) {
    const groups = [];
    const exactPath = resolve(scriptPath);
    const exactGroup = rawGroupsByPath.get(exactPath);
    if (exactGroup !== undefined) {
        groups.push({ group: exactGroup, resolvedPath: exactPath });
    }

    if (
        Array.isArray(identityEntries) &&
        identityEntries.length > 0 &&
        typeof runScope === 'string' &&
        typeof treeDigest === 'string'
    ) {
        for (const entry of identityEntries) {
            if (
                !isAuthenticatedIdentityEntry(entry, {
                    relativeScriptPath,
                    officialScriptPath: scriptPath,
                    runScope,
                    treeDigest,
                })
            ) {
                continue;
            }
            const isolatedPath = resolve(entry.isolatedScriptPath);
            // Isolated path must never fall inside an official snapshot root (would be exact-path territory).
            if (resolvedRoots.some(root => isWithin(root, isolatedPath))) {
                continue;
            }
            const isolatedGroup = rawGroupsByPath.get(isolatedPath);
            if (isolatedGroup === undefined) {
                continue;
            }
            // Avoid double-counting if the same path somehow appears twice.
            if (groups.some(item => item.resolvedPath === isolatedPath)) {
                continue;
            }
            groups.push({ group: isolatedGroup, resolvedPath: isolatedPath });
        }
    }

    groups.sort((a, b) => {
        const aFile = a.group[0]?.sourceFile ?? '';
        const bFile = b.group[0]?.sourceFile ?? '';
        if (aFile !== bFile) {
            return aFile < bFile ? -1 : 1;
        }
        const aUrl = a.group[0]?.record?.url ?? '';
        const bUrl = b.group[0]?.record?.url ?? '';
        if (aUrl !== bUrl) {
            return aUrl < bUrl ? -1 : 1;
        }
        return a.resolvedPath < b.resolvedPath ? -1 : a.resolvedPath > b.resolvedPath ? 1 : 0;
    });
    return groups;
}

/**
 * Every member is annotated with its own group's
 * `resolvedPath` (the exact official path, or an authenticated isolated-runtime path) here,
 * unconditionally -- including the single-associated-group case, never handing `rawEntryFromGroup`
 * a bare `group` array with no per-member `resolvedPath`. That annotation is what lets a caller
 * later look up a transform capture by the *exact* path this specific record's own dump matched under
 * (never assumed to be the official `scriptPath` -- an isolated-runtime record's own Vitest worker, if
 * any, captured the *isolated* absolute path as its module id, not the official one).
 */
function rawEntryFromAssociatedGroups(associated) {
    if (associated.length === 0) {
        return undefined;
    }
    const combined = [];
    for (const item of associated) {
        for (const member of item.group) {
            combined.push({ record: member.record, resolvedPath: item.resolvedPath, sourceFile: member.sourceFile });
        }
    }
    // Use the official-or-first path only for diagnostics inside merge validation.
    return rawEntryFromGroup(combined, associated[0].resolvedPath);
}

/**
 * Discovers the compiled-snapshot raw V8 coverage records for `snapshotRoots` (one or more `dist`
 * directories) against `rawCoverageDir` (a `NODE_V8_COVERAGE`-style flat directory of raw dump JSON
 * files), validating every rule documented in the module doc above. Fails closed (throws
 * `CompiledSnapshotCoverageError`) on the first violation instead of returning a partial result.
 *
 * Returns `{ records }`: `records` is a frozen array, one entry per discovered compiled-snapshot
 * script, sorted by `snapshotRoot` then `relativeScriptPath`. Each entry is
 * `{ snapshotRoot, scriptPath, relativeScriptPath, sourcePath, rawUrl, functions, entries, branchEntries }`
 * -- `functions` is that script's raw V8 `functions` array: the untouched record when exactly one raw
 * record was captured for the resolved path, or the merged synthetic array produced by `mergeRawRecords`
 * (see the module doc's raw-merge entry) when more than one was captured for the same path;
 * `entries` is the converted Istanbul-compatible `{ start, end, count }[]` (see the module doc). `entries.length` is
 * the script's total location population; `entries.filter(e => e.count > 0).length` is covered --
 * both derived from this one conversion, never from a separate zero-fill source. `branchEntries` (location basis
 * shard-independent) is the same `{ start, end, count }[]`
 * shape, built by `buildBranchBasisEntries` from a static parse of this script's own compiled JS
 * instead of from `functions` -- `functions`' own ranges (every range of every function; see
 * `countForSpanStart`) decide only each outcome's count, never which outcomes exist.
 *
 * Also returns `excludedRecordDiagnostics` (whole raw records excluded as unverifiable; see the
 * per-record dispatch above) and `functionGranularityExclusions` (a finer-grained diagnostic: one
 * specific `isBlockCoverage: false`-with-positive-count range inside an otherwise-verified record; see
 * `makeFunctionGranularityExclusionReporter`) -- both undercounting-visibility signals, never a reason to
 * fail this call on their own.
 */
export function discoverCompiledSnapshotCoverage({
    snapshotRoots,
    rawCoverageDir,
    repositoryRoot = process.cwd(),
    identityRegistryDir,
    runScope,
    treeDigest,
    transformCaptureDir,
} = {}) {
    if (!Array.isArray(snapshotRoots) || snapshotRoots.length === 0) {
        fail('schema-mismatch', 'snapshotRoots must be a non-empty array of directory paths');
    }
    const resolvedRoots = [...new Set(snapshotRoots.map(root => resolve(root)))].sort();
    /** Per-discovery cache of `sourcePath` → declared if-true-arm statement exclusion ranges. */
    const sourceStatementExclusionCache = new Map();

    // Lifecycle-safe identity entries (optional) authenticate isolated-runtime raw URLs after the
    // isolated tree has been deleted -- exact absolute-path join alone cannot recover them. Loaded
    // before any raw dump is read (see below) so its `isolatedScriptPath` values are already known
    // when the memory-bounded raw-record filter is built.
    const identityEntries =
        typeof identityRegistryDir === 'string' && identityRegistryDir.length > 0
            ? loadIsolatedRuntimeIdentityEntries(identityRegistryDir)
            : [];

    // Memory-bounded raw-record filter: the exact, closed set of resolved paths a raw record can
    // ever be consulted for is every compiled-snapshot script under `resolvedRoots` plus every
    // `isolatedScriptPath` a loaded identity entry names -- `collectAssociatedRawGroups` below never
    // looks `rawGroupsByPath` up by any other key. Computing this set up front, before a single raw
    // dump byte is read, lets `readRawCoverageRecords` discard every script-external record (Node
    // internals, `node_modules`, TypeScript, test files, unrelated child-process scripts) as soon as
    // its `url` resolves, instead of retaining the full parsed dump for this discovery pass's entire
    // lifetime. This also folds `walkCompiledScripts` into a single pass per root (`scriptsByRoot`),
    // reused by the discovery loop below instead of walking each root's tree twice.
    const scriptsByRoot = new Map();
    const relevantPaths = new Set();
    for (const root of resolvedRoots) {
        const scripts = walkCompiledScripts(root)
            .filter(scriptPath => isWithin(root, scriptPath))
            .sort();
        scriptsByRoot.set(root, scripts);
        for (const scriptPath of scripts) {
            relevantPaths.add(resolve(scriptPath));
        }
    }
    for (const entry of identityEntries) {
        relevantPaths.add(resolve(entry.isolatedScriptPath));
    }

    const rawGroupsByPath = new Map();
    for (const { record, resolvedPath, sourceFile } of readRawCoverageRecords(rawCoverageDir, relevantPaths)) {
        const group = rawGroupsByPath.get(resolvedPath);
        if (group === undefined) {
            rawGroupsByPath.set(resolvedPath, [{ record, sourceFile }]);
        } else {
            group.push({ record, sourceFile });
        }
    }

    // Optional: when omitted entirely, this discovery pass treats every raw record as dist-native. When
    // a caller supplies `transformCaptureDir`, `transformCapturesByPidAndPath` below is consulted *per
    // raw attribution record* (see the main discovery loop), never as a script-wide "every record for
    // this path must have a capture" requirement: a raw dump legitimately carries records this
    // capture harness could never have captured at all -- a plain `createRequire()`/`require()`
    // load bypassing Vite's module runner entirely (this repository's own `correlation.spec` harness
    // loading `dist/model/ipc/IPCClient.js` directly), a spawned child process running a
    // `dist/**\/*.js` entry point on its own (e.g. `notification-child.cjs`), or an isolated-runtime
    // copy loaded the same way -- none of which Vitest ever transforms, so their raw offsets are
    // already valid dist-file offsets, and requiring a capture for
    // them would fail a run that was never broken (`missing-transform-capture:
    // "model/ipc/IPCClient.js"` on every real run that exercises that harness).
    //
    // This scope does NOT fail closed merely because the caller opted in (`transformCaptureDir` set)
    // and zero transform captures exist *anywhere* under it while at least one relevant raw record
    // exists (`transformCapturesByPidAndPath.size === 0 && rawGroupsByPath.size > 0`). That shape does
    // not necessarily mean "the capture harness never engaged for this entire run": it is also what a
    // legitimate NARROW test selection produces (e.g. running only a handful of files whose
    // own coverage is exercised entirely through native `require()`/child-process loads, with nothing
    // routed through Vitest's module runner at all): such a selection has zero captures anywhere and at
    // least one relevant raw record, yet is not a defect -- every one of those raw records is
    // dist-native (`topLevelEnd === jsSource.length`) and needs no capture at all, exactly like the
    // per-record cases excluded from requiring one, above. Failing the
    // whole run would punish a correct, narrow selection for a global absence of evidence it never
    // needed in the first place. The finer per-record/per-script disposition in the main discovery loop
    // below already catches the real defect: a script whose own record(s)
    // genuinely needed a capture (`topLevelEnd !== jsSource.length`) and found none among zero candidates
    // is excluded with a diagnostic, and a script with NO verified record at all (every one of its raw
    // records excluded) still fails closed as `unverified-raw-offset-space` -- precisely for the case
    // where the capture harness truly never engaged for a run that needed it, without over-reaching into
    // runs that never needed it at all.
    const transformCapturesByPidAndPath =
        typeof transformCaptureDir === 'string' && transformCaptureDir.length > 0
            ? readTransformCaptures(transformCaptureDir, relevantPaths)
            : undefined;
    // Public `functions` still use additive exact-key merge (see the module doc's raw-merge entry). Statement/branch *counts*
    // keep each raw record's coherent V8 topology separately (`attributionRecords`) so innermost
    // containment is decided per record before non-negative counts are summed -- never against a
    // topology-destroying synthetic union.

    const sourceByRelativePath = new Map();
    const relativePathBySource = new Map();
    const records = [];
    // One entry per raw record excluded from count attribution because
    // its own coordinate space could not be verified (see the per-record dispatch below) while at least
    // one OTHER record for the same script did verify -- never populated when `transformCaptureDir` is
    // omitted (that whole verification step never runs at all in that case).
    const excludedRecordDiagnostics = [];
    // One entry per DISTINCT
    // (dump file, offending raw-range) combination `countForSpanStart` found to be `isBlockCoverage:
    // false` with a positive count for some statement/branch query -- function-invocation-only evidence,
    // no block detail, so that record contributed `0` for every query landing in that range instead of a
    // fabricated count (see `countForSpanStart`'s own doc and `makeFunctionGranularityExclusionReporter`).
    // Never a whole-record or whole-script exclusion like `excludedRecordDiagnostics` above -- other
    // spans in the SAME record, outside the offending range, are still counted normally.
    const functionGranularityExclusions = [];
    const seenFunctionGranularityExclusions = new Set();

    for (const root of resolvedRoots) {
        const scripts = scriptsByRoot.get(root);
        for (const scriptPath of scripts) {
            const relativeScriptPath = normalized(relative(root, scriptPath));
            const associated = collectAssociatedRawGroups({
                scriptPath,
                relativeScriptPath,
                rawGroupsByPath,
                resolvedRoots,
                identityEntries,
                runScope,
                treeDigest,
            });
            const rawEntry = rawEntryFromAssociatedGroups(associated);
            const missingRawRecord = rawEntry === undefined;

            const jsSource = readFileSync(scriptPath, 'utf8');
            const sourceMappingUrl = extractSourceMappingUrl(jsSource);
            const sourceMap = sourceMappingUrl === null ? null : readSourceMap(scriptPath, sourceMappingUrl);
            if (sourceMap === null) {
                fail(
                    'missing-source-map',
                    `"${relativeScriptPath}" in snapshot root "${root}" has no readable source map`,
                );
            }

            const resolvedSources = resolveMapSources(sourceMap.map, sourceMap.mapPath);
            if (resolvedSources.length !== 1) {
                fail(
                    'duplicate-inconsistent-mapping',
                    `"${relativeScriptPath}" in snapshot root "${root}" source map must resolve to exactly one source, found ${resolvedSources.length}`,
                );
            }

            const sourcePath = repoRelativeSrcPath(resolvedSources[0], repositoryRoot);
            if (sourcePath === null) {
                fail(
                    'source-map-outside-src',
                    `"${relativeScriptPath}" in snapshot root "${root}" source map resolves outside src/**/*.ts`,
                );
            }

            const priorSource = sourceByRelativePath.get(relativeScriptPath);
            if (priorSource !== undefined && priorSource !== sourcePath) {
                fail(
                    'duplicate-inconsistent-mapping',
                    `"${relativeScriptPath}" maps to "${sourcePath}" in snapshot root "${root}" but "${priorSource}" elsewhere`,
                );
            }
            sourceByRelativePath.set(relativeScriptPath, sourcePath);

            const priorRelativePath = relativePathBySource.get(sourcePath);
            if (priorRelativePath !== undefined && priorRelativePath !== relativeScriptPath) {
                fail(
                    'duplicate-inconsistent-mapping',
                    `"${sourcePath}" is mapped from both "${priorRelativePath}" and "${relativeScriptPath}"`,
                );
            }
            relativePathBySource.set(sourcePath, relativeScriptPath);

            // Computed once per script from the byte-equality classifier the stub branch below uses --
            // never a second classifier, never inferred from emptiness or path.
            const typeErasureStub = isCanonicalTypeErasureStub(jsSource);

            // Unexecuted-stub classification: made strictly from the compiled JS body itself, ahead of
            // the missing-raw-record fail-closed check below -- a
            // comment-tolerant-canonical-stub script has no executable statement for any V8 range to
            // attribute, whether or not this run's raw dump happens to contain a record for it, and is
            // never range-converted (a `mappingPoints.length === 0` gate would let a
            // stub with any mapping point -- including the comment-derived points `src/Enums.ts`'s
            // preserved block comment produces -- fall through and fabricate a phantom entry).
            if (typeErasureStub) {
                records.push(
                    Object.freeze({
                        snapshotRoot: root,
                        scriptPath,
                        relativeScriptPath,
                        sourcePath,
                        rawUrl: missingRawRecord ? null : rawEntry.url,
                        functions: missingRawRecord ? Object.freeze([]) : rawEntry.functions,
                        entries: Object.freeze([]),
                        branchEntries: Object.freeze([]),
                    }),
                );
                continue;
            }

            if (missingRawRecord) {
                fail(
                    'missing-raw-record',
                    `"${relativeScriptPath}" in snapshot root "${root}" has no matching raw V8 coverage record`,
                );
            }

            if (!Array.isArray(rawEntry.functions)) {
                fail(
                    'malformed-raw-dump',
                    `"${relativeScriptPath}" in snapshot root "${root}" raw record has no functions array`,
                );
            }
            const mappingPoints = decodeMappings(sourceMap.map.mappings);
            const lineStartOffsets = computeLineStartOffsets(jsSource);

            // Decided *per attribution record*, never once for the whole script, and never by the mere
            // *presence or absence* of a same-pid capture (a native `require()`/
            // `createRequire()` load or a spawned child process legitimately has no capture at all, so
            // "no capture ⇒ on-disk" is usually right, but "no capture ⇒ ALWAYS on-disk" is an
            // unverified assumption, not a proof, and pid reuse across two sequential Vitest CLI
            // invocations writing into the same raw directory -- see run-tests.mjs's own coverage-mode
            // batching -- could in principle let a stale same-pid capture from an unrelated earlier
            // invocation apply to the wrong record). Every record's own coordinate space is instead
            // *measured*: `topLevelRangeEndOffset` reads the exact total length V8 actually compiled for
            // this record (its own top-level range, offset 0 to end -- reliable because V8 always gives
            // the whole compiled unit's own top-level scope this shape), compared against the on-disk
            // dist file's own length and every candidate capture's own reconstructed wrapped length.
            // Confirmed empirically against this repository's own real coverage data: a
            // `correlation.spec`-style native `require()` load of `IPCClient.js` reports a top-level end
            // of exactly `jsSource.length`; a real Vitest-executed `EPGUpdateExecutor.js` reports a
            // top-level end of exactly `wrapperPrefixLength + code.length + '\n}}'.length`.
            // Gated on the caller having opted into capture verification at all (`transformCaptureDir`
            // supplied): a caller that never does (a test fixture with no capture harness)
            // gets the plain behavior -- every record trusted as already dist-native, no
            // verification, no way to fail closed on it. Only once a caller supplies real capture evidence
            // does this discovery pass hold every record in this script to the higher, *verified*
            // standard the capture mechanism makes possible.
            const jsSourceHash = transformCapturesByPidAndPath === undefined ? undefined : sha256Hex(jsSource);
            // Computed once per script (see `establishTopLevelEndsByPidAndScriptId`'s own
            // doc), across ALL of its raw dumps regardless of pid, so an
            // anchor-less dump below can borrow the coordinate space already established for its own EXACT
            // `(pid, scriptId)` script instance instead of failing closed purely for lacking its own copy
            // of a measurement a sibling dump of that same instance already made.
            const establishedTopLevelEndsByPidAndScriptId =
                transformCapturesByPidAndPath === undefined
                    ? undefined
                    : establishTopLevelEndsByPidAndScriptId(rawEntry.attributionRecords);
            // Every disposition below returns the SAME descriptor shape,
            // `{ functions, ownMappingPoints, ownLineStartOffsets, queryOffsetFor }` -- never the bare
            // `attr.record`. `functions` is that record's own, untouched raw V8
            // `functions` array (never translated); `ownMappingPoints`/`ownLineStartOffsets` describe
            // whichever coordinate space `functions`'s own raw offsets actually live in (dist-native for a
            // plain `require()`/child-process record and for the early-return no-`transformCaptureDir`
            // case; the WRAPPED executed-text space for a Vitest-module-runner record), for the
            // representability check below to validate against the RIGHT space instead of always assuming
            // dist coordinates; `queryOffsetFor(distOffset)` is the reverse hop
            // `countForSpanStartAcrossRecords` needs to compare a dist-space basis-span query against this
            // record's own native-space ranges (identity for dist-native, `reverseTranslateDistOffsetToExecuted`
            // for a captured one). A uniform descriptor shape for every disposition means every downstream
            // consumer (the `recordRangeSets` construction loop and `buildBranchBasisEntries`) needs no
            // per-record branching of its own.
            const effectiveAttributionRecords = rawEntry.attributionRecords.map(attr => {
                if (transformCapturesByPidAndPath === undefined) {
                    return {
                        functions: attr.record.functions,
                        ownLineStartOffsets: lineStartOffsets,
                        ownMappingPoints: mappingPoints,
                        pid: pidFromRawDumpFileName(attr.sourceFile),
                        queryOffsetFor: distOffset => distOffset,
                        sourceFile: attr.sourceFile,
                    };
                }
                const pid = pidFromRawDumpFileName(attr.sourceFile);
                const topLevelEnd = resolveTopLevelEnd(attr.record, pid, establishedTopLevelEndsByPidAndScriptId);
                if (topLevelEnd === null) {
                    fail(
                        'unverified-raw-offset-space',
                        `"${relativeScriptPath}" in snapshot root "${root}" raw record in "${attr.sourceFile}" (pid ${pid ?? 'unknown'}) has no unambiguous top-level range (exactly one function named "" with a range starting at offset 0) to verify which coordinate space its own offsets live in, and no other dump from the same pid for this same script established one it could borrow (or this record's own ranges do not fit inside the one that was established)`,
                    );
                }

                const sameProcessCandidates =
                    pid === null ? [] : (transformCapturesByPidAndPath?.get(pid)?.get(attr.resolvedPath) ?? []);
                // A capture from a *different* pid of the
                // same run may only ever stand in for this record's own missing/insufficient capture when
                // its own recorded `distSourceHash` proves it was transformed from the exact same on-disk
                // bytes this discovery pass is looking at right now -- Vite's SSR transform is
                // deterministic for identical input, so identical on-disk bytes is a sound (not merely
                // correlational) basis for trusting another pid's own observed transform output.
                const crossPidCandidates = [];
                if (transformCapturesByPidAndPath !== undefined) {
                    for (const [otherPid, byPath] of transformCapturesByPidAndPath) {
                        if (otherPid === pid) {
                            continue;
                        }
                        for (const candidate of byPath.get(attr.resolvedPath) ?? []) {
                            if (candidate.distSourceHash === jsSourceHash) {
                                crossPidCandidates.push(candidate);
                            }
                        }
                    }
                }
                const candidates = [...sameProcessCandidates, ...crossPidCandidates];

                if (topLevelEnd === jsSource.length) {
                    // Ambiguous case: on-disk length is the
                    // measured truth here, but if some candidate capture's own wrapped length happens to
                    // land on that exact same number *and* that capture's content genuinely differs from
                    // the on-disk bytes, this measurement alone cannot distinguish "executed natively" from
                    // "executed wrapped, coincidentally the same total length" -- never guess, fail closed.
                    const colliding = candidates.find(
                        candidate => wrappedLength(candidate) === jsSource.length && candidate.code !== jsSource,
                    );
                    if (colliding !== undefined) {
                        fail(
                            'ambiguous-raw-offset-space',
                            `"${relativeScriptPath}" in snapshot root "${root}" raw record in "${attr.sourceFile}" (pid ${pid ?? 'unknown'}) has a top-level end (${topLevelEnd}) equal to both the on-disk dist length and a candidate transform capture's own wrapped length, with differing content -- cannot verify which coordinate space applies`,
                        );
                    }
                    return {
                        functions: attr.record.functions,
                        ownLineStartOffsets: lineStartOffsets,
                        ownMappingPoints: mappingPoints,
                        pid,
                        queryOffsetFor: distOffset => distOffset,
                        sourceFile: attr.sourceFile,
                    };
                }

                const matching = candidates.filter(candidate => wrappedLength(candidate) === topLevelEnd);
                const distinctMatching = [];
                for (const candidate of matching) {
                    if (
                        !distinctMatching.some(
                            existing =>
                                existing.code === candidate.code &&
                                existing.wrapperPrefixLength === candidate.wrapperPrefixLength,
                        )
                    ) {
                        distinctMatching.push(candidate);
                    }
                }
                if (distinctMatching.length === 0) {
                    // A record this discovery pass can neither prove is
                    // on-disk-native nor match to any candidate capture's own wrapped length is not
                    // automatically a whole-run defect -- a legitimate mechanism this repository's own
                    // tests use (`test/server/persistence/harness.ts#installDataSourceFactory`: a live
                    // `import()` of the compiled snapshot immediately after `vi.mock('typeorm')` +
                    // `vi.resetModules()`, whose own module-runner-transformed `code` is invalidated by
                    // that *same test's own* later `vi.resetModules()` in its cleanup before any
                    // `afterEach`/`afterAll` capture opportunity ever runs) can legitimately produce a raw
                    // record this capture mechanism structurally cannot ever observe,
                    // for a script that some *other* record (a plain `require()`, or a capture-matched
                    // Vitest execution) already proves real coverage evidence for. Rather than fabricate a
                    // translation for it or fail the whole run over one unobservable record, it is
                    // EXCLUDED from count attribution entirely (never contributes a count to any basis
                    // span, positive or zero) and reported as a diagnostic -- covered counts for this
                    // script still come only from whichever OTHER record(s) are proven real. Only when
                    // EVERY record for a script is unverifiable does this still fail closed (checked once
                    // all records are dispositioned, below) -- a script with zero trustworthy evidence at
                    // all must never be silently reported as if it had some.
                    return {
                        diagnostic: {
                            distLength: jsSource.length,
                            pid: pid ?? null,
                            relativeScriptPath,
                            root,
                            sourceFile: attr.sourceFile,
                            topLevelEnd,
                        },
                        excluded: true,
                    };
                }
                if (
                    distinctMatching.length > 1 &&
                    !candidateTranslationsAreEquivalent(distinctMatching, mappingPoints, lineStartOffsets)
                ) {
                    fail(
                        'ambiguous-raw-offset-space',
                        `"${relativeScriptPath}" in snapshot root "${root}" raw record in "${attr.sourceFile}" (pid ${pid ?? 'unknown'}) has top-level end ${topLevelEnd}, matched by ${distinctMatching.length} distinct candidate transform captures whose own translations diverge for at least one dist position -- cannot verify which coordinate space applies`,
                    );
                }
                // More than one
                // distinct-content candidate matching this record's own wrapped length is only actually
                // ambiguous when the candidates disagree on at least one translation -- when they all
                // provably agree everywhere, any one of them (here, simply the first) gives the exact
                // same result as any other, so the choice itself carries no risk.
                const capture = distinctMatching[0];

                if (capture.map === null || typeof capture.map.mappings !== 'string') {
                    fail(
                        'malformed-transform-capture',
                        `"${relativeScriptPath}" in snapshot root "${root}" transform capture (pid ${pid}) has no usable source map`,
                    );
                }
                // `resolveMapSources` only ever reads `dirname(mapPath)` -- there is no real map *file*
                // for this in-memory captured map, so a synthetic path in the script's own directory
                // (where Vite resolves this composed map's own relative `sources` from, matching how a
                // real adjacent `.js.map` would) is passed instead of a real one.
                const captureSources = resolveMapSources(
                    capture.map,
                    join(dirname(attr.resolvedPath), 'transform-capture.map'),
                );
                if (captureSources.length !== 1) {
                    fail(
                        'malformed-transform-capture',
                        `"${relativeScriptPath}" in snapshot root "${root}" transform capture (pid ${pid}) source map must resolve to exactly one source, found ${captureSources.length}`,
                    );
                }
                const captureSourcePath = repoRelativeSrcPath(captureSources[0], repositoryRoot);
                if (captureSourcePath !== sourcePath) {
                    fail(
                        'malformed-transform-capture',
                        `"${relativeScriptPath}" in snapshot root "${root}" transform capture (pid ${pid}) resolves to "${captureSourcePath}", not this script's own "${sourcePath}"`,
                    );
                }
                // `capture`'s own raw ranges (`attr.record.functions`) stay
                // in the WRAPPED executed-text space Vitest actually ran -- never translated -- so the
                // representability check and count-attribution query both need this capture's OWN map
                // (`capture.map`, composed by Vite straight from the original `.ts` source, decoded once
                // here) instead of the dist file's own `mappingPoints`. `codeMappingPointsBySource` is the
                // same points sorted by SOURCE position instead of generated position, exactly like
                // `buildMappingPointsSortedBySource` already does for the dist side elsewhere in this
                // module -- needed for `reverseTranslateDistOffsetToExecuted`'s own source -> executed hop.
                const codeMappingPoints = decodeMappings(capture.map.mappings);
                const codeMappingPointsBySource = buildMappingPointsSortedBySource(codeMappingPoints);
                const codeLineStartOffsets = computeLineStartOffsets(capture.code);
                return {
                    functions: attr.record.functions,
                    ownLineStartOffsets: codeLineStartOffsets,
                    ownMappingPoints: codeMappingPoints,
                    pid,
                    queryOffsetFor: distOffset =>
                        reverseTranslateDistOffsetToExecuted({
                            codeLineStartOffsets,
                            codeMappingPointsBySource,
                            distLineStartOffsets: lineStartOffsets,
                            distOffset,
                            mappingPoints,
                            wrapperPrefixLength: capture.wrapperPrefixLength,
                        }),
                    sourceFile: attr.sourceFile,
                };
            });

            // Dispositioned above, per record, into either a real
            // (verified) record or an `{ excluded: true, diagnostic }` sentinel. A script with at least
            // one verified record still reports real coverage from it/them -- the excluded one(s) are
            // dropped from count attribution and reported as diagnostics, never silently absorbed as if
            // they were on-disk-native. A script with NO verified record at all (every one of its raw
            // records was unverifiable) has no trustworthy evidence whatsoever and must still fail closed
            // here -- never reported as if some record had proven anything.
            const excludedThisScript = effectiveAttributionRecords.filter(item => item?.excluded === true);
            const verifiedAttributionRecords = effectiveAttributionRecords.filter(item => item?.excluded !== true);
            if (verifiedAttributionRecords.length === 0 && excludedThisScript.length > 0) {
                const detail = excludedThisScript
                    .map(
                        item =>
                            `pid ${item.diagnostic.pid ?? 'unknown'} in "${item.diagnostic.sourceFile}" (top-level end ${item.diagnostic.topLevelEnd}, dist length ${item.diagnostic.distLength})`,
                    )
                    .join('; ');
                fail(
                    'unverified-raw-offset-space',
                    `"${relativeScriptPath}" in snapshot root "${root}" has no record with a verifiable coordinate space (every raw record was excluded): ${detail}`,
                );
            }
            for (const item of excludedThisScript) {
                excludedRecordDiagnostics.push(Object.freeze({ ...item.diagnostic }));
                process.stderr.write(
                    `compiled-snapshot-coverage: excluded an unverifiable raw record for "${item.diagnostic.relativeScriptPath}" (pid ${item.diagnostic.pid ?? 'unknown'}, dump "${item.diagnostic.sourceFile}", top-level end ${item.diagnostic.topLevelEnd} matches neither the on-disk dist length ${item.diagnostic.distLength} nor any candidate transform capture) -- verified evidence from another record for this same script is still counted; this record contributes nothing.\n`,
                );
            }

            // Record-local attribution: every raw range is still validated
            // for representability, but count lookup keeps one flat range set per original raw record
            // (not the exact-key-unioned synthetic `functions` array) so innermost containment stays
            // coherent inside each V8 topology before counts are summed.
            //
            // `attrRecord` is the same descriptor
            // `{ functions, ownMappingPoints, ownLineStartOffsets, queryOffsetFor }` every disposition of
            // `effectiveAttributionRecords` returns -- representability is validated against
            // `attrRecord`'s OWN coordinate space (`ownMappingPoints`/`ownLineStartOffsets`), never
            // unconditionally against the dist file's `mappingPoints`/`lineStartOffsets`, because a
            // captured record's raw ranges live in the WRAPPED executed-text space, not dist space; the
            // dist `mappingPoints`/`lineStartOffsets` closed over from the outer scope would silently
            // validate the wrong numbers against the wrong map for that record. `queryOffsetFor` is carried
            // through unchanged into the descriptor `countForSpanStartAcrossRecords` (via
            // `buildStatementBasisEntries`) expects. `pid`/`sourceFile` are also carried through unchanged
            // (identity only, never used for counting) so `makeFunctionGranularityExclusionReporter`'s own
            // diagnostic can name which dump file/process an excluded query came from.
            const recordRangeSets = [];
            for (const attrRecord of verifiedAttributionRecords) {
                if (!Array.isArray(attrRecord?.functions)) {
                    fail(
                        'malformed-raw-dump',
                        `"${relativeScriptPath}" in snapshot root "${root}" raw record has no functions array`,
                    );
                }
                const flatRawRanges = [];
                for (const fn of attrRecord.functions) {
                    for (const range of Array.isArray(fn?.ranges) ? fn.ranges : []) {
                        const converted = convertRange(range, attrRecord.ownMappingPoints, attrRecord.ownLineStartOffsets);
                        if (!converted.omit && converted.entry === null) {
                            fail(
                                'no-representable-source-location',
                                `"${relativeScriptPath}" in snapshot root "${root}" has a V8 range [${range.startOffset}, ${range.endOffset}) with no representable source location`,
                            );
                        }
                        flatRawRanges.push({
                            count: range.count,
                            endOffset: range.endOffset,
                            functionName: fn.functionName,
                            isBlockCoverage: fn.isBlockCoverage === true,
                            startOffset: range.startOffset,
                        });
                    }
                }
                recordRangeSets.push({
                    flatRawRanges,
                    pid: attrRecord.pid,
                    queryOffsetFor: attrRecord.queryOffsetFor,
                    sourceFile: attrRecord.sourceFile,
                });
            }
            const reportFunctionGranularityExclusion = makeFunctionGranularityExclusionReporter(
                relativeScriptPath,
                root,
                functionGranularityExclusions,
                seenFunctionGranularityExclusions,
            );
            const loadedAuthorization = loadSourceCoverageAuthorization(
                repositoryRoot,
                sourcePath,
                sourceStatementExclusionCache,
            );
            const statementBasis = buildStatementBasisEntries(
                mappingPoints,
                lineStartOffsets,
                jsSource,
                recordRangeSets,
                reportFunctionGranularityExclusion,
            );
            // Single count rule (see `countForSpanStart` below): branch outcomes are counted
            // from the SAME per-record candidate range set the statement basis used above
            // (`recordRangeSets` -- every range of every function, `isBlockCoverage` tag carried through
            // for `countForSpanStart`'s own function-granularity-exclusion check), never a branch-only
            // filtered subset. This makes the two bases agree by construction at any identically-keyed
            // position -- see the comment after the exclusion pass below for why a separate runtime check
            // is redundant.
            const branchBasis = buildBranchBasisEntries(
                jsSource,
                mappingPoints,
                lineStartOffsets,
                recordRangeSets,
                relativeScriptPath,
                root,
                reportFunctionGranularityExclusion,
            );
            // The authorization is applied after both completed bases exist; its statement and branch
            // parts are resolved independently of each other.
            const { statementEntries: entries, branchEntries } =
                loadedAuthorization === null
                    ? { branchEntries: branchBasis, statementEntries: statementBasis }
                    : applyCoverageExclusions({
                          authorization: loadedAuthorization.authorization,
                          branchEntries: branchBasis,
                          sourcePath,
                          sourceText: loadedAuthorization.sourceText,
                          statementEntries: statementBasis,
                      });

            // `buildBranchBasisEntries` and `buildStatementBasisEntries` both call
            // `countForSpanStartAcrossRecords` over the exact same `recordRangeSets` (see above), so a
            // branch entry and an identically-keyed statement entry are always the same
            // `countForSpanStart` call over the same candidates -- they cannot diverge by construction.
            // A runtime invariant checking for it would only ever fire on a genuine converter bug
            // elsewhere (which its own error would already surface) or never fire at all. A check that can
            // only be legitimately silent is not a safeguard.

            records.push(
                Object.freeze({
                    snapshotRoot: root,
                    scriptPath,
                    relativeScriptPath,
                    sourcePath,
                    rawUrl: rawEntry.url,
                    functions: rawEntry.functions,
                    entries: Object.freeze(entries),
                    branchEntries: Object.freeze(branchEntries),
                }),
            );
        }
    }

    return Object.freeze({
        excludedRecordDiagnostics: Object.freeze(excludedRecordDiagnostics),
        functionGranularityExclusions: Object.freeze(functionGranularityExclusions),
        records: Object.freeze(records),
    });
}

/**
 * Confirms every `src/**\/*.ts` file
 * (excluding `.d.ts`) under `repositoryRoot` is accounted for in `records` -- either it already has a
 * discovered compiled-snapshot record, or it is explicitly named in `declaredNoEmitSources` (a
 * caller-supplied, independently-reviewed list of repo-relative `src/**\/*.ts` paths known to produce
 * no compiled JS output at all, e.g. a file containing only type/interface declarations that `tsc`
 * erases). A source with neither is rejected (`undeclared-no-emit-source`): a missing
 * no-emit classification is refused -- silently dropping an unmapped source from the total map would hide a real collection gap
 * behind what looks like a deliberate no-emit classification.
 *
 * A declared no-emit source that DOES have a discovered record is also rejected (`no-emit-mismatch`):
 * the declaration and the real compiled output disagree, and guessing which one is stale would hide
 * that drift instead of surfacing it. Same for a declared entry that is not itself a real file under
 * `repositoryRoot`'s `src/` tree at all (typo, moved/renamed file) -- also `schema-mismatch`.
 *
 * Returns `{ records }`: `records` with one additional frozen, minimal entry per accepted no-emit
 * source appended (`{ sourcePath, entries: [], noEmit: true }` -- deliberately only the fields
 * `toCoverageFinalMap` actually reads). This gives every no-emit source an explicit, zero-statement
 * entry in the eventual coverage-final map -- step 7's "total map上の明示entry" -- rather than a
 * silent absence indistinguishable from an uncollected script.
 *
 * Pure and synchronous except for the `src/**\/*.ts` directory walk itself; never touches
 * `snapshotRoots`/`rawCoverageDir` (already consumed by `discoverCompiledSnapshotCoverage` to produce
 * `records`). Called by `writeCanonicalCoverageArtifacts` below on every run, between discovery and
 * conversion, with its own `declaredNoEmitSources` (default `[]`) passed straight through.
 */
export function verifyTotalSourcePopulation({
    records,
    repositoryRoot = process.cwd(),
    declaredNoEmitSources = [],
} = {}) {
    if (!Array.isArray(records)) {
        fail('schema-mismatch', "records must be an array (discoverCompiledSnapshotCoverage()'s records)");
    }
    if (!Array.isArray(declaredNoEmitSources)) {
        fail('schema-mismatch', 'declaredNoEmitSources must be an array of src/**/*.ts paths');
    }

    const discoveredSources = new Set(records.map(record => record.sourcePath));

    const declaredNoEmitSet = new Set();
    for (const declared of declaredNoEmitSources) {
        if (
            typeof declared !== 'string' ||
            !declared.startsWith('src/') ||
            !declared.endsWith('.ts') ||
            declared.endsWith('.d.ts')
        ) {
            fail(
                'schema-mismatch',
                `declaredNoEmitSources entry "${declared}" is not a repo-relative src/**/*.ts (excluding .d.ts) path`,
            );
        }
        if (declaredNoEmitSet.has(declared)) {
            fail('schema-mismatch', `declaredNoEmitSources lists "${declared}" more than once`);
        }
        declaredNoEmitSet.add(declared);
        if (discoveredSources.has(declared)) {
            fail(
                'no-emit-mismatch',
                `"${declared}" is declared in declaredNoEmitSources but has a discovered compiled-snapshot record`,
            );
        }
    }

    const sourceRoot = resolve(repositoryRoot, 'src');
    const allSourcePaths = existsSync(sourceRoot)
        ? walkSourceFiles(sourceRoot)
              .map(absolutePath => repoRelativeSrcPath(absolutePath, repositoryRoot))
              .filter(sourcePath => sourcePath !== null)
              .sort()
        : [];
    const allSourceSet = new Set(allSourcePaths);

    for (const declared of declaredNoEmitSet) {
        if (!allSourceSet.has(declared)) {
            fail(
                'schema-mismatch',
                `declaredNoEmitSources entry "${declared}" does not correspond to a real file under ${sourceRoot}`,
            );
        }
    }

    const noEmitRecords = [];
    for (const sourcePath of allSourcePaths) {
        if (discoveredSources.has(sourcePath)) {
            continue;
        }
        if (!declaredNoEmitSet.has(sourcePath)) {
            fail(
                'undeclared-no-emit-source',
                `"${sourcePath}" has no discovered compiled-snapshot record and is not declared in declaredNoEmitSources`,
            );
        }
        noEmitRecords.push(Object.freeze({ entries: Object.freeze([]), noEmit: true, sourcePath }));
    }

    return Object.freeze({ records: Object.freeze([...records, ...noEmitRecords]) });
}

/**
 * Converts
 * `discoverCompiledSnapshotCoverage`'s `records` into a standard Istanbul `coverage-final.json`
 * coverage map -- `{ [sourcePath]: FileCoverage }`, one entry per record, keyed by `sourcePath`. Each
 * record's already-converted `entries` become `statementMap`/`s` (see the module doc above: this
 * converter counts each V8 range as one entry and does not derive real Istanbul branches from it), and
 * its `branchEntries` become
 * `branchMap`/`b` -- each branch-outcome entry becomes its own single-location `branchMap` entry (one
 * outcome, not a grouped multi-arm decision: V8's raw ranges carry no explicit grouping of which
 * outcomes belong to the same `if`/`switch`/logical-operator decision, so this converter does not guess
 * one) with `b[id]` a one-element array holding that outcome's own hit count. A record with no
 * `branchEntries` (absent field, e.g. a `verifyTotalSourcePopulation` no-emit entry) contributes an
 * empty `branchMap`/`b`, exactly like its empty `entries`; `fnMap`/`f` stay always empty, never a
 * placeholder guess at function shape.
 *
 * Pure and synchronous: no filesystem access, no binding/digest metadata of any kind. Digest binding
 * (tree/roster/snapshot/raw-dump/converter identity) is handled separately by
 * `writeCanonicalCoverageArtifacts` below (a sibling `coverage-final.binding.json`, never fields
 * added to this map) -- this function only
 * fixes the "converter records -> standard Istanbul shape" boundary.
 */
export function toCoverageFinalMap(records) {
    if (!Array.isArray(records)) {
        fail('schema-mismatch', "records must be an array (discoverCompiledSnapshotCoverage()'s records)");
    }
    const coverageMap = {};
    for (const record of records) {
        // discoverCompiledSnapshotCoverage's
        // own duplicate check permits two *consistent* snapshot roots (e.g. one dist tree per Vitest
        // worker) to each resolve the same relative script path to the same sourcePath -- exactly the
        // multi-snapshot shape the module doc requires supporting. Keying this map by sourcePath alone
        // would let the second record silently overwrite the first and drop real coverage. Reject
        // instead of guessing how to merge -- no merge strategy is defined.
        if (Object.hasOwn(coverageMap, record.sourcePath)) {
            fail(
                'duplicate-source-across-snapshots',
                `"${record.sourcePath}" has coverage records from more than one snapshot root (e.g. "${record.snapshotRoot}"); merging or picking one would silently misreport coverage`,
            );
        }
        const statementMap = {};
        const s = {};
        // Partial shard union: the map key itself carries this entry's compiled-range
        // identity (`startOffset:endOffset`, see `convertRange` above) instead of its position in
        // `record.entries` -- a shard-local array index is neither stable (the same physical range can
        // land at a different index depending on which subset of ranges a shard's own tests executed)
        // nor unique when the mapped position degenerates. `flattenAndValidateRecordRanges` already
        // guarantees no two ranges in the same record share a `(startOffset, endOffset)` pair, so this
        // key is unique within one file's entries the same way the old sequential index was.
        record.entries.forEach(entry => {
            const id = `${entry.startOffset}:${entry.endOffset}`;
            statementMap[id] = { end: entry.end, start: entry.start };
            s[id] = entry.count;
        });
        const branchMap = {};
        const b = {};
        (record.branchEntries ?? []).forEach(entry => {
            const id = `${entry.startOffset}:${entry.endOffset}`;
            const loc = { end: entry.end, start: entry.start };
            branchMap[id] = { loc, locations: [loc], type: 'branch' };
            b[id] = [entry.count];
        });
        coverageMap[record.sourcePath] = {
            b,
            branchMap,
            f: {},
            fnMap: {},
            path: record.sourcePath,
            s,
            statementMap,
        };
    }
    return coverageMap;
}

/**
 * Computes C0
 * (statement) / C1 (branch) percentages from a `toCoverageFinalMap`-shaped coverage map -- the exact
 * basis `writeCanonicalCoverageArtifacts` writes -- so a caller can judge the converter's own output,
 * not the built-in v8 provider's. Pure and synchronous.
 *
 * Statements: an empty map, or a map whose files carry zero statement entries, reports 0%, never a
 * vacuous 100% -- that is exactly the "old all-zero report accepted as success" failure mode this
 * module exists to prevent.
 *
 * Branches: `toCoverageFinalMap`
 * derives real `branchMap`/`b` entries from each record's `branchEntries` (see that function's own
 * doc), so an empty branch population across every file is not a by-design converter
 * scope limit -- it is exactly as suspicious as an empty statement population, and reports 0%, never a
 * vacuous 100%, for the same "old all-zero report accepted as success" reason. A single file with
 * genuinely no branches (straight-line code) still contributes 0 to both `branchesTotal` and
 * `branchesCovered` without being penalized -- see `uncoveredFiles` below, which only flags a file whose
 * covered count is strictly less than its own total.
 *
 * Returns `{ statementsTotal, statementsCovered, statementsPercent, branchesTotal, branchesCovered,
 * branchesPercent, uncoveredFiles }` -- `uncoveredFiles` lists every `sourcePath` with at least one
 * uncovered statement or branch outcome, sorted, for a caller's diagnostic message.
 */
export function summarizeCoverage(coverageMap) {
    if (typeof coverageMap !== 'object' || coverageMap === null || Array.isArray(coverageMap)) {
        fail('schema-mismatch', "coverageMap must be a plain object (toCoverageFinalMap()'s output)");
    }
    let statementsTotal = 0;
    let statementsCovered = 0;
    let branchesTotal = 0;
    let branchesCovered = 0;
    const uncoveredFiles = [];
    for (const [sourcePath, fileCoverage] of Object.entries(coverageMap)) {
        const statementCounts = Object.values(fileCoverage.s ?? {});
        const fileStatementsTotal = statementCounts.length;
        const fileStatementsCovered = statementCounts.filter(count => count > 0).length;
        statementsTotal += fileStatementsTotal;
        statementsCovered += fileStatementsCovered;

        const branchOutcomeCounts = Object.values(fileCoverage.b ?? {}).flat();
        const fileBranchesTotal = branchOutcomeCounts.length;
        const fileBranchesCovered = branchOutcomeCounts.filter(count => count > 0).length;
        branchesTotal += fileBranchesTotal;
        branchesCovered += fileBranchesCovered;

        if (fileStatementsCovered < fileStatementsTotal || fileBranchesCovered < fileBranchesTotal) {
            uncoveredFiles.push(sourcePath);
        }
    }
    return Object.freeze({
        branchesCovered,
        branchesPercent: branchesTotal === 0 ? 0 : (branchesCovered / branchesTotal) * 100,
        branchesTotal,
        statementsCovered,
        statementsPercent: statementsTotal === 0 ? 0 : (statementsCovered / statementsTotal) * 100,
        statementsTotal,
        uncoveredFiles: Object.freeze(uncoveredFiles.sort()),
    });
}

export const CANONICAL_COVERAGE_DIRECTORY_SEGMENTS = Object.freeze(['test', 'server', '.artifacts', 'coverage']);
export const COVERAGE_FINAL_FILE_NAME = 'coverage-final.json';
export const COVERAGE_FINAL_BINDING_FILE_NAME = 'coverage-final.binding.json';
/**
 * Sidecar `writeCanonicalCoverageArtifacts` writes alongside `coverage-final.json`, carrying two distinct
 * undercounting diagnostics from this run's own `discoverCompiledSnapshotCoverage` return value; neither
 * one has room in `coverage-final.json` itself (both, by definition, contributed nothing to it) so without
 * this sidecar they are invisible downstream:
 *   - `excludedRecordCount`/`excludedRecords` (`excludedRecordDiagnostics`): a whole raw record excluded
 *     as unverifiable, and which script it belonged to.
 *   - `functionGranularityExclusionCount`/`functionGranularityExclusions`: a finer-grained case within an
 *     otherwise-verified record -- one specific function whose own innermost-containing range was
 *     `isBlockCoverage: false` with a positive count (function-invocation-only evidence, no block detail)
 *     for some statement/branch query (see `countForSpanStart`'s own doc) -- naming the script, function,
 *     and dump file/pid.
 * `run-coverage-gate-cli.mjs` reads this file (best-effort -- its absence, e.g. from a coverage-final.json
 * produced without this sidecar, means zero of both, not a missing-file error) and folds both into
 * `coverage-gate-report.json`, never as a gate failure on their own.
 */
export const COVERAGE_EXCLUDED_RECORDS_FILE_NAME = 'coverage-excluded-records.json';
export const COMPILED_SNAPSHOT_COVERAGE_CONVERTER_VERSION = 'wp2.2-v8-range-to-istanbul-statement-2';

/** sha256 over `<fileName>:<sha256 of that file's bytes>` for every `*.json` file directly under `directoryPath`, sorted by file name -- a deterministic digest of a `NODE_V8_COVERAGE`-style raw dump directory's contents. */
async function sha256OfRawCoverageDirectory(directoryPath) {
    const fileNames = (await readdir(directoryPath, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name)
        .sort();
    const perFileDigests = [];
    for (const fileName of fileNames) {
        const bytes = await readFile(join(directoryPath, fileName));
        perFileDigests.push(`${fileName}:${sha256Hex(bytes)}`);
    }
    return sha256Hex(perFileDigests.join('\n'));
}

/**
 * Atomically (create-exclusive temp file + fsync + rename) persists JSON to `<directory>/<fileName>`,
 * Returns the exact bytes
 * written.
 *
 * If `open`,
 * `writeFile`, `sync`, or `rename` fails partway through, the create-exclusive temp file is removed
 * (`rm(..., { force: true })`, safe even if it was never created) before the error propagates -- the
 * canonical directory never accumulates leftover `.<fileName>.<uuid>.tmp` files from a failed write.
 */
async function atomicWriteJsonFile(directory, fileName, payload) {
    const target = join(directory, fileName);
    const temporary = join(directory, `.${fileName}.${randomUUID()}.tmp`);
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 4)}\n`, 'utf8');
    try {
        const handle = await open(temporary, 'wx');
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(temporary, target);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
    return bytes;
}

/**
 * The value the run-local isolated runtime identity registry is matched against: the measured content's
 * tree id, or `'unrecorded'` when git could not provide one. Both writer (test child) and reader
 * (`writeCanonicalCoverageArtifacts`) of one run derive it from the same record, so it only has to be
 * consistent within the run.
 */
export function coverageIdentityTreeDigest(worktreeContent) {
    return typeof worktreeContent?.contentTree === 'string' && worktreeContent.contentTree.length > 0
        ? worktreeContent.contentTree
        : 'unrecorded';
}

function validateWorktreeContent(worktreeContent) {
    const isTreeOrNull = value => value === null || (typeof value === 'string' && value.length > 0);
    if (
        worktreeContent === null ||
        typeof worktreeContent !== 'object' ||
        !isTreeOrNull(worktreeContent.contentTree) ||
        !isTreeOrNull(worktreeContent.headTree) ||
        (worktreeContent.uncommittedChanges !== null && typeof worktreeContent.uncommittedChanges !== 'boolean')
    ) {
        fail(
            'schema-mismatch',
            'worktreeContent must be { contentTree, headTree, uncommittedChanges } with tree ids as non-empty strings or null and uncommittedChanges as a boolean or null',
        );
    }
    return {
        contentTree: worktreeContent.contentTree,
        headTree: worktreeContent.headTree,
        uncommittedChanges: worktreeContent.uncommittedChanges,
    };
}

/**
 * Discovers and converts this run's compiled-snapshot coverage, atomically writes the canonical,
 * plain Istanbul `coverage-final.json` (via `toCoverageFinalMap` -- no added fields, so existing
 * standard-shape readers keep working unchanged), then immediately atomically writes a sibling
 * `coverage-final.binding.json` sidecar binding it to this run's identity: a sha256 of the
 * `coverage-final.json` file's own just-written bytes plus the caller-supplied `worktreeContent`
 * record, a digest of `testRoster`, one digest per resolved `snapshotRoots` entry, a digest of the raw
 * `NODE_V8_COVERAGE` dump directory's contents, and this converter's version string -- exactly the
 * six fields listed above, nothing else (`sha256Hex` is this module's own SHA-256 helper). Never reads a pre-existing `coverage-final.json`/`coverage-final.binding.json`
 * as input: both are always freshly (re)computed from `records` and atomically replace whatever was
 * on disk. A third sidecar, `COVERAGE_EXCLUDED_RECORDS_FILE_NAME` (see its own doc), is written the same
 * way with this run's `excludedRecordDiagnostics` -- undercounting visibility for a caller such as
 * `run-coverage-gate-cli.mjs` that only reads `coverage-final.json` back from disk and would otherwise
 * have no way to see that some raw evidence was excluded.
 *
 * Fails closed, before writing anything, when `worktreeContent` is malformed (`schema-mismatch`) or
 * `testRoster` -- required for the binding record -- is missing (`missing-binding-digest`).
 * `discoverCompiledSnapshotCoverage`'s own fail-closed rules (missing raw/map/source, snapshotRoots
 * schema) still apply first.
 *
 * `discoverCompiledSnapshotCoverage`'s
 * records are then passed through `verifyTotalSourcePopulation` before conversion -- every real
 * `src/**\/*.ts` file under `repositoryRoot` must already have a discovered record or be named in
 * `declaredNoEmitSources` (default `[]`, caller-supplied), or the whole call fails closed
 * (`undeclared-no-emit-source` / `no-emit-mismatch` / `schema-mismatch`; see that function's own doc).
 * With no caller-supplied `declaredNoEmitSources`, any real no-emit source in `repositoryRoot` fails
 * this call closed rather than silently vanishing from the coverage-final map -- this module does not
 * maintain or infer that list itself.
 *
 * `worktreeContent` (required record, caller-supplied; see `scripts/server-test/worktree-content.mjs`):
 * `{ contentTree, headTree, uncommittedChanges }`, each field a string/boolean or `null` when git could
 * not provide it. It states which content was measured and is written verbatim to the binding sidecar;
 * the verdict never depends on it, so uncommitted changes and an unavailable git do not fail this call.
 * The run-local isolated runtime identity registry is matched against `coverageIdentityTreeDigest(
 * worktreeContent)`, the same value the caller exports to the test child's environment. This module
 * never runs `git` itself (kept dependency-free of child_process, matching the rest of the file).
 *
 * Under
 * `EPGSTATION_COVERAGE_CONVERTER`, the built-in v8 provider still writes its own `coverage-final.json`
 * into this same canonical directory before this function ever runs (its reporter narrows to
 * `['json']`, not `[]`). The success path already overwrites it fresh. On ANY fail-closed rejection
 * here -- including the early checks above, before anything in this function has written a byte --
 * that provider-written file (and any stale sidecar from a previous run) is removed on a best-effort
 * basis so a downstream reader never observes an un-bound `coverage-final.json`. Cleanup failure is
 * swallowed, never allowed to replace the real rejection reason.
 */
export async function writeCanonicalCoverageArtifacts({
    snapshotRoots,
    rawCoverageDir,
    repositoryRoot = process.cwd(),
    testRoster,
    worktreeContent,
    directory,
    identityRegistryDir,
    runScope,
    declaredNoEmitSources = [],
    transformCaptureDir,
} = {}) {
    const targetDirectory = directory ?? resolve(repositoryRoot, ...CANONICAL_COVERAGE_DIRECTORY_SEGMENTS);
    try {
        const recordedWorktreeContent = validateWorktreeContent(worktreeContent);
        const treeDigest = coverageIdentityTreeDigest(recordedWorktreeContent);
        if (!Array.isArray(testRoster) || testRoster.length === 0) {
            fail('missing-binding-digest', 'testRoster must be a non-empty array of test file locators');
        }

        const {
            records: discoveredRecords,
            excludedRecordDiagnostics,
            functionGranularityExclusions,
        } = discoverCompiledSnapshotCoverage({
            rawCoverageDir,
            repositoryRoot,
            snapshotRoots,
            identityRegistryDir,
            runScope,
            treeDigest,
            transformCaptureDir,
        });
        const { records } = verifyTotalSourcePopulation({
            declaredNoEmitSources,
            records: discoveredRecords,
            repositoryRoot,
        });
        const coverageMap = toCoverageFinalMap(records);

        await mkdir(targetDirectory, { recursive: true });

        const coverageFinalBytes = await atomicWriteJsonFile(targetDirectory, COVERAGE_FINAL_FILE_NAME, coverageMap);
        const coverageFinalSha256 = sha256Hex(coverageFinalBytes);
        // Undercounting visibility (see `COVERAGE_EXCLUDED_RECORDS_FILE_NAME`'s own doc): every excluded
        // raw record this run hit, and which script it belonged to, written even when the array is empty
        // so a reader can tell "no exclusions" apart from "sidecar never written". Also carries
        // `functionGranularityExclusions` (see `makeFunctionGranularityExclusionReporter`'s own doc): a
        // finer-grained undercounting signal than a whole excluded record -- one specific function's
        // isBlockCoverage:false-with-positive-count range in an otherwise-verified record, contributing 0
        // for spans inside it while the rest of that same record still counts normally.
        await atomicWriteJsonFile(targetDirectory, COVERAGE_EXCLUDED_RECORDS_FILE_NAME, {
            excludedRecordCount: excludedRecordDiagnostics.length,
            excludedRecords: excludedRecordDiagnostics,
            functionGranularityExclusionCount: functionGranularityExclusions.length,
            functionGranularityExclusions,
        });

        const resolvedSnapshotRoots = [...new Set(snapshotRoots.map(root => resolve(root)))].sort();
        const snapshotDigests = resolvedSnapshotRoots.map(root =>
            sha256Hex(
                JSON.stringify(
                    records
                        .filter(record => record.snapshotRoot === root)
                        .map(record => `${record.relativeScriptPath}:${record.sourcePath}`)
                        .sort(),
                ),
            ),
        );
        const testRosterDigest = sha256Hex(JSON.stringify([...testRoster].sort()));
        const rawDumpDigest = await sha256OfRawCoverageDirectory(rawCoverageDir);

        const binding = Object.freeze({
            coverageFinalSha256,
            worktreeContent: recordedWorktreeContent,
            testRosterDigest,
            snapshotDigests,
            rawDumpDigest,
            converterVersion: COMPILED_SNAPSHOT_COVERAGE_CONVERTER_VERSION,
        });
        await atomicWriteJsonFile(targetDirectory, COVERAGE_FINAL_BINDING_FILE_NAME, binding);

        return Object.freeze({
            binding,
            coverageMap: Object.freeze(coverageMap),
            excludedRecordDiagnostics: Object.freeze([...excludedRecordDiagnostics]),
            functionGranularityExclusions: Object.freeze([...functionGranularityExclusions]),
        });
    } catch (error) {
        await rm(join(targetDirectory, COVERAGE_FINAL_FILE_NAME), { force: true }).catch(() => {});
        await rm(join(targetDirectory, COVERAGE_FINAL_BINDING_FILE_NAME), { force: true }).catch(() => {});
        await rm(join(targetDirectory, COVERAGE_EXCLUDED_RECORDS_FILE_NAME), { force: true }).catch(() => {});
        throw error;
    }
}
