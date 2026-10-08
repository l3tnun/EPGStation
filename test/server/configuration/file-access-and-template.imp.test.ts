// Must stay the first import: the loader hook has to be registered before ConfigurationFileAccess.js loads.
import { configFsOverrides, resetConfigFsOverrides } from './fs-override-hook';

import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const ConfigurationFileAccess = (
    require(join(compiledSnapshot, 'model', 'ConfigurationFileAccess.js')) as {
        default: new () => {
            unwatch(targetPath: string, listener: () => void): void;
            watch(targetPath: string, listener: () => void): void;
        };
    }
).default;
const Configuration = (
    require(join(compiledSnapshot, 'model', 'Configuration.js')) as {
        default: new (logger: unknown, fileAccess: unknown) => unknown;
    }
).default;

afterEach(() => {
    resetConfigFsOverrides();
    vi.restoreAllMocks();
});

describe('configuration filesystem port and template reading', () => {
    it('[CFG-8.2] unwatch hands the same path and listener to the filesystem watcher removal', () => {
        const unwatchFile = vi.fn();
        configFsOverrides.unwatchFile = unwatchFile;
        const listener = vi.fn();

        new ConfigurationFileAccess().unwatch('synthetic-config.yml', listener);

        expect(unwatchFile).toHaveBeenCalledExactlyOnceWith('synthetic-config.yml', listener);
        expect(listener).not.toHaveBeenCalled();
    });

    it('[CFG-8.2] logs an unreadable template through the stream warning and still fails on the missing configuration', () => {
        const templateFailure = Object.assign(new Error('synthetic template permission failure'), { code: 'EACCES' });
        const configFailure = Object.assign(new Error('synthetic config missing'), { code: 'ENOENT' });
        const log = {
            stream: { warn: vi.fn() },
            system: { fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
        };
        const fileAccess = {
            configPath: 'synthetic-config.yml',
            read: vi.fn(),
            readSync: vi.fn((targetPath: string) => {
                throw targetPath === 'synthetic-template.yml' ? templateFailure : configFailure;
            }),
            templatePath: 'synthetic-template.yml',
            unwatch: vi.fn(),
            watch: vi.fn(),
        };
        const exitSentinel = new Error('process.exit sentinel');
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw exitSentinel;
        });

        expect(() => new Configuration({ getLogger: () => log }, fileAccess)).toThrow(exitSentinel);

        expect(log.stream.warn).toHaveBeenCalledExactlyOnceWith(templateFailure);
        expect(log.system.fatal).toHaveBeenCalledExactlyOnceWith('synthetic-config.yml is not found');
        expect(log.system.warn).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(fileAccess.watch).not.toHaveBeenCalled();
    });
});
