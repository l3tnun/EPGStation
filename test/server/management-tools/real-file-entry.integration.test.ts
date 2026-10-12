import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface RawCoverageResult {
    readonly url: string;
}

interface RawCoverageDocument {
    readonly result?: readonly RawCoverageResult[];
}

/** Node writes `coverage-<pid>-<timestamp>-<thread>.json`. Another worker's dump in the same
 * directory is not this child's profile. An empty or truncated dump for this pid still has to
 * parse: it is not treated as a successful profile. */
function coverageDumpForProcess(fileName: string, pid: number): boolean {
    return fileName.startsWith(`coverage-${pid}-`) && fileName.endsWith('.json');
}

async function readRawCoverageEntryUrls(directory: string, fileNames: readonly string[]): Promise<string[]> {
    const entryUrls: string[] = [];
    for (const file of fileNames) {
        const filePath = join(directory, file);
        const payload = await readFile(filePath, 'utf8');
        let document: RawCoverageDocument;
        try {
            document = JSON.parse(payload) as RawCoverageDocument;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`${filePath} is not a V8 raw coverage profile (${payload.length} bytes): ${detail}`);
        }
        for (const result of document.result ?? []) entryUrls.push(result.url);
    }
    return entryUrls;
}

/** Runs `nodeArgv` (a full `node` argument list -- e.g. `['--import', preloadUrl, entryPath, ...cliArgs]`)
 * as a real child process, forwarding/reusing `NODE_V8_COVERAGE` the same way the DBTools and
 * V1MigrationTool cases below both do, and returns every raw-coverage script URL the run newly
 * attributed. Shared so both cases assert the same "real file, not an eval origin" shape without
 * duplicating the spawn/raw-coverage plumbing.
 *
 * When an outer coverage-mode run already owns `NODE_V8_COVERAGE`, this reuses that directory
 * untouched rather than diverting or destroying that run's own raw coverage. When it is unset, this
 * case owns a disposable temp directory end-to-end -- assigning it directly to
 * `process.env.NODE_V8_COVERAGE` (never as an explicit `env:` object naming `NODE_V8_COVERAGE`) so
 * the spawned child inherits it exactly like every other environment variable, then restoring it
 * afterward. */
async function spawnEntryAndCollectRawCoverageUrls(
    nodeArgv: readonly string[],
    cwd: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; entryUrls: string[] }> {
    const presetRawCoverageDirectory = process.env.NODE_V8_COVERAGE;
    const rawCoverageDirectory =
        presetRawCoverageDirectory ?? (await mkdtemp(join(tmpdir(), 'management-tools-real-file-raw-coverage-')));
    const before =
        presetRawCoverageDirectory === undefined
            ? new Set<string>()
            : new Set((await readdir(rawCoverageDirectory)).filter(name => name.endsWith('.json')));

    if (presetRawCoverageDirectory === undefined) {
        process.env.NODE_V8_COVERAGE = rawCoverageDirectory;
    }
    try {
        const { childPid, exitCode, stdout, stderr } = await new Promise<{
            childPid: number;
            exitCode: number | null;
            stdout: string;
            stderr: string;
        }>((resolve, reject) => {
            const child = spawn(process.execPath, [...nodeArgv], {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const spawnedPid = child.pid;
            if (spawnedPid === undefined) {
                reject(new Error('coverage child did not receive a pid'));
                return;
            }
            let stdoutText = '';
            let stderrText = '';
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', chunk => {
                stdoutText += chunk;
            });
            child.stderr.on('data', chunk => {
                stderrText += chunk;
            });
            child.on('error', reject);
            child.on('close', code =>
                resolve({ childPid: spawnedPid, exitCode: code, stdout: stdoutText, stderr: stderrText }),
            );
        });

        const rawFiles = (await readdir(rawCoverageDirectory)).filter(
            name => coverageDumpForProcess(name, childPid) && !before.has(name),
        );
        expect(rawFiles.length).toBeGreaterThan(0);

        const entryUrls = await readRawCoverageEntryUrls(rawCoverageDirectory, rawFiles);

        return { exitCode, stdout, stderr, entryUrls };
    } finally {
        if (presetRawCoverageDirectory === undefined) {
            delete process.env.NODE_V8_COVERAGE;
            await rm(rawCoverageDirectory, { recursive: true, force: true });
        }
    }
}

