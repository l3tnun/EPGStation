import 'reflect-metadata';

import * as childProcess from 'child_process';
import * as nodeChildProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { YAML11_SCHEMA, dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

const processExecutionStubs = vi.hoisted(() => ({
    spawn: vi.fn(() => {
        throw new Error('Unexpected process execution through spawn');
    }),
    exec: vi.fn(() => {
        throw new Error('Unexpected process execution through exec');
    }),
    execFile: vi.fn(() => {
        throw new Error('Unexpected process execution through execFile');
    }),
}));

vi.mock('child_process', () => processExecutionStubs);
vi.mock('node:child_process', () => processExecutionStubs);

interface ConfigurationRuntime {
    config: Record<string, unknown>;
    formatConfig(config: Record<string, unknown>): Record<string, unknown>;
    getConfig(): Record<string, unknown>;
    log: { system: { fatal: ReturnType<typeof vi.fn> } };
    templateConfig: Record<string, unknown> | null;
}

interface ConfigurationConstructor {
    new (loggerModel: { getLogger(): ConfigurationLogger }): ConfigurationRuntime;
    readonly prototype: object;
}

interface ConfigurationLogger {
    readonly stream: { warn: ReturnType<typeof vi.fn> };
    readonly system: {
        error: ReturnType<typeof vi.fn>;
        fatal: ReturnType<typeof vi.fn>;
        info: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
    };
}

interface MutableFileSystem {
    promises: { readFile: (...args: unknown[]) => Promise<unknown> };
    readFileSync: (...args: unknown[]) => unknown;
    watchFile: (...args: unknown[]) => unknown;
}

interface PublicConfigModel {
    getConfig(isSecure: boolean): Promise<Record<string, unknown>>;
}

interface PublicConfigModelConstructor {
    new (
        configuration: { getConfig(): Record<string, unknown> },
        ipc: { reserveation: { getBroadcastStatus(): Promise<Record<string, boolean>> } },
    ): PublicConfigModel;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const mutableFileSystem = require('node:fs') as MutableFileSystem;
const originalReadFile = mutableFileSystem.promises.readFile;
const originalReadFileSync = mutableFileSystem.readFileSync;
const originalWatchFile = mutableFileSystem.watchFile;
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

/*
 * server は ESM へ移行済みで、Configuration.js の `import * as fs from 'fs'` は静的に解決されるため、
 * `require('node:fs')` で得た名前空間を後から書き換えても Configuration.js 側には届かない
 * (in-process の名前空間差し替えが効かない)。`vi.doMock('node:fs', ...)` で Configuration.js が
 * import する 'fs' 自体を、常に `mutableFileSystem` の現在値へ委譲するラッパーに差し替えたうえで
 * `vi.resetModules()` してから動的 `import()` で読み直す。一度この束縛を確立すれば、以降の
 * `mutableFileSystem.readFileSync = vi.fn(...)` のような各 test の差し替えは委譲先の値を書き換える
 * だけで Configuration.js 実行時にも反映される。
 */
const loadConfiguration = async (): Promise<ConfigurationConstructor> => {
    vi.doMock('node:fs', () => ({
        readFileSync: (...arguments_: unknown[]) => (mutableFileSystem.readFileSync as any)(...arguments_),
        watchFile: (...arguments_: unknown[]) => (mutableFileSystem.watchFile as any)(...arguments_),
        unwatchFile: (...arguments_: unknown[]) => (mutableFileSystem as any).unwatchFile?.(...arguments_),
        promises: {
            readFile: (...arguments_: unknown[]) => mutableFileSystem.promises.readFile(...arguments_),
        },
    }));
    try {
        vi.resetModules();
        const imported = (await import(join(compiledSnapshot, 'model', 'Configuration.js'))) as {
            default: ConfigurationConstructor;
        };
        return imported.default;
    } finally {
        vi.doUnmock('node:fs');
    }
};

const Configuration = await loadConfiguration();
const ConfigApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'config', 'ConfigApiModel.js')) as {
        default: PublicConfigModelConstructor;
    }
).default;

const fixturePath = join(process.cwd(), 'test/server/fixtures/configuration/characterization.synthetic.yml');
const fixtureSource = readFileSync(fixturePath, 'utf8');

