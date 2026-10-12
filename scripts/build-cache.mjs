// Content-addressed build cache for the EPGStation server TypeScript build.
//
// Rationale: the mutable repository-root `dist/` directory is shared, uncoordinated build
// input/output if every server test and coverage consumer uses it. A test that spawns a real
// `run-tests.mjs` child process would rebuild that shared `dist/` (rm + tsc) while other,
// concurrently running test files copy from the very same `dist/`, which fails with
// `ENOENT: lstat 'dist'` under full-suite contention. This module replaces "root
// dist as shared mutable state" with an immutable, content-addressed cache: each unique build key
// gets its own directory under `test/server/.artifacts/build/<build-key>/dist` that, once
// published, is never mutated again. Consumers either read a validated cache entry directly or
// copy it into their own private snapshot; nothing reads or writes the mutable repository-root
// `dist/` anymore on this path. `npm run build-server` / `npm run compile` (plain `tsc`) are
// untouched and still populate root `dist/` for end users.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export const buildCacheContractVersion = '1';
export const manifestSchemaVersion = 1;
export const defaultCacheRoot = 'test/server/.artifacts/build';

const completeMarkerFile = 'COMPLETE';
const manifestFile = 'manifest.json';

export class BuildLockTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BuildLockTimeoutError';
    }
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

function sha256Hex(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

async function digestFile(path) {
    return sha256Hex(await readFile(path));
}

async function pathExists(path) {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

// Deterministic JSON serialization: recursively sorts object keys so that the same logical
// content always produces the same byte sequence for hashing, regardless of property insertion
// order. Arrays are left as-is (callers are responsible for sorting arrays whose order is not
// already canonical, e.g. by relative path).
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === 'object') {
        const sortedEntries = Object.keys(value)
            .sort()
            .map(key => [key, canonicalize(value[key])]);
        return Object.fromEntries(sortedEntries);
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function toPosixRelative(base, target) {
    return relative(base, target).split(sep).join('/');
}

// Resolves the tsconfig "extends" chain by hand (root config first). This repository's own
// tsconfig.json currently has no `extends`, so the chain is a single entry, but the walk is
// generic so a future `extends` addition is picked up automatically without code changes here.
async function resolveTsconfigChain(tsconfigPath) {
    const chain = [];
    const seen = new Set();
    let currentPath = resolve(tsconfigPath);
    while (currentPath !== undefined && !seen.has(currentPath)) {
        seen.add(currentPath);
        chain.push(currentPath);
        const raw = await readFile(currentPath, 'utf8');
        let parsed;
        try {
            parsed = ts.parseConfigFileTextToJson(currentPath, raw).config;
        } catch {
            parsed = {};
        }
        const extendsValue = parsed && typeof parsed === 'object' ? parsed.extends : undefined;
        if (typeof extendsValue !== 'string') {
            currentPath = undefined;
            continue;
        }
        currentPath = extendsValue.startsWith('.')
            ? resolve(dirname(currentPath), extendsValue.endsWith('.json') ? extendsValue : `${extendsValue}.json`)
            : undefined; // package-based extends is not used by this repository; not resolved here.
    }
    return chain;
}

async function resolvedTypeScriptVersion(repositoryRoot) {
    const packageJsonPath = join(repositoryRoot, 'package.json');
    const typeScriptPackageJsonPath = createRequire(packageJsonPath).resolve('typescript/package.json');
    const typeScriptPackageJson = JSON.parse(await readFile(typeScriptPackageJsonPath, 'utf8'));
    return typeScriptPackageJson.version;
}

// TypeScript's parsed compiler options resolve every path-shaped field (outDir, rootDir,
// declarationDir, baseUrl, typeRoots, rootDirs, paths, tsBuildInfoFile, outFile, ...) to an
// *absolute* path against `repositoryRoot` (the `basePath` passed to
// `ts.parseJsonConfigFileContent`). An absolute path is checkout-location dependent, which the
// build key must not contain: it would break key reproducibility across
// worktrees, and for an isolated candidate root (an `mkdtemp(...)` directory) it would leak that
// mkdtemp call's *random* temporary path straight into the key, defeating caching for every
// candidate even when its bytes are identical to one already built. Denylisting field names (e.g.
// stripping only `outDir`/`rootDir`) is fragile against TypeScript adding or resolving more
// path-shaped options over time, so this instead walks the *entire* parsed options value and
// rewrites every absolute-path string it finds -- at any nesting depth, including inside arrays
// (`typeRoots`, `rootDirs`, `moduleSuffixes` is not path-shaped but harmless to check) and record
// values (`paths`) -- to a `repositoryRoot`-relative POSIX path. `configFilePath` is dropped
// entirely rather than relativized: it is redundant with the tsconfig chain's own content digest
// and, unlike a compiler option, was never part of the declared configuration at all.
function relativizeAbsolutePaths(value, repositoryRoot) {
    if (typeof value === 'string') {
        return isAbsolute(value) ? toPosixRelative(repositoryRoot, value) : value;
    }
    if (Array.isArray(value)) {
        return value.map(entry => relativizeAbsolutePaths(entry, repositoryRoot));
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, relativizeAbsolutePaths(entry, repositoryRoot)]),
        );
    }
    return value;
}