function requireCompiledSnapshot(): string {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined) {
        throw new Error('The compiled server snapshot is required');
    }
    return compiledSnapshot;
}

const harnessDirectory = fileURLToPath(new URL('../harness/', import.meta.url));
const overridesLoaderUrl = pathToFileURL(join(harnessDirectory, 'child-module-overrides.mjs')).href;

/** Builds the `--import`-preloaded source that registers the two dependency-injection seams
 * (`./model/ModelContainer.js`, `./model/ModelContainerSetter.js`) as loader-hook replacements keyed
 * to `entryUrl`, from real fixture file contents. Unlike `compiled-cli.integration.test.ts`'s wrapper
 * (which becomes the child's main module and therefore must call the entry's exported class
 * explicitly, since that pattern's self-start guard can never see itself as the main module), this
 * preload is loaded via `node --import` *alongside* `entryPath` as a separate, additional main-module
 * argument: `entryPath` itself stays the process's actual main module, so its own top-level
 * `resolve(process.argv[1]) === fileURLToPath(import.meta.url)` guard is genuinely true and the file's
 * real self-start branch runs -- the one behavior this suite exists to prove real V8 raw coverage
 * for (as the comment on the describe blocks below explains). */
function buildPreloadSource(entryUrl: string, containerSource: string, containerSetterSource: string): string {
    return [
        `const { registerOverrides } = await import(${JSON.stringify(overridesLoaderUrl)});`,
        'registerOverrides([',
        `    { specifier: './model/ModelContainer.js', parentURL: ${JSON.stringify(entryUrl)}, source: ${JSON.stringify(containerSource)} },`,
        `    { specifier: './model/ModelContainerSetter.js', parentURL: ${JSON.stringify(entryUrl)}, source: ${JSON.stringify(containerSetterSource)} },`,
        ']);',
        '',
    ].join('\n');
}

// Real-entry test: an eval-based load would not yield real compiled-file V8 raw records. The
// entry sources carry exactly one hunk each -- `export default DBTools;` / `export default
// V1MigrationTool;` plus wrapping the self-start in `if (require.main === module) { ... }`. This
// case proves the "real compiled file, real V8 raw coverage" outcome by
// requiring the real, guard-carrying `dist/DBTools.js` file exactly as Node's own module loader
// would (no `Function`/`new Function`/`eval` of its source text), replacing only the two
// dependency-injection seams (`./model/ModelContainer.js`, `./model/ModelContainerSetter.js`) via a
// registered loader hook (see `buildPreloadSource` above) instead of copying the whole compiled
// snapshot: the entry is spawned directly from the shared, canonical `EPGSTATION_SERVER_COMPILED_SNAPSHOT`
// tree that every other coverage-mode test in this run already reads from, so raw V8 coverage this
// spawn produces resolves under that same snapshot root and merges into the run's own
// `coverage-final.json` -- a per-test `withCompiledSnapshot()` copy (this file's own previous
// approach) lives under a disposable, run-scoped path the converter's `snapshotRoots` list never
// includes, so real V8 records for it exist on disk but are never attributed to any `src/**/*.ts`
// file (silently, by the converter's own documented "snapshot-external" rule -- see
// `scripts/server-test/compiled-snapshot-coverage.mjs`'s module doc). Nothing is copied onto the
// shared snapshot itself -- only read from it -- so this stays safe next to every other test reading
// that same tree concurrently. The `new DBTools().run();` self-start still runs here because this
// case spawns the entry as the child process's own main module, so `require.main === module` holds
// and the guard's true branch executes -- the same condition that keeps direct CLI invocation
// (`node dist/DBTools.js ...`) unchanged.
describe('DBTools compiled entrypoint — real-file invocation without Function/eval', () => {
    it('requires the real compiled dist/DBTools.js as an actual file and V8 raw coverage attributes execution to that real file, not an eval wrapper', async () => {
        const compiledSnapshot = requireCompiledSnapshot();
        const entryPath = await realpath(join(compiledSnapshot, 'DBTools.js'));
        const entryUrl = pathToFileURL(entryPath).href;
        const [containerSource, containerSetterSource] = await Promise.all([
            readFile(join('test', 'server', 'management-tools', 'fixtures', 'real-model-container.mjs'), 'utf8'),
            readFile(
                join('test', 'server', 'management-tools', 'fixtures', 'real-model-container-setter.mjs'),
                'utf8',
            ),
        ]);
        const preloadDirectory = await mkdtemp(join(tmpdir(), 'dbtools-real-file-preload-'));
        const preloadPath = join(preloadDirectory, 'preload.mjs');
        const outputDirectory = await mkdtemp(join(tmpdir(), 'dbtools-real-file-backup-'));
        const backupFile = join(outputDirectory, 'backup.json');

        try {
            await writeFile(preloadPath, buildPreloadSource(entryUrl, containerSource, containerSetterSource), 'utf8');

            const { exitCode, stdout, stderr, entryUrls } = await spawnEntryAndCollectRawCoverageUrls(
                ['--import', pathToFileURL(preloadPath).href, entryPath, '-m', 'backup', '-o', backupFile],
                compiledSnapshot,
            );

            expect(stderr).toBe('');
            expect(exitCode).toBe(0);
            expect(stdout).toContain('container:set');
            expect(stdout).toContain('log:--- finish ---');

            // The one observable this case exists for: the real compiled file's own absolute
            // path shows up as a raw-coverage script URL. Evaluating its source text through
            // `Function`/`eval` instead (the pattern this alternative avoids) would never
            // produce a URL equal to the real file path -- V8 attributes eval'd code to a
            // synthetic `evalmachine.<anonymous>` origin instead.
            const dbToolsEntries = entryUrls.filter(url => url === entryPath || url === entryUrl);
            expect(dbToolsEntries.length).toBeGreaterThan(0);
            expect(entryUrls.some(url => url.includes('evalmachine'))).toBe(false);

            const backupContents = JSON.parse(await readFile(backupFile, 'utf8')) as Record<string, unknown>;
            expect(Object.keys(backupContents).sort()).toEqual(
                [
                    'dropLogFileItems',
                    'recordedHistoryItems',
                    'recordedItems',
                    'recordedTagItems',
                    'reserveItems',
                    'ruleItems',
                    'thumbnailItems',
                    'videoFileItems',
                ].sort(),
            );
        } finally {
            await rm(preloadDirectory, { recursive: true, force: true });
            await rm(outputDirectory, { recursive: true, force: true });
        }
    }, 30_000);
});