const readCandidate = (): Record<string, unknown> =>
    yamlLoad(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

const createConfiguration = (): ConfigurationRuntime => {
    const configuration = Object.create(Configuration.prototype) as ConfigurationRuntime;
    configuration.log = { system: { fatal: vi.fn() } };
    configuration.templateConfig = null;
    return configuration;
};

const createLogger = (): ConfigurationLogger => ({
    stream: { warn: vi.fn() },
    system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

const clearProcessExecutionLedger = (): void => {
    processExecutionStubs.spawn.mockClear();
    processExecutionStubs.exec.mockClear();
    processExecutionStubs.execFile.mockClear();
};

const expectNoProcessExecution = (): void => {
    expect(childProcess.spawn).toBe(processExecutionStubs.spawn);
    expect(nodeChildProcess.spawn).toBe(processExecutionStubs.spawn);
    expect(processExecutionStubs.spawn).not.toHaveBeenCalled();
    expect(processExecutionStubs.exec).not.toHaveBeenCalled();
    expect(processExecutionStubs.execFile).not.toHaveBeenCalled();
};

afterEach(() => {
    mutableFileSystem.promises.readFile = originalReadFile;
    mutableFileSystem.readFileSync = originalReadFileSync;
    mutableFileSystem.watchFile = originalWatchFile;
    vi.restoreAllMocks();
});

describe('configuration to storage timeout raw-carrier boundary', () => {
    it('[CFG-4.2-ABSENT] keeps the carrier absent instead of installing a provider default', () => {
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig(readCandidate());

        expect(configuration.getConfig()).not.toHaveProperty('storageLimitCommandTimeoutMs');
    });

    it.each([
        ['valid scalar', 300_001],
        ['invalid raw object', { marker: ['storage-owner-must-validate'] }],
    ])('[CFG-4.2-RAW-CLONE] preserves %s without provider conversion or validation', (_label, rawValue) => {
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig({
            ...readCandidate(),
            storageLimitCommandTimeoutMs: rawValue,
        });

        const first = configuration.getConfig();
        const second = configuration.getConfig();

        expect(first.storageLimitCommandTimeoutMs).toEqual(rawValue);
        expect(second.storageLimitCommandTimeoutMs).toEqual(rawValue);
        expect(first).not.toBe(second);
        if (typeof rawValue === 'object') {
            expect(first.storageLimitCommandTimeoutMs).not.toBe(second.storageLimitCommandTimeoutMs);
        }
    });

    it('[CFG-4.2-YAML-TIMESTAMP] preserves an unquoted YAML timestamp as independent Date clones', () => {
        // js-yaml 5 の load() 既定 schema は CORE_SCHEMA で timestamp を解決しない。この test は
        // formatConfig の clone 契約 (Date が渡されたら Date のまま独立clone する) だけを検証する
        // ので、YAML11_SCHEMA で明示的に timestamp を Date へ解決させたうえで formatConfig へ渡す。
        // production の Configuration.readConfig 自体が同じ schema を使うかどうかは別問題であり、
        // 本 test は関与しない (production の loadYaml 呼び出しは schema 未指定のままで、CFG-4.2-
        // NESTED-RELOAD / CFG-4.2-RELOAD-REJECTED の未解決懸念として報告する)。
        const timestampCandidate = yamlLoad(`${fixtureSource}\nstorageLimitCommandTimeoutMs: 2026-01-01\n`, {
            schema: YAML11_SCHEMA,
        }) as Record<string, unknown>;
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig(timestampCandidate);

        const first = configuration.getConfig();
        const second = configuration.getConfig();

        expect(first.storageLimitCommandTimeoutMs).toBeInstanceOf(Date);
        expect(second.storageLimitCommandTimeoutMs).toBeInstanceOf(Date);
        expect((first.storageLimitCommandTimeoutMs as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect((second.storageLimitCommandTimeoutMs as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(first.storageLimitCommandTimeoutMs).not.toBe(second.storageLimitCommandTimeoutMs);
    });

    it('[CFG-4.2-YAML-ALIAS] preserves a circular raw YAML alias without sharing snapshot references', () => {
        const circularCandidate = yamlLoad(
            `${fixtureSource}\nstorageLimitCommandTimeoutMs: &raw\n  self: *raw\n`,
        ) as Record<string, unknown>;
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig(circularCandidate);
        const internalRaw = configuration.config.storageLimitCommandTimeoutMs as { self: unknown };

        const first = configuration.getConfig();
        const second = configuration.getConfig();
        const firstRaw = first.storageLimitCommandTimeoutMs as { self: unknown };
        const secondRaw = second.storageLimitCommandTimeoutMs as { self: unknown };

        expect(firstRaw).not.toBe(internalRaw);
        expect(secondRaw).not.toBe(internalRaw);
        expect(firstRaw).not.toBe(secondRaw);
        expect(firstRaw.self).toBe(firstRaw);
        expect(secondRaw.self).toBe(secondRaw);
    });

    it('[CFG-4.2-RELOAD] replaces a valid raw carrier with an invalid raw carrier while retaining acquired clones', async () => {
        const initialCandidate = {
            ...readCandidate(),
            storageLimitCommandTimeoutMs: 300_001,
        };
        mutableFileSystem.readFileSync = vi.fn(() => yamlDump(initialCandidate));
        const watchFile = vi.fn();
        mutableFileSystem.watchFile = watchFile;
        const logger = createLogger();
        clearProcessExecutionLedger();
        const configuration = new Configuration({ getLogger: () => logger });
        const acquiredBeforeReload = configuration.getConfig();
        const invalidRawValue = { marker: ['storage-owner-must-reject'] };
        mutableFileSystem.promises.readFile = vi.fn(async () =>
            yamlDump({ ...readCandidate(), storageLimitCommandTimeoutMs: invalidRawValue }),
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        await changeListener();

        expect(acquiredBeforeReload.storageLimitCommandTimeoutMs).toBe(300_001);
        expect(configuration.getConfig().storageLimitCommandTimeoutMs).toEqual(invalidRawValue);
        expectNoProcessExecution();
    });

    it('[CFG-4.2-NESTED-RELOAD] preserves nested raw YAML types and returns independent clones after reload', async () => {
        // js-yaml 5 の既定 schema は YAML 1.2 の CORE で、引用符の無い日付は文字列として読む。
        // この test が見ているのは「YAML が返した型がそのまま残り、取得のたびに独立した clone に
        // なること」なので、schema によって解釈が変わらない値で確かめる。
        mutableFileSystem.readFileSync = vi.fn(() => `${fixtureSource}\nstorageLimitCommandTimeoutMs: 2026-01-01\n`);
        const watchFile = vi.fn();
        mutableFileSystem.watchFile = watchFile;
        const logger = createLogger();
        clearProcessExecutionLedger();
        const configuration = new Configuration({ getLogger: () => logger });
        const acquiredBeforeReload = configuration.getConfig();
        mutableFileSystem.promises.readFile = vi.fn(
            async () =>
                `${fixtureSource}\nstorageLimitCommandTimeoutMs:\n  observedAt: 2026-02-03\n  values:\n    - nested\n    - 7\n`,
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        await changeListener();

        const firstAfterReload = configuration.getConfig();
        const secondAfterReload = configuration.getConfig();
        const expectedNested = {
            observedAt: '2026-02-03',
            values: ['nested', 7],
        };
        expect(acquiredBeforeReload.storageLimitCommandTimeoutMs).toBe('2026-01-01');
        expect(firstAfterReload.storageLimitCommandTimeoutMs).toEqual(expectedNested);
        expect(secondAfterReload.storageLimitCommandTimeoutMs).toEqual(expectedNested);
        expect(firstAfterReload.storageLimitCommandTimeoutMs).not.toBe(secondAfterReload.storageLimitCommandTimeoutMs);
        expect((firstAfterReload.storageLimitCommandTimeoutMs as { values: unknown[] }).values).not.toBe(
            (secondAfterReload.storageLimitCommandTimeoutMs as { values: unknown[] }).values,
        );
        expectNoProcessExecution();
    });

    it('[CFG-4.2-RELOAD-REJECTED] retains the old raw carrier and internal config reference on invalid reload', async () => {
        // 引用符の無い日付は js-yaml 5 では文字列になる。生の値をそのまま保つことが要点なので、
        // 読み書きで解釈の変わらない値を使う。
        const initialRawValue = {
            observedAt: '2026-03-04',
            values: ['retained'],
        };
        mutableFileSystem.readFileSync = vi.fn(() =>
            yamlDump({ ...readCandidate(), storageLimitCommandTimeoutMs: initialRawValue }),
        );
        const watchFile = vi.fn();
        mutableFileSystem.watchFile = watchFile;
        const logger = createLogger();
        clearProcessExecutionLedger();
        const configuration = new Configuration({ getLogger: () => logger });
        const internalBeforeReload = configuration.config;
        const internalRawBeforeReload = configuration.config.storageLimitCommandTimeoutMs;
        const acquiredBeforeReload = configuration.getConfig();
        mutableFileSystem.promises.readFile = vi.fn(async () =>
            yamlDump({
                ...readCandidate(),
                encodeQueueLimit: 0,
                storageLimitCommandTimeoutMs: { marker: 'must-not-replace-old-carrier' },
            }),
        );
        const changeListener = watchFile.mock.calls[0][1] as () => Promise<void>;

        await changeListener();

        const acquiredAfterReload = configuration.getConfig();
        expect(configuration.config).toBe(internalBeforeReload);
        expect(configuration.config.storageLimitCommandTimeoutMs).toBe(internalRawBeforeReload);
        expect(acquiredBeforeReload.storageLimitCommandTimeoutMs).toEqual(initialRawValue);
        expect(acquiredAfterReload.storageLimitCommandTimeoutMs).toEqual(initialRawValue);
        expect(acquiredAfterReload.storageLimitCommandTimeoutMs).not.toBe(
            acquiredBeforeReload.storageLimitCommandTimeoutMs,
        );
        expect(logger.system.error).toHaveBeenCalledWith(expect.any(Error));
        expectNoProcessExecution();
    });

    it('[CFG-4.2-PUBLIC-BOUNDARY] never projects the raw carrier into ConfigApiModel', async () => {
        const configuration = createConfiguration();
        configuration.config = configuration.formatConfig({
            ...readCandidate(),
            storageLimitCommandTimeoutMs: { marker: 'private-storage-timeout-carrier' },
        });
        const model = new ConfigApiModel(configuration, {
            reserveation: {
                getBroadcastStatus: async () => ({ GR: true, BS: false, CS: true, SKY: false }),
            },
        });

        const publicConfig = await model.getConfig(false);

        expect(publicConfig).not.toHaveProperty('storageLimitCommandTimeoutMs');
        expect(JSON.stringify(publicConfig)).not.toContain('private-storage-timeout-carrier');
    });
});