function sanitizedCompilerOptions(options, repositoryRoot) {
    const { configFilePath: _configFilePath, ...rest } = options;
    return relativizeAbsolutePaths(rest, repositoryRoot);
}

async function enumerateProjectInputFiles(repositoryRoot, tsconfigPath) {
    const configPath = tsconfigPath ?? join(repositoryRoot, 'tsconfig.json');
    const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readResult.error !== undefined) {
        throw new Error(`Unable to read tsconfig at ${configPath}: ${readResult.error.messageText}`);
    }
    const parseConfigHost = {
        fileExists: ts.sys.fileExists,
        readDirectory: ts.sys.readDirectory,
        readFile: ts.sys.readFile,
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    };
    const parsed = ts.parseJsonConfigFileContent(readResult.config, parseConfigHost, repositoryRoot);
    if (parsed.errors.length > 0) {
        throw new Error(
            `Unable to parse tsconfig project input files: ${parsed.errors.map(error => error.messageText).join('; ')}`,
        );
    }
    return {
        configPath,
        options: sanitizedCompilerOptions(parsed.options, repositoryRoot),
        fileNames: parsed.fileNames,
    };
}

/**
 * Computes the full canonical build-key context: the file inventory, tsconfig chain, compiler
 * options, package manifests, TypeScript version, Node major version, and this module's own
 * contract version, all hashed into a single SHA-256 hex build key.
 *
 * Deliberately excluded from the key (they would make the key unstable): git HEAD/commit identity,
 * absolute filesystem paths, wall-clock time, process id, and any random temporary path. Included:
 * the *actual on-disk bytes* of every project input file under the given repositoryRoot, so
 * staged and unstaged edits are all reflected without relying on git state.
 */
export async function computeBuildKeyContext(options = {}) {
    const repositoryRoot = resolve(options.repositoryRoot ?? '.');
    const {
        configPath,
        options: compilerOptions,
        fileNames,
    } = await enumerateProjectInputFiles(repositoryRoot, options.tsconfigPath);
    const tsconfigChainPaths = await resolveTsconfigChain(configPath);
    const [tsconfigChain, sourceFiles, packageJsonDigest, packageLockDigest, typescriptVersion] = await Promise.all([
        Promise.all(
            tsconfigChainPaths.map(async chainPath => ({
                path: toPosixRelative(repositoryRoot, chainPath),
                sha256: await digestFile(chainPath),
            })),
        ),
        Promise.all(
            fileNames.map(async fileName => {
                const fileStat = await stat(fileName);
                return {
                    path: toPosixRelative(repositoryRoot, fileName),
                    mode: fileStat.mode & 0o777,
                    size: fileStat.size,
                    sha256: await digestFile(fileName),
                };
            }),
        ),
        digestFile(join(repositoryRoot, 'package.json')),
        pathExists(join(repositoryRoot, 'package-lock.json')).then(exists =>
            exists ? digestFile(join(repositoryRoot, 'package-lock.json')) : null,
        ),
        resolvedTypeScriptVersion(repositoryRoot),
    ]);
    sourceFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    tsconfigChain.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const canonicalManifest = {
        buildCacheContractVersion,
        compilerOptions,
        nodeMajor,
        packageJsonDigest,
        packageLockDigest,
        sourceFiles,
        tsconfigChain,
        typescriptVersion,
    };
    const buildKey = sha256Hex(Buffer.from(canonicalJson(canonicalManifest), 'utf8'));
    return { buildKey, canonicalManifest, nodeMajor, repositoryRoot, typescriptVersion };
}

