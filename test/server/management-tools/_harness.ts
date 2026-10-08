import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';

const rootRequire = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

export class ProcessExit extends Error {
    constructor(readonly code: number) {
        super(`synthetic process exit ${code}`);
    }
}

export const load = <T>(...segments: string[]): T =>
    (rootRequire(join(snapshot, ...segments)) as { default: T }).default;

export const loadTool = async (
    filename: 'DBTools.js' | 'V1MigrationTool.js',
    container: { get(name: string): unknown },
    filesystem: Record<string, unknown>,
): Promise<new () => any> => {
    const path = join(snapshot, filename);
    const containerPath = join(snapshot, 'model', 'ModelContainer.js');
    const containerSetterPath = join(snapshot, 'model', 'ModelContainerSetter.js');

    // The compiled tool is ES modules (`"type": "module"`). Its own relative imports of
    // `./model/ModelContainer.js` / `./model/ModelContainerSetter.js` are resolved statically by the
    // ESM loader, so the former CommonJS technique -- patching `Module._load` and returning fakes for
    // those two specifiers -- never sees them: static `import` bindings do not go through
    // `Module._load` at all. `vi.doMock` replaces the modules in Vitest's own module graph instead;
    // `vi.resetModules()` before the dynamic `import()` forces a fresh evaluation that picks the fakes
    // up.
    vi.doMock(containerPath, () => ({ __esModule: true, default: container }));
    vi.doMock(containerSetterPath, () => ({ set: vi.fn() }));
    vi.doMock('fs', () => filesystem);

    // The compiled tool also still carries its TypeScript source's `if (require.main === module) { ... }`
    // entrypoint guard verbatim. Under `"type": "module"` neither `require` nor `module` is ever defined
    // inside a genuine ES module, so merely importing the file throws `ReferenceError: require is not
    // defined in ES module scope` before the class can even be defined -- confirmed by reproducing the
    // same compiled line outside Vitest. Node only synthesizes a `require`/`module` pair for the file
    // when a native, unpatched `require()` call reaches it (verified: patching `Module._load` -- the
    // approach a CommonJS-era suite would take for the container swap -- silently disables that
    // synthesis). `vi.doMock`'s dynamic import never goes through that path
    // either, so we provide the same harmless pair as globals ourselves for the duration of the import.
    // `require.main` is left unset so it can never equal the `module` stand-in, which keeps the guard
    // false and prevents the tool from auto-invoking itself as a side effect of being imported for tests.
    const globals = globalThis as { module?: unknown; require?: unknown };
    const hadModule = Object.prototype.hasOwnProperty.call(globals, 'module');
    const hadRequire = Object.prototype.hasOwnProperty.call(globals, 'require');
    const previousModule = globals.module;
    const previousRequire = globals.require;
    globals.require = { main: undefined };
    globals.module = {};
    try {
        vi.resetModules();
        const imported = (await import(pathToFileURL(path).href)) as { default: new () => any };
        return imported.default;
    } finally {
        if (hadModule) globals.module = previousModule;
        else delete globals.module;
        if (hadRequire) globals.require = previousRequire;
        else delete globals.require;
        vi.doUnmock(containerPath);
        vi.doUnmock(containerSetterPath);
        vi.doUnmock('fs');
    }
};

export const makeDependencies = (overrides: Record<string, unknown> = {}) => {
    const ledger: string[] = [];
    const log = { system: { error: vi.fn(), info: vi.fn((value: string) => ledger.push(`log:${value}`)) } };
    const collection = (name: string, value: unknown[] = []) => ({
        findAll: vi.fn(async () => {
            ledger.push(`read:${name}`);
            return value;
        }),
        restore: vi.fn(async () => ledger.push(`restore:${name}`)),
        insertOnce: vi.fn(async () => {
            ledger.push(`insert:${name}`);
            return 100 + ledger.length;
        }),
    });
    const dependencies: Record<string, any> = {
        ILoggerModel: { initialize: vi.fn(), getLogger: () => log },
        IConfiguration: {
            getConfig: () => ({
                recorded: [{ name: 'synthetic-recorded-root' }],
                encode: [{ name: 'synthetic-mode-1' }, { name: 'synthetic-mode-2' }, { name: 'synthetic-mode-3' }],
            }),
        },
        IConnectionCheckModel: { checkDB: vi.fn(async () => ledger.push('check-db')) },
        IDBOperator: { closeConnection: vi.fn(async () => ledger.push('close-db')) },
        IRuleDB: collection('rule', [versionlessBackup().ruleItems, 1]),
        IReserveDB: collection('reserve', [versionlessBackup().reserveItems, 1]),
        IDropLogFileDB: collection('drop-log', versionlessBackup().dropLogFileItems),
        IRecordedDB: collection('recorded', [versionlessBackup().recordedItems, 1]),
        IThumbnailDB: collection('thumbnail', versionlessBackup().thumbnailItems),
        IVideoFileDB: collection('video-file', versionlessBackup().videoFileItems),
        IRecordedHistoryDB: collection('recorded-history', versionlessBackup().recordedHistoryItems),
        IRecordedTagDB: collection('recorded-tag', [versionlessBackup().recordedTagItems, 1]),
        ...overrides,
    };
    const container = { get: vi.fn((name: string) => dependencies[name]) };
    return { container, dependencies, ledger, log };
};

