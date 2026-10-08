import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const compiledExecutorPath = join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutor.js');

interface EPGUpdateExecutorModule {
    runEPGUpdateExecutor: (options?: { container?: unknown; logConfigPath?: string }) => void;
}

/**
 * The compiled module is ES modules, so a fresh instance for each test requires dropping the module
 * registry with `vi.resetModules()` and re-importing it via a dynamic `import()` rather than the CJS
 * `require()` + cache-delete pattern, which does not work against an ESM-emitted `.js` file.
 */
async function loadEPGUpdateExecutor(): Promise<EPGUpdateExecutorModule> {
    vi.resetModules();
    return (await import(pathToFileURL(compiledExecutorPath).href)) as EPGUpdateExecutorModule;
}

interface RegisteredListener {
    readonly event: string;
    readonly listener: (...args: any[]) => void;
}

function createFakeContainer(startResult: 'resolve' | 'reject') {
    const initialize = vi.fn();
    const fatal = vi.fn();
    const start = vi.fn(() =>
        startResult === 'resolve' ? Promise.resolve() : Promise.reject(new Error('epg update start failed')),
    );
    const loggerModel = {
        initialize,
        getLogger: () => ({ system: { fatal } }),
    };
    const updater = { start };
    const container = {
        get: (id: string) => {
            if (id === 'ILoggerModel') return loggerModel;
            if (id === 'IEPGUpdater') return updater;
            throw new Error(`unexpected container.get(${id})`);
        },
    };
    return { container, initialize, fatal, start };
}