export async function computeBuildKey(options = {}) {
    return (await computeBuildKeyContext(options)).buildKey;
}

export function resolveCachePaths(options = {}) {
    const repositoryRoot = resolve(options.repositoryRoot ?? '.');
    const cacheBase = resolve(repositoryRoot, options.cacheRoot ?? defaultCacheRoot);
    return {
        cacheBase,
        locksDir: join(cacheBase, '.locks'),
        repositoryRoot,
    };
}

async function walkEntries(root, directory = root, results = []) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return results;
        throw error;
    }
    for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            results.push({ path: toPosixRelative(root, fullPath), type: 'symlink' });
        } else if (entry.isDirectory()) {
            await walkEntries(root, fullPath, results);
        } else if (entry.isFile()) {
            results.push({ path: toPosixRelative(root, fullPath), type: 'file' });
        } else {
            results.push({ path: toPosixRelative(root, fullPath), type: 'other' });
        }
    }
    return results;
}

async function collectOutputInventory(distDir) {
    const entries = await walkEntries(distDir);
    const symlink = entries.find(entry => entry.type === 'symlink');
    if (symlink !== undefined) {
        throw new Error(`Build cache population produced an unexpected symlink: ${symlink.path}`);
    }
    const other = entries.find(entry => entry.type === 'other');
    if (other !== undefined) {
        throw new Error(`Build cache population produced an unexpected non-regular file: ${other.path}`);
    }
    const outputs = await Promise.all(
        entries.map(async entry => {
            const fullPath = join(distDir, ...entry.path.split('/'));
            const fileStat = await stat(fullPath);
            return { path: entry.path, sha256: await digestFile(fullPath), size: fileStat.size };
        }),
    );
    outputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return outputs;
}

/**
 * Manifest-level half of `validateCachedDist`: complete marker, manifest schema, contract version,
 * build key identity (both `expected.buildKey` and the entry directory name), Node / TypeScript
 * identity, and marker content. Reads only `manifest.json` and the complete marker, never the
 * `dist/` outputs, so its cost does not grow with the size of an entry.
 */
async function validateCachedManifest({ entryDir, expected }) {
    const markerPath = join(entryDir, completeMarkerFile);
    const manifestPath = join(entryDir, manifestFile);

    if (!(await pathExists(markerPath))) return { reason: 'missing-complete-marker', valid: false };
    if (!(await pathExists(manifestPath))) return { reason: 'missing-manifest', valid: false };

    let manifest;
    try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
        return { reason: 'invalid-manifest-json', valid: false };
    }
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { reason: 'invalid-manifest-schema', valid: false };
    }
    for (const field of ['schemaVersion', 'buildId', 'contractVersion', 'nodeMajor', 'typescriptVersion', 'outputs']) {
        if (!(field in manifest)) return { reason: `manifest-missing-field:${field}`, valid: false };
    }
    if (!Array.isArray(manifest.outputs)) return { reason: 'manifest-outputs-not-array', valid: false };
    if (manifest.schemaVersion !== manifestSchemaVersion) return { reason: 'manifest-schema-mismatch', valid: false };
    if (manifest.contractVersion !== buildCacheContractVersion) {
        return { reason: 'contract-version-mismatch', valid: false };
    }
    if (expected?.buildKey !== undefined && manifest.buildId !== expected.buildKey) {
        return { reason: 'build-key-mismatch', valid: false };
    }
    // Unconditional, independent of `expected`: any entry directory whose name is itself a
    // published build key (the 64-hex-character form every real published entry uses; staging
    // directories are named `.tmp-...` and never match this, so they are unaffected) must have a
    // manifest that agrees with that name. This closes the exact-build-key gap even for a caller
    // that passes a loose or missing `expected` -- a directory that was renamed, restored from an
    // unrelated cache, or otherwise made to hold content for a different key than its own name
    // claims must never be treated as valid, regardless of what the caller asked to cross-check.
    if (/^[0-9a-f]{64}$/u.test(basename(entryDir)) && manifest.buildId !== basename(entryDir)) {
        return { reason: 'build-key-mismatch', valid: false };
    }
    if (expected?.nodeMajor !== undefined && manifest.nodeMajor !== expected.nodeMajor) {
        return { reason: 'node-major-mismatch', valid: false };
    }
    if (expected?.typescriptVersion !== undefined && manifest.typescriptVersion !== expected.typescriptVersion) {
        return { reason: 'typescript-version-mismatch', valid: false };
    }

    let markerContent;
    try {
        markerContent = (await readFile(markerPath, 'utf8')).trim();
    } catch {
        return { reason: 'unreadable-complete-marker', valid: false };
    }
    if (markerContent !== manifest.buildId) return { reason: 'complete-marker-mismatch', valid: false };
    return { manifest, valid: true };
}