export const withProcess = async <T>(argv: string[], action: () => T | Promise<T>): Promise<T> => {
    const originalArgv = process.argv;
    const originalExit = process.exit;
    process.argv = ['node', 'synthetic-tool', ...argv];
    process.exit = ((code?: number) => {
        throw new ProcessExit(code ?? 0);
    }) as never;
    try {
        return await action();
    } finally {
        process.argv = originalArgv;
        process.exit = originalExit;
    }
};

export const versionlessBackup = () => ({
    ruleItems: [{ id: 11, updateCnt: 12, keyword: 'synthetic-rule' }],
    reserveItems: [{ id: 21, name: 'synthetic-reserve' }],
    recordedItems: [{ id: 31, name: 'synthetic-recorded' }],
    thumbnailItems: [{ id: 41, recordedId: 31, filePath: 'synthetic-thumbnail.jpg' }],
    videoFileItems: [
        {
            id: 51,
            recordedId: 31,
            parentDirectoryName: 'synthetic-recorded-root',
            filePath: 'synthetic-video.ts',
            type: 'ts',
            name: 'synthetic-video',
            size: 61,
        },
    ],
    dropLogFileItems: [{ id: 61, errorCnt: 1, dropCnt: 2, scramblingCnt: 3, filePath: 'synthetic-drop.log' }],
    recordedHistoryItems: [{ id: 71, name: 'synthetic-history', channelId: 72, endAt: 73 }],
    recordedTagItems: [{ id: 81, name: 'synthetic-tag', halfWidthName: 'synthetic-tag', color: 'synthetic-color' }],
});

export const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

export const oldRule = (overrides: Record<string, unknown> = {}) => ({
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
    week: 1,
    isFree: null,
    durationMin: null,
    durationMax: null,
    enable: true,
    allowEndLack: false,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
    directory: null,
    recordedFormat: null,
    mode1: null,
    mode2: null,
    mode3: null,
    directory1: null,
    directory2: null,
    directory3: null,
    delTs: null,
    ...overrides,
});

export const oldRecorded = (overrides: Record<string, unknown> = {}) => ({
    id: 10,
    ruleId: 1,
    programId: -1,
    channelId: 2,
    channelType: 'GR',
    startAt: 10,
    endAt: 20,
    duration: 10,
    name: 'synthetic-recorded',
    description: 'synthetic-description',
    extended: 'ＡＢ',
    genre1: 1,
    genre2: 2,
    genre3: null,
    genre4: null,
    genre5: null,
    genre6: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioComponentType: null,
    audioSamplingRate: null,
    recPath: 'synthetic-media.ts',
    thumbnailPath: 'synthetic-thumbnail.jpg',
    recording: false,
    protection: false,
    filesize: null,
    logPath: null,
    errorCnt: null,
    dropCnt: null,
    scramblingCnt: null,
    isTmp: false,
    ...overrides,
});

export const v1Backup = (overrides: Record<string, unknown> = {}) => ({
    rules: [oldRule()],
    recorded: [oldRecorded()],
    encoded: [{ id: 1, recordedId: 10, path: 'synthetic-encoded.mp4', name: 'synthetic-encoded', filesize: 7 }],
    recordedHistory: [{ id: 1, name: 'synthetic-history', channelId: 2, endAt: 20 }],
    dbRevisionInfo: { revision: 13 },
    ...overrides,
});