describe('EPGUpdateExecutor entry seam', () => {
    const registeredListeners: RegisteredListener[] = [];
    let onSpy: ReturnType<typeof vi.spyOn> | undefined;
    let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
    let baselineUncaughtExceptionCount = 0;
    let baselineUnhandledRejectionCount = 0;

    beforeEach(() => {
        baselineUncaughtExceptionCount = process.listenerCount('uncaughtException');
        baselineUnhandledRejectionCount = process.listenerCount('unhandledRejection');
        onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: any) => {
            registeredListeners.push({ event, listener });
            return process;
        }) as typeof process.on);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    });

    afterEach(() => {
        registeredListeners.length = 0;
        onSpy?.mockRestore();
        onSpy = undefined;
        exitSpy?.mockRestore();
        exitSpy = undefined;
        expect(process.listenerCount('uncaughtException')).toBe(baselineUncaughtExceptionCount);
        expect(process.listenerCount('unhandledRejection')).toBe(baselineUnhandledRejectionCount);
    });

    it('initializes the logger at the given path, registers fatal handlers, and starts the updater once', async () => {
        const fixtureLogConfigPath = '/fixtures/epg-update-executor-entry-seam/logConfig.yml';
        const { container, initialize, fatal, start } = createFakeContainer('resolve');
        const { runEPGUpdateExecutor } = await loadEPGUpdateExecutor();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(registeredListeners).toEqual([]);

        runEPGUpdateExecutor({ container, logConfigPath: fixtureLogConfigPath });

        expect(initialize).toHaveBeenCalledTimes(1);
        expect(initialize).toHaveBeenCalledWith(fixtureLogConfigPath);

        const registeredEvents = registeredListeners.map(entry => entry.event);
        expect(registeredEvents).toEqual(['uncaughtException', 'unhandledRejection']);

        const uncaughtEntry = registeredListeners.find(entry => entry.event === 'uncaughtException');
        uncaughtEntry?.listener(new Error('boom'));
        expect(fatal).toHaveBeenCalledTimes(1);
        expect(fatal.mock.calls[0][0]).toContain('uncaughtException');

        const unhandledEntry = registeredListeners.find(entry => entry.event === 'unhandledRejection');
        unhandledEntry?.listener(new Error('rejected'));
        expect(fatal).toHaveBeenCalledTimes(2);
        expect(fatal.mock.calls[1][0]).toContain('unhandledRejection');

        expect(start).toHaveBeenCalledTimes(1);

        await Promise.resolve();
        await Promise.resolve();
    });

    it('exits the process with code 1 when updater.start() rejects', async () => {
        const { container, start } = createFakeContainer('reject');
        const { runEPGUpdateExecutor } = await loadEPGUpdateExecutor();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(registeredListeners).toEqual([]);

        runEPGUpdateExecutor({
            container,
            logConfigPath: '/fixtures/epg-update-executor-entry-seam/logConfig.yml',
        });

        expect(start).toHaveBeenCalledTimes(1);

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

/**
 * The two tests above always call `runEPGUpdateExecutor({ container, logConfigPath })` explicitly
 * against a dynamically re-imported module, so `process.argv[1]` is Vitest's own worker script, never
 * `EPGUpdateExecutor.js`'s own path -- the file's bottom-of-module self-start guard
 * (`process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`)
 * and the default-container branch inside `runEPGUpdateExecutor` (`options.container === 'undefined'`,
 * which calls `containerSetter.set(container)`) are therefore never reached by those tests. This
 * mirrors `test/server/management-tools/real-file-entry.integration.test.ts` to spawn the
 * real, unmodified `EPGUpdateExecutor.js` as an actual child process's own main module -- the guard's
 * condition is genuinely true there -- with only the two dependency-injection seams
 * (`../ModelContainer.js`, `../ModelContainerSetter.js`, both resolved relative to
 * `EPGUpdateExecutor.js`'s own directory) replaced via the same registered loader hook
 * (`test/server/harness/child-module-overrides.mjs`) that file uses, spawned directly from the shared,
 * canonical `EPGSTATION_SERVER_COMPILED_SNAPSHOT` tree (read-only, never copied) so real V8 raw
 * coverage for the guard and the default-container branch merges into this run's own
 * `coverage-final.json` instead of landing in a run-scoped `withCompiledSnapshot()` copy the
 * converter's `snapshotRoots` list never includes.
 */
describe('EPGUpdateExecutor real self-invocation (the EPGUpdater entry)', () => {
    const harnessDirectory = fileURLToPath(new URL('../harness/', import.meta.url));
    const overridesLoaderUrl = pathToFileURL(join(harnessDirectory, 'child-module-overrides.mjs')).href;

    it('runs the real self-start guard and default (no-argument) container path as an actual child process', async () => {
        const entryPath = await realpath(compiledExecutorPath);
        const entryUrl = pathToFileURL(entryPath).href;
        const containerSource = [
            "const event = value => process.stdout.write(value + '\\n');",
            'const loggerModel = {',
            "    initialize: logConfigPath => event('logger:init:' + logConfigPath),",
            '    getLogger: () => ({ system: { fatal: value => event(\'fatal:\' + String(value)) } }),',
            '};',
            "const updater = { start: () => (event('updater:start'), Promise.resolve()) };",
            'const dependencies = { ILoggerModel: loggerModel, IEPGUpdater: updater };',
            'const container = {',
            '    get(name) {',
            '        if (!Object.hasOwn(dependencies, name)) {',
            "            throw new Error('epg-update-executor-real-invoke fixture: unstubbed dependency ' + name);",
            '        }',
            '        return dependencies[name];',
            '    },',
            '};',
            'export default container;',
            '',
        ].join('\n');
        const containerSetterSource = [
            "export const set = () => { process.stdout.write('container:set\\n'); };",
            '',
        ].join('\n');
        const preloadSource = [
            `const { registerOverrides } = await import(${JSON.stringify(overridesLoaderUrl)});`,
            'registerOverrides([',
            `    { specifier: '../ModelContainer.js', parentURL: ${JSON.stringify(entryUrl)}, source: ${JSON.stringify(containerSource)} },`,
            `    { specifier: '../ModelContainerSetter.js', parentURL: ${JSON.stringify(entryUrl)}, source: ${JSON.stringify(containerSetterSource)} },`,
            ']);',
            '',
        ].join('\n');

        const preloadDirectory = await mkdtemp(join(tmpdir(), 'epg-update-executor-real-invoke-'));
        const preloadPath = join(preloadDirectory, 'preload.mjs');
        try {
            await writeFile(preloadPath, preloadSource, 'utf8');

            const { exitCode, stdout, stderr } = await new Promise<{
                exitCode: number | null;
                stdout: string;
                stderr: string;
            }>((resolve, reject) => {
                const child = spawn(
                    process.execPath,
                    ['--import', pathToFileURL(preloadPath).href, entryPath],
                    { stdio: ['ignore', 'pipe', 'pipe'] },
                );
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
                child.on('close', code => resolve({ exitCode: code, stdout: stdoutText, stderr: stderrText }));
            });

            expect(stderr).toBe('');
            expect(exitCode).toBe(0);
            // container:set proves the default (`options.container === undefined`) branch ran
            // `containerSetter.set(container)` -- the real self-start guard passes no options at all.
            expect(stdout).toContain('container:set\n');
            expect(stdout).toContain('updater:start\n');
            // The default `logConfigPath` is `path.join(import.meta.dirname, '..', '..', '..',
            // 'config', 'epgUpdaterLogConfig.yml')`; computed the same way here from the entry's own
            // (realpath'd) directory, so this only matches if the guard's no-argument call actually
            // evaluated that real default-path expression rather than some test-supplied path.
            const expectedLogConfigPath = join(dirname(entryPath), '..', '..', '..', 'config', 'epgUpdaterLogConfig.yml');
            expect(stdout).toContain(`logger:init:${expectedLogConfigPath}\n`);
        } finally {
            await rm(preloadDirectory, { recursive: true, force: true });
        }
    }, 30_000);
});