// Real-entry test for V1MigrationTool: same proof as the
// DBTools case above -- requires the real, guard-carrying `dist/V1MigrationTool.js` file exactly as
// Node's own module loader would (no `Function`/`new Function`/`eval` of its source text), replacing
// only the `./model/ModelContainer` / `./model/ModelContainerSetter` dependency-injection seams with
// the same registered-loader-hook mechanism as the DBTools case, spawned directly from the shared
// `EPGSTATION_SERVER_COMPILED_SNAPSHOT` tree so its raw V8 coverage also merges into this run's
// `coverage-final.json`. `V1MigrationTool.ts` carries the same `export default` +
// `require.main === module` guard hunk as `DBTools.ts`; the `new V1MigrationTool().run();` self-start
// still runs here because this case spawns the entry as the child process's own main module.
describe('V1MigrationTool compiled entrypoint — real-file invocation without Function/eval', () => {
    it('requires the real compiled dist/V1MigrationTool.js as an actual file and V8 raw coverage attributes execution to that real file, not an eval wrapper', async () => {
        const compiledSnapshot = requireCompiledSnapshot();
        const entryPath = await realpath(join(compiledSnapshot, 'V1MigrationTool.js'));
        const entryUrl = pathToFileURL(entryPath).href;
        const [containerSource, containerSetterSource] = await Promise.all([
            readFile(join('test', 'server', 'management-tools', 'fixtures', 'real-v1-migration-container.mjs'), 'utf8'),
            readFile(
                join('test', 'server', 'management-tools', 'fixtures', 'real-model-container-setter.mjs'),
                'utf8',
            ),
        ]);
        const preloadDirectory = await mkdtemp(join(tmpdir(), 'v1-migration-real-file-preload-'));
        const preloadPath = join(preloadDirectory, 'preload.mjs');
        const inputDirectory = await mkdtemp(join(tmpdir(), 'v1-migration-real-file-input-'));
        const inputFile = join(inputDirectory, 'v1-backup.json');
        await writeFile(
            inputFile,
            JSON.stringify({
                rules: [
                    {
                        id: 1,
                        keyword: null,
                        halfKeyword: null,
                        ignoreKeyword: null,
                        halfIgnoreKeyword: null,
                        keyCS: null,
                        keyRegExp: null,
                        title: null,
                        description: null,
                        extended: null,
                        ignoreKeyCS: null,
                        ignoreKeyRegExp: null,
                        ignoreTitle: null,
                        ignoreDescription: null,
                        ignoreExtended: null,
                        GR: null,
                        BS: null,
                        CS: null,
                        SKY: null,
                        station: null,
                        genrelv1: null,
                        genrelv2: null,
                        startTime: null,
                        timeRange: null,
                        week: 0,
                        isFree: null,
                        durationMin: null,
                        durationMax: null,
                        avoidDuplicate: false,
                        periodToAvoidDuplicate: null,
                        enable: true,
                        allowEndLack: false,
                        directory: null,
                        recordedFormat: null,
                        mode1: null,
                        directory1: null,
                        mode2: null,
                        directory2: null,
                        mode3: null,
                        directory3: null,
                        delTs: null,
                    },
                ],
                recorded: [
                    {
                        id: 1,
                        programId: 100,
                        channelId: 200,
                        channelType: 'GR',
                        startAt: 0,
                        endAt: 1000,
                        duration: 1000,
                        name: 'real-file-entry v1 recorded',
                        description: null,
                        extended: null,
                        genre1: null,
                        genre2: null,
                        genre3: null,
                        genre4: null,
                        genre5: null,
                        genre6: null,
                        videoType: null,
                        videoResolution: null,
                        videoStreamContent: null,
                        videoComponentType: null,
                        audioSamplingRate: null,
                        audioComponentType: null,
                        recPath: '/tmp/real-file-entry-rec.ts',
                        ruleId: 1,
                        thumbnailPath: '/tmp/real-file-entry-thumb.jpg',
                        recording: false,
                        protection: false,
                        filesize: 12345,
                        logPath: null,
                        errorCnt: null,
                        dropCnt: null,
                        scramblingCnt: null,
                        isTmp: false,
                    },
                ],
                encoded: [
                    {
                        id: 1,
                        recordedId: 1,
                        name: 'real-file-entry encoded',
                        path: '/tmp/real-file-entry-encoded.mp4',
                        filesize: 6789,
                    },
                ],
                recordedHistory: [{ id: 1, name: 'real-file-entry history', channelId: 200, endAt: 1000 }],
                dbRevisionInfo: { revision: 1 },
            }),
            'utf8',
        );

        try {
            await writeFile(preloadPath, buildPreloadSource(entryUrl, containerSource, containerSetterSource), 'utf8');

            const { exitCode, stdout, stderr, entryUrls } = await spawnEntryAndCollectRawCoverageUrls(
                ['--import', pathToFileURL(preloadPath).href, entryPath, '-i', inputFile],
                compiledSnapshot,
            );

            expect(stderr).toBe('');
            expect(exitCode).toBe(0);
            expect(stdout).toContain('container:set');
            expect(stdout).toContain('log:--- run ---');
            expect(stdout).toContain('log:--- import rules ---');
            expect(stdout).toContain('log:--- import recorded ---');
            expect(stdout).toContain('log:--- import encode video files ---');
            expect(stdout).toContain('log:--- import recorded history ---');
            expect(stdout).toContain('log:--- finish ---');
            expect(stdout).toContain('insert:rule:');
            expect(stdout).toContain('insert:recorded:real-file-entry v1 recorded');
            expect(stdout).toContain('insert:thumbnail:222');
            expect(stdout).toContain('insert:video-file:ts:222');
            expect(stdout).toContain('insert:video-file:encoded:222');
            expect(stdout).toContain('insert:recorded-history:real-file-entry history');

            // The one observable this case exists for: the real compiled file's own absolute path
            // shows up as a raw-coverage script URL. Evaluating its source text through
            // `Function`/`eval` instead (the pattern this alternative avoids) would never produce a
            // URL equal to the real file path -- V8 attributes eval'd code to a synthetic
            // `evalmachine.<anonymous>` origin instead.
            const v1MigrationToolEntries = entryUrls.filter(url => url === entryPath || url === entryUrl);
            expect(v1MigrationToolEntries.length).toBeGreaterThan(0);
            expect(entryUrls.some(url => url.includes('evalmachine'))).toBe(false);
        } finally {
            await rm(preloadDirectory, { recursive: true, force: true });
            await rm(inputDirectory, { recursive: true, force: true });
        }
    }, 30_000);
});