/**
 * Validates a build cache entry directory against an expected build key. Never throws for
 * ordinary invalidity (missing, incomplete, mismatched, or tampered); returns
 * `{ valid: false, reason }` instead so callers can decide what to do (typically: rebuild).
 * Requires ALL of: exact build key match, complete marker, manifest schema match, TypeScript /
 * Node / compiler-options match, full required-output-inventory match (path + size + sha256), and
 * zero unexpected files or symlinks anywhere under `dist/`.
 */
export async function validateCachedDist(options) {
    const { entryDir, expected } = options;
    const distDir = join(entryDir, 'dist');

    const manifestCheck = await validateCachedManifest({ entryDir, expected });
    if (!manifestCheck.valid) return manifestCheck;
    const { manifest } = manifestCheck;

    if (!(await pathExists(distDir))) return { reason: 'missing-dist-directory', valid: false };

    let actualEntries;
    try {
        actualEntries = await walkEntries(distDir);
    } catch {
        return { reason: 'unreadable-dist-directory', valid: false };
    }
    if (actualEntries.some(entry => entry.type === 'symlink')) return { reason: 'unexpected-symlink', valid: false };
    if (actualEntries.some(entry => entry.type === 'other')) return { reason: 'unexpected-file-type', valid: false };

    const actualByPath = new Map(actualEntries.map(entry => [entry.path, entry]));
    for (const output of manifest.outputs) {
        if (typeof output.path !== 'string' || typeof output.sha256 !== 'string' || typeof output.size !== 'number') {
            return { reason: 'manifest-output-entry-invalid', valid: false };
        }
        if (!actualByPath.has(output.path)) return { reason: `missing-output:${output.path}`, valid: false };
        actualByPath.delete(output.path);
        const fullPath = join(distDir, ...output.path.split('/'));
        let fileStat;
        try {
            fileStat = await stat(fullPath);
        } catch {
            return { reason: `unreadable-output:${output.path}`, valid: false };
        }
        if (fileStat.size !== output.size) return { reason: `size-mismatch:${output.path}`, valid: false };
        let digest;
        try {
            digest = await digestFile(fullPath);
        } catch {
            return { reason: `unreadable-output:${output.path}`, valid: false };
        }
        if (digest !== output.sha256) return { reason: `digest-mismatch:${output.path}`, valid: false };
    }
    if (actualByPath.size > 0) {
        return { reason: `unexpected-file:${[...actualByPath.keys()].sort()[0]}`, valid: false };
    }

    return { manifest, valid: true };
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code !== 'ESRCH';
    }
}

