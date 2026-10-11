import 'reflect-metadata';

import { mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface LoggerModelRuntime {
    getLogger(): unknown;
    initialize(filePath?: string): void;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const LoggerModel = (require(join(snapshot, 'model', 'LoggerModel.js')) as { default: new () => LoggerModelRuntime })
    .default;

const exitSentinel = new Error('process.exit sentinel');

const stubProcessExit = () =>
    vi.spyOn(process, 'exit').mockImplementation(() => {
        throw exitSentinel;
    });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('logger model startup failures', () => {
    it('[OL-1.1] terminates the process when a logger is requested before initialization', () => {
        const exit = stubProcessExit();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => new LoggerModel().getLogger()).toThrow(exitSentinel);

        expect(consoleError).toHaveBeenCalledExactlyOnceWith('Logger is not initialized');
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('[OL-1.1] reports a missing log configuration file and terminates the process', () => {
        const exit = stubProcessExit();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => new LoggerModel().initialize(join(tmpdir(), 'epgstation-missing-log-config.yml'))).toThrow(
            exitSentinel,
        );

        expect(consoleError.mock.calls[0]).toEqual(['log file is not found']);
        expect(consoleError.mock.calls).toContainEqual(['log file parse error']);
        expect(exit).toHaveBeenCalledWith(1);
        expect(exit).toHaveBeenCalledTimes(2);
    });

    it('[OL-1.1] reports a log configuration path that cannot be read as a file with the underlying error', async () => {
        const exit = stubProcessExit();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const directory = await mkdtemp(join(tmpdir(), 'epgstation-log-config-'));

        expect(() => new LoggerModel().initialize(directory)).toThrow(exitSentinel);

        const reported = consoleError.mock.calls.map(call => call[0]);
        expect(reported).not.toContain('log file is not found');
        expect(reported[0]).toBeInstanceOf(Error);
        expect((reported[0] as NodeJS.ErrnoException).code).toBe('EISDIR');
        expect(reported).toContain('log file parse error');
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('[OL-1.1] reports an unparsable log configuration and terminates the process', async () => {
        const exit = stubProcessExit();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const directory = await mkdtemp(join(tmpdir(), 'epgstation-log-config-'));
        const target = join(directory, 'broken-log-config.yml');
        await writeFile(target, 'appenders: [unterminated\n', 'utf-8');

        expect(() => new LoggerModel().initialize(target)).toThrow(exitSentinel);

        expect(consoleError.mock.calls[0]).toEqual(['log file parse error']);
        expect(consoleError.mock.calls[1][0]).toBeInstanceOf(Error);
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    });
});