// A lock is only ever reclaimed under a *bounded* determination, never unconditionally:
//   - owner metadata missing/corrupt: bounded by the lock directory's own mtime.
//   - same host, owner process confirmed dead (ESRCH): bounded by a short grace period, to avoid
//     racing a just-started owner whose owner.json write has not yet landed.
//   - same host, owner process alive: never reclaimed here regardless of age; a caller waiting on
//     it will hit its own `lockTimeoutMs` and fail closed (throw) instead of barging in.
//   - different host: liveness cannot be checked at all, so this is the only case that falls back
//     to a pure time bound (still bounded, just the best signal available).
async function isLockStale(lockDir, { now, staleLockMs }) {
    const graceMs = Math.min(2000, staleLockMs);
    let ownerInfo;
    try {
        ownerInfo = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
    } catch {
        try {
            const lockStat = await stat(lockDir);
            return now() - lockStat.mtimeMs > staleLockMs;
        } catch {
            return false;
        }
    }
    if (
        typeof ownerInfo !== 'object' ||
        ownerInfo === null ||
        typeof ownerInfo.pid !== 'number' ||
        typeof ownerInfo.hostname !== 'string' ||
        typeof ownerInfo.acquiredAt !== 'number'
    ) {
        try {
            const lockStat = await stat(lockDir);
            return now() - lockStat.mtimeMs > staleLockMs;
        } catch {
            return false;
        }
    }
    const age = now() - ownerInfo.acquiredAt;
    if (ownerInfo.hostname !== hostname()) {
        return age > staleLockMs;
    }
    if (!isProcessAlive(ownerInfo.pid)) {
        return age > graceMs;
    }
    return false;
}

async function tryReclaimStaleLock(lockDir) {
    const graveyard = `${lockDir}.stale-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
        await rename(lockDir, graveyard);
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
    await rm(graveyard, { force: true, recursive: true });
    return true;
}

/**
 * Acquires a single-flight, per-build-key lock (a plain, portable `mkdir`-based mutex: `mkdir`
 * without `recursive` is an atomic exclusive create, so exactly one concurrent caller wins per
 * key). Different keys never contend with each other's locks, so builds for different keys always
 * proceed concurrently. Blocks (polling with backoff) until the lock is free, a stale lock is
 * safely reclaimed, or `lockTimeoutMs` elapses -- in the last case this throws
 * `BuildLockTimeoutError` (fail closed) rather than silently proceeding.
 */
export async function acquireBuildLock(options) {
    const {
        key,
        locksDir,
        lockTimeoutMs = 15 * 60 * 1000,
        now = () => Date.now(),
        owner = { hostname: hostname(), pid: process.pid },
        pollIntervalMs = 25,
        staleLockMs = 10 * 60 * 1000,
    } = options;
    await mkdir(locksDir, { recursive: true });
    const lockDir = join(locksDir, key);
    const deadline = now() + lockTimeoutMs;
    for (;;) {
        try {
            await mkdir(lockDir);
            await writeFile(
                join(lockDir, 'owner.json'),
                JSON.stringify({ acquiredAt: now(), hostname: owner.hostname, pid: owner.pid }),
            );
            return {
                release: async () => rm(lockDir, { force: true, recursive: true }),
            };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        if (await isLockStale(lockDir, { now, staleLockMs })) {
            const reclaimed = await tryReclaimStaleLock(lockDir);
            if (reclaimed) continue;
        }
        if (now() >= deadline) {
            throw new BuildLockTimeoutError(`Timed out waiting for build cache lock: ${key}`);
        }
        await sleep(pollIntervalMs);
    }
}

async function defaultCompile({ outDir, repositoryRoot, tsconfigPath }) {
    const configPath = tsconfigPath ?? join(repositoryRoot, 'tsconfig.json');
    const tscPath = createRequire(join(repositoryRoot, 'package.json')).resolve('typescript/bin/tsc');
    await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [tscPath, '--project', configPath, '--outDir', outDir], {
            cwd: repositoryRoot,
            stdio: 'inherit',
        });
        child.once('error', rejectPromise);
        child.once('exit', (code, signal) => {
            if (signal !== null) {
                rejectPromise(new Error(`tsc terminated by ${signal}`));
                return;
            }
            if (code !== 0) {
                rejectPromise(new Error(`tsc exited with status ${code ?? 'unknown'}`));
                return;
            }
            resolvePromise();
        });
    });
}

async function publish(tempDir, entryDir, expected, attemptsRemaining = 3) {
    try {
        await rename(tempDir, entryDir);
        return;
    } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
    }
    // Under our own single-flight lock for this exact key we are the sole authorized writer, so a
    // pre-existing INVALID entry at the destination (e.g. left by a process that crashed before
    // this module existed, or a tampered/corrupted entry) may be safely replaced -- this is never
    // an unconditional deletion of an unowned or ambiguous entry, only a lock-protected
    // replacement of a positively-invalidated entry for the key we are actively building.
    //
    // `expected` MUST be forwarded here (not `{}`): validateCachedDist only cross-checks
    // manifest.buildId against `expected.buildKey` when that field is present, so an empty
    // `expected` would accept an existing entry whose *content* was built for a completely
    // different key, discard our correctly-built temp directory, and silently serve the wrong
    // compiled server to every consumer under this directory name. See also the unconditional
    // manifest.buildId === basename(entryDir) check inside validateCachedDist itself, which
    // closes the same gap even for callers that pass a loose or missing `expected`.
    const existing = await validateCachedDist({ entryDir, expected });
    if (existing.valid) {
        await rm(tempDir, { force: true, recursive: true });
        return;
    }
    if (attemptsRemaining <= 0) {
        throw new Error(`Unable to publish build cache entry after repeated conflicts: ${entryDir}`);
    }
    await rm(entryDir, { force: true, recursive: true });
    await publish(tempDir, entryDir, expected, attemptsRemaining - 1);
}

/**
 * Returns the absolute path to a validated, immutable cached `dist/` directory for the current
 * project input bytes under `repositoryRoot`, building it if necessary. Never reads from or
 * writes to the mutable repository-root `dist/` directory. Safe for concurrent callers across
 * processes: single-flight per build key, different keys build concurrently, and a cache hit from
 * another process that published while this call was waiting on the lock is honored without
 * rebuilding.
 *
 * `failClosedOnMiss: true` throws instead of building when there is no already-valid cache entry
 * (for consumer modes that must never trigger a build, e.g. a "must already be built" gate).
 */
async function removeSchemaInvalidHexEntries(cacheBase, keepKey, options = {}) {
    const locksDir = options.locksDir ?? join(cacheBase, '.locks');
    let entries;
    try {
        entries = await readdir(cacheBase, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^[0-9a-f]{64}$/u.test(entry.name) || entry.name === keepKey) {
            continue;
        }
        const entryDir = join(cacheBase, entry.name);
        // Manifest-level only: this sweep runs on every cache hit over every sibling entry, and the
        // cache keeps one entry per source state it has ever seen. Digesting every output of every
        // sibling made each hit cost O(entries x dist size) -- about 60ms per entry, 5s at 89
        // entries -- for entries this call is not going to serve. A sibling with schema-valid
        // manifest but tampered outputs is left in place; it is never served without the full
        // `validateCachedDist` check, which rejects and rebuilds it when its key is requested.
        const validation = await validateCachedManifest({
            entryDir,
            expected: { buildKey: entry.name },
        });
        if (validation.valid) {
            continue;
        }
        if (typeof options.beforeSiblingRemove === 'function') {
            await options.beforeSiblingRemove(entryDir);
        }
        const lock = await acquireBuildLock({
            key: entry.name,
            locksDir,
            lockTimeoutMs: options.lockTimeoutMs,
            now: options.now,
            owner: options.lockOwner,
            pollIntervalMs: options.lockPollIntervalMs,
            staleLockMs: options.staleLockMs,
        });
        try {
            const stAfterLock = await stat(entryDir).catch(error => {
                if (error && error.code === 'ENOENT') {
                    return null;
                }
                throw error;
            });
            if (stAfterLock === null) {
                continue;
            }
            const revalidated = await validateCachedManifest({
                entryDir,
                expected: { buildKey: entry.name },
            });
            if (revalidated.valid) {
                continue;
            }
            await rm(entryDir, { force: true, recursive: true });
        } finally {
            await lock.release();
        }
    }
}

export async function getOrBuildCachedDist(options = {}) {
    const repositoryRoot = resolve(options.repositoryRoot ?? '.');
    const { cacheBase, locksDir } = resolveCachePaths({ ...options, repositoryRoot });
    const compile = options.compile ?? defaultCompile;
    const now = options.now ?? (() => Date.now());
    const lockTimeoutMs = options.lockTimeoutMs;
    const staleLockMs = options.staleLockMs;

    const context = await computeBuildKeyContext({ repositoryRoot, tsconfigPath: options.tsconfigPath });
    const { buildKey } = context;
    const entryDir = join(cacheBase, buildKey);
    const distDir = join(entryDir, 'dist');
    const expected = { buildKey, nodeMajor: context.nodeMajor, typescriptVersion: context.typescriptVersion };

    const siblingCleanup = {
        locksDir,
        lockTimeoutMs,
        now,
        lockOwner: options.lockOwner,
        lockPollIntervalMs: options.lockPollIntervalMs,
        staleLockMs,
        beforeSiblingRemove: options.siblingCleanupBarrier,
    };
    const initial = await validateCachedDist({ entryDir, expected });
    if (initial.valid) {
        await removeSchemaInvalidHexEntries(cacheBase, buildKey, siblingCleanup);
        return distDir;
    }
    if (options.failClosedOnMiss === true) {
        throw new Error(
            `Build cache miss for key ${buildKey} while running in fail-closed consumer mode: ${initial.reason}`,
        );
    }

    const lock = await acquireBuildLock({
        key: buildKey,
        locksDir,
        lockTimeoutMs,
        now,
        owner: options.lockOwner,
        pollIntervalMs: options.lockPollIntervalMs,
        staleLockMs,
    });
    try {
        const revalidated = await validateCachedDist({ entryDir, expected });
        if (!revalidated.valid) {
            await mkdir(cacheBase, { recursive: true });
            // The staging directory is a direct sibling of the final `<build-key>` entry (both one
            // path segment under `cacheBase`), not nested under an extra `.tmp/` layer: TypeScript
            // bakes *relative* source-map paths (e.g. `../../src/util/Util.ts`) into compiled output
            // based on the staging directory's actual depth at compile time. If the staging directory
            // were nested one level deeper than the final published entry, every relative source map
            // would end up off-by-one (pointing outside the repository) once atomically published by
            // `rename()`, since `rename()` moves bytes without rewriting their contents. Keeping the
            // depths identical is what makes the atomic rename byte-for-byte safe for source maps.
            const tempDir = await mkdtemp(join(cacheBase, `.tmp-${buildKey.slice(0, 16)}-`));
            try {
                const tempDist = join(tempDir, 'dist');
                await compile({ outDir: tempDist, repositoryRoot, tsconfigPath: options.tsconfigPath });
                const outputs = await collectOutputInventory(tempDist);
                if (outputs.length === 0) {
                    throw new Error('Build cache population produced zero output files');
                }
                const manifest = {
                    buildId: buildKey,
                    contractVersion: buildCacheContractVersion,
                    createdAt: new Date(now()).toISOString(),
                    nodeMajor: context.nodeMajor,
                    outputs,
                    schemaVersion: manifestSchemaVersion,
                    typescriptVersion: context.typescriptVersion,
                };
                await writeFile(join(tempDir, manifestFile), JSON.stringify(manifest, null, 2));
                await writeFile(join(tempDir, completeMarkerFile), buildKey);

                const selfCheck = await validateCachedDist({ entryDir: tempDir, expected });
                if (!selfCheck.valid) {
                    throw new Error(`Refusing to publish an invalid build cache entry: ${selfCheck.reason}`);
                }

                await publish(tempDir, entryDir, expected);
            } catch (error) {
                await rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
                throw error;
            }
        }
    } finally {
        await lock.release();
    }
    await removeSchemaInvalidHexEntries(cacheBase, buildKey, siblingCleanup);
    return distDir;
}
