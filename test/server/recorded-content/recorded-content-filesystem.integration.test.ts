import { createRequire } from 'node:module';
import {
    copyFile,
    chmod,
    link,
    lstat,
    mkdtemp,
    mkdir,
    open,
    readFile,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    symlink,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const AdoptionModel = (
    require(join(snapshot, 'model/operator/recorded/RecordedUploadAdoptionModel.js')) as {
        default: new (
            uploadRoot: string,
            fileSystem?: { rename(source: string, destination: string): Promise<void> },
        ) => {
            adopt(filePath: string): Promise<string>;
            initialize(): Promise<void>;
        };
    }
).default;
const RecordedApiModel = (
    require(join(snapshot, 'model/api/recorded/RecordedApiModel.js')) as {
        default: { prototype: Record<string, unknown> };
    }
).default;

/**
 * `RecordedManageModel.js` delegates its directory walk to `FileUtil.js`, which reads/probes the
 * filesystem through `import * as fs from 'fs'` -- the same static-binding hazard as `child_process`
 * elsewhere in this migration: a plain `require('node:fs')` mutation (`vi.spyOn`) never reaches it,
 * because this suite's ESM import resolves through the test runner's own module graph, not the
 * CommonJS loader a `require(...)` mutation goes through.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` is the mechanism that actually lands
 * replacements in that binding (mirrors
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`). Both
 * `RecordedManageModel.js` and `FileUtil.js` are reloaded together, in the same `resetModules` pass, so
 * `RecordedManageModel.js`'s own `import FileUtil from '../../../util/FileUtil.js'` resolves to the
 * exact `FileUtil` object this file spies on directly.
 */
const realFs = require('node:fs') as typeof import('node:fs');
const readdirDispatch = vi.fn((...args: Parameters<typeof realFs.readdir>) => (realFs.readdir as any)(...args));
const nodeFs = { readdir: readdirDispatch };

const { FileUtil, RecordedManageModel } = await (async () => {
    const fsMock = { ...realFs, ...nodeFs };
    vi.doMock('fs', () => fsMock);
    vi.doMock('node:fs', () => fsMock);
    try {
        vi.resetModules();
        const recordedManageModelModule = (await import(
            join(snapshot, 'model/operator/recorded/RecordedManageModel.js')
        )) as { default: { prototype: Record<string, unknown> } };
        const fileUtilModule = (await import(join(snapshot, 'util/FileUtil.js'))) as {
            default: { unlink(filePath: string): Promise<void> };
        };
        return { FileUtil: fileUtilModule.default, RecordedManageModel: recordedManageModelModule.default };
    } finally {
        vi.doUnmock('fs');
        vi.doUnmock('node:fs');
    }
})();

const temporaryRoots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-upload-adoption-'));
    temporaryRoots.push(root);
    return root;
};

const createIncoming = async (root: string, token: string, contents = 'synthetic-upload'): Promise<void> => {
    await mkdir(join(root, 'incoming', token), { recursive: true });
    await writeFile(join(root, 'incoming', token, 'payload'), contents);
};

const placementFileSystem = () => {
    let openAttempts = 0;
    return {
        copyFile,
        link,
        lstat,
        mkdir,
        open: async (...args: Parameters<typeof open>) => {
            openAttempts += 1;
            if (openAttempts > 8) {
                throw new Error('unexpected extra pinned directory open');
            }
            return open(...args);
        },
        realpath,
        rename,
        rmdir,
        stat,
        unlink,
    };
};

const manageSubject = (storageRoot: string, useDefaultFileSystem = false) => {
    const value: any = Object.create(RecordedManageModel.prototype);
    value.log = { system: { info: () => undefined, error: () => undefined } };
    value.recordedDB = { findId: async () => ({ thumbnails: [] }) };
    value.videoFileDB = { insertOnce: async () => 501 };
    value.recordedEvent = { emitAddVideoFile: () => undefined, emitAddUploadedVideoFile: () => undefined };
    value.videoUtil = { getParentDirPath: () => storageRoot };
    value.recordingUtilModel = { formatFilePathString: async (input: string) => input };
    if (!useDefaultFileSystem) {
        value.uploadFileSystem = placementFileSystem();
    }
    return value;
};

const uploadOption = (filePath: string, overrides: Record<string, unknown> = {}) => ({
    recordedId: 500,
    parentDirectoryName: 'synthetic-storage',
    viewName: 'Synthetic upload',
    fileType: 'ts',
    fileName: 'synthetic.ts',
    filePath,
    ...overrides,
});

const syntheticDirectoryStats = (overrides: Record<string, unknown> = {}) => ({
    dev: 71,
    ino: 72,
    isDirectory: () => true,
    ...overrides,
});

interface CleanupVideoRow {
    readonly filePath: string;
    readonly id: number;
    readonly parentDirectoryName: string;
    readonly recordedId: number;
}

interface CleanupDropLogRow {
    readonly filePath: string;
    readonly id: number;
}

const cleanupSubject = (
    videoRoots: readonly string[],
    dropLogRoot: string,
    initialVideoRows: readonly CleanupVideoRow[] = [],
    initialDropLogRows: readonly CleanupDropLogRow[] = [],
) => {
    const videoRows = new Map(initialVideoRows.map(row => [row.id, row]));
    const dropLogRows = new Map(initialDropLogRows.map(row => [row.id, row]));
    const relatedDropLogIds = new Set(initialDropLogRows.map(row => row.id));
    const value: any = Object.create(RecordedManageModel.prototype);
    value.config = {
        dropLog: dropLogRoot,
        recorded: videoRoots.map((path, index) => ({ name: `synthetic-storage-${index}`, path })),
    };
    value.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    value.videoFileDB = {
        deleteOnce: vi.fn(async (videoFileId: number) => {
            videoRows.delete(videoFileId);
        }),
        findAll: vi.fn(async () => [...videoRows.values()]),
        findId: vi.fn(async (videoFileId: number) => videoRows.get(videoFileId) ?? null),
    };
    value.dropLogFileDB = {
        deleteOnce: vi.fn(async (dropLogFileId: number) => dropLogRows.delete(dropLogFileId)),
        findAll: vi.fn(async () => [...dropLogRows.values()]),
    };
    value.recordedDB = {
        findId: vi.fn(async (recordedId: number) => ({
            id: recordedId,
            isProtected: false,
            isRecording: false,
            videoFiles: [...videoRows.values()],
        })),
        removeDropLogFileId: vi.fn(async (dropLogFileId: number) => relatedDropLogIds.delete(dropLogFileId)),
    };
    value.recordedEvent = {
        emitDeleteVideoFile: vi.fn(),
        emitDropLogFileChanged: vi.fn(),
    };
    value.videoUtil = {
        getFullFilePathFromVideoFile: vi.fn((row: CleanupVideoRow) => join(videoRoots[0], row.filePath)),
        getParentDirPath: vi.fn(() => videoRoots[0]),
    };
    return { dropLogRows, relatedDropLogIds, target: value, videoRows };
};

const cleanupGate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const flushCleanupStarts = async (): Promise<void> => {
    for (let count = 0; count < 4; count += 1) {
        await Promise.resolve();
    }
};

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('recorded upload filesystem boundary', () => {
    it('atomically adopts only the exact incoming token payload', async () => {
        const root = await temporaryRoot();
        await createIncoming(root, 'token-a');
        const target = new AdoptionModel(root);

        await target.initialize();
        const adopted = await target.adopt(join(root, 'incoming', 'token-a', 'payload'));

        expect(adopted).toBe(join(root, 'adopted', 'token-a', 'payload'));
        await expect(readFile(adopted, 'utf8')).resolves.toBe('synthetic-upload');
        await expect(readFile(join(root, 'incoming', 'token-a', 'payload'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each([
        '/incoming/token-a/payload',
        '../incoming/token-a/payload',
        'incoming/token-a/../payload',
        'incoming/token-a/extra/payload',
        'incoming\\token-a\\payload',
        'adopted/token-a/payload',
        'incoming//payload',
        'incoming/./payload',
        'incoming/../payload',
        'incoming/token-a/not-payload',
        'incoming/token-a/payload/suffix',
    ])('rejects non-exact path %s before creating an adopted token', async filePath => {
        const root = await temporaryRoot();
        await createIncoming(root, 'token-a');
        const target = new AdoptionModel(root);
        await target.initialize();

        await expect(target.adopt(filePath)).rejects.toThrow('UploadPathError');

        await expect(readFile(join(root, 'incoming', 'token-a', 'payload'), 'utf8')).resolves.toBe('synthetic-upload');
        await expect(readFile(join(root, 'adopted', 'token-a', 'payload'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects a dot token before it can alias an incoming-root payload', async () => {
        const root = await temporaryRoot();
        await mkdir(join(root, 'incoming'));
        await writeFile(join(root, 'incoming', 'payload'), 'aliased-bytes');
        const target = new AdoptionModel(root);
        await target.initialize();

        await expect(target.adopt('incoming/./payload')).rejects.toThrow('UploadPathError');

        await expect(readFile(join(root, 'incoming', 'payload'), 'utf8')).resolves.toBe('aliased-bytes');
    });

    it('rejects a parent token before it can alias an upload-root payload', async () => {
        const root = await temporaryRoot();
        await mkdir(join(root, 'incoming'));
        await writeFile(join(root, 'payload'), 'aliased-bytes');
        const target = new AdoptionModel(root);
        await target.initialize();

        await expect(target.adopt('incoming/../payload')).rejects.toThrow('UploadPathError');

        await expect(readFile(join(root, 'payload'), 'utf8')).resolves.toBe('aliased-bytes');
    });

    it('rejects an intermediate symbolic link without changing its target', async () => {
        const root = await temporaryRoot();
        const external = await temporaryRoot();
        await mkdir(join(root, 'incoming'), { recursive: true });
        await mkdir(join(external, 'token-a'), { recursive: true });
        await writeFile(join(external, 'token-a', 'payload'), 'external-bytes');
        await symlink(join(external, 'token-a'), join(root, 'incoming', 'token-a'));
        const target = new AdoptionModel(root);
        await target.initialize();

        await expect(target.adopt('incoming/token-a/payload')).rejects.toThrow('UploadPathError');
        await expect(readFile(join(external, 'token-a', 'payload'), 'utf8')).resolves.toBe('external-bytes');
    });

    it('rejects a symbolic incoming directory without following its target', async () => {
        const root = await temporaryRoot();
        const external = await temporaryRoot();
        await createIncoming(external, 'token-a', 'external-bytes');
        await symlink(join(external, 'incoming'), join(root, 'incoming'));
        const target = new AdoptionModel(root);
        await target.initialize();

        await expect(target.adopt('incoming/token-a/payload')).rejects.toThrow('UploadPathError');
        await expect(readFile(join(external, 'incoming', 'token-a', 'payload'), 'utf8')).resolves.toBe(
            'external-bytes',
        );
    });

    it('does not rename or alter either request when the adopted token already exists', async () => {
        const root = await temporaryRoot();
        await createIncoming(root, 'token-a', 'incoming-bytes');
        await mkdir(join(root, 'adopted', 'token-a'), { recursive: true });
        await writeFile(join(root, 'adopted', 'token-a', 'payload'), 'existing-bytes');
        const target = new AdoptionModel(root);

        await expect(target.adopt('incoming/token-a/payload')).rejects.toMatchObject({ code: 'EEXIST' });

        await expect(readFile(join(root, 'incoming', 'token-a', 'payload'), 'utf8')).resolves.toBe('incoming-bytes');
        await expect(readFile(join(root, 'adopted', 'token-a', 'payload'), 'utf8')).resolves.toBe('existing-bytes');
    });

    it('removes only its newly-created empty token directory when raw rename fails', async () => {
        const root = await temporaryRoot();
        await createIncoming(root, 'token-a');
        const failure = Object.assign(new Error('synthetic raw rename failure'), { code: 'EIO' });
        const target = new AdoptionModel(root, { rename: async () => Promise.reject(failure) });
        await target.initialize();

        await expect(target.adopt('incoming/token-a/payload')).rejects.toBe(failure);

        await expect(readFile(join(root, 'incoming', 'token-a', 'payload'), 'utf8')).resolves.toBe('synthetic-upload');
        await expect(readFile(join(root, 'adopted', 'token-a', 'payload'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(mkdir(join(root, 'adopted', 'token-a'))).resolves.toBeUndefined();
    });

    it('does not create an adopted token when child unlink wins before adoption', async () => {
        const root = await temporaryRoot();
        await createIncoming(root, 'token-a');
        const target = new AdoptionModel(root);
        await target.initialize();
        await rm(join(root, 'incoming', 'token-a', 'payload'));

        await expect(target.adopt('incoming/token-a/payload')).rejects.toThrow('UploadPathError');
        await expect(mkdir(join(root, 'adopted', 'token-a'))).resolves.toBeUndefined();
    });

    it('cleans stale adopted tokens at initialization without touching incoming or storage files', async () => {
        const root = await temporaryRoot();
        const storage = await temporaryRoot();
        await createIncoming(root, 'owned-by-child', 'incoming-bytes');
        await mkdir(join(root, 'adopted', 'stale-token'), { recursive: true });
        await writeFile(join(root, 'adopted', 'stale-token', 'payload'), 'stale-bytes');
        await writeFile(join(storage, 'recorded.ts'), 'recorded-bytes');

        await new AdoptionModel(root).initialize();

        await expect(readFile(join(root, 'adopted', 'stale-token', 'payload'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await expect(readFile(join(root, 'incoming', 'owned-by-child', 'payload'), 'utf8')).resolves.toBe(
            'incoming-bytes',
        );
        await expect(readFile(join(storage, 'recorded.ts'), 'utf8')).resolves.toBe('recorded-bytes');
    });

    it('unlinks stale file and symbolic-link token entries without following links', async () => {
        const root = await temporaryRoot();
        const external = await temporaryRoot();
        await mkdir(join(root, 'adopted'), { recursive: true });
        await writeFile(join(root, 'adopted', 'stale-file'), 'stale-file-bytes');
        await writeFile(join(external, 'target'), 'external-bytes');
        await symlink(join(external, 'target'), join(root, 'adopted', 'stale-link'));

        await new AdoptionModel(root).initialize();

        await expect(lstat(join(root, 'adopted', 'stale-file'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(join(root, 'adopted', 'stale-link'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(external, 'target'), 'utf8')).resolves.toBe('external-bytes');
    });

    it('rejects an adopted namespace that is not a directory', async () => {
        const root = await temporaryRoot();
        await writeFile(join(root, 'adopted'), 'not-a-directory');

        await expect(new AdoptionModel(root).initialize()).rejects.toThrow('UploadPathError');

        await expect(readFile(join(root, 'adopted'), 'utf8')).resolves.toBe('not-a-directory');
    });

    it('creates a missing nested upload root before cleaning adopted staging', async () => {
        const parent = await temporaryRoot();
        const root = join(parent, 'missing', 'upload-root');

        await new AdoptionModel(root).initialize();

        expect((await lstat(join(root, 'adopted'))).isDirectory()).toBe(true);
    });

    it('propagates an adopted namespace creation failure', async () => {
        const root = await temporaryRoot();
        await chmod(root, 0o500);
        try {
            await expect(new AdoptionModel(root).initialize()).rejects.toMatchObject({ code: 'EACCES' });
        } finally {
            await chmod(root, 0o700);
        }
    });

    it('classifies exclusive hard-link outcomes without retrying the boundary itself', async () => {
        const root = await temporaryRoot();
        const target = manageSubject(root);
        const failure = Object.assign(new Error('hard-link failure'), { code: 'EIO' });
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'EEXIST' }))
                .mockRejectedValueOnce(failure),
        };
        const cleanup = { bestEffort: vi.fn(async () => undefined) };

        await expect(target.createUploadCandidate('source-a', 'candidate-a', cleanup, {})).resolves.toBe(true);
        await expect(target.createUploadCandidate('source-b', 'candidate-b', cleanup, {})).resolves.toBe(false);
        await expect(target.createUploadCandidate('source-c', 'candidate-c', cleanup, {})).rejects.toThrow(
            'FileMoveError',
        );
        expect(cleanup.bestEffort).not.toHaveBeenCalled();
    });

    it('classifies exclusive cross-device copy outcomes without retrying the placement loop', async () => {
        const root = await temporaryRoot();
        const target = manageSubject(root);
        const copyFailure = Object.assign(new Error('copy failure'), { code: 'EIO' });
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
            copyFile: vi
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('copy conflict'), { code: 'EEXIST' }))
                .mockRejectedValueOnce(copyFailure)
                .mockResolvedValueOnce(undefined),
        };
        const cleanup = {
            bestEffort: vi.fn(async () => undefined),
        };

        await expect(target.createUploadCandidate('source-a', 'candidate-a', cleanup, {})).resolves.toBe(false);
        await expect(target.createUploadCandidate('source-b', 'candidate-b', cleanup, {})).rejects.toThrow(
            'FileMoveError',
        );
        await expect(target.createUploadCandidate('source-c', 'candidate-c', cleanup, {})).resolves.toBe(true);
    });

    it('rejects a formatted parent traversal before creating, moving, or registering a file', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const outside = join(root, 'outside');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await mkdir(outside);
        await writeFile(join(outside, 'existing.ts'), 'outside-bytes');
        await writeFile(adopted, 'adopted-bytes');
        const target = manageSubject(storage);
        let inserts = 0;
        target.videoFileDB.insertOnce = async () => ++inserts;

        await expect(
            target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: '../outside' })),
        ).rejects.toThrow('UploadPathError');

        expect(inserts).toBe(0);
        await expect(readFile(join(outside, 'existing.ts'), 'utf8')).resolves.toBe('outside-bytes');
        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(['/absolute', 'nested\\child', 'nested//child', '.', '..', 'nested/../escape'])(
        'rejects unsafe subdirectory grammar %s before placement',
        async subDirectory => {
            const root = await temporaryRoot();
            const storage = join(root, 'storage');
            const adopted = join(root, 'adopted-payload');
            await mkdir(storage);
            await writeFile(adopted, 'uploaded-bytes');

            await expect(
                manageSubject(storage).addUploadedVideoFile(uploadOption(adopted, { subDirectory })),
            ).rejects.toThrow('UploadPathError');

            await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        },
    );

    it.each([
        ['new nested directory', false],
        ['existing nested directory', true],
    ])('places into a valid %s without following links', async (_label, precreate) => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        if (precreate) {
            await mkdir(join(storage, 'nested', 'child'), { recursive: true });
        }
        await writeFile(adopted, 'uploaded-bytes');

        await manageSubject(storage).addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'nested/child' }));

        await expect(readFile(join(storage, 'nested', 'child', 'synthetic.ts'), 'utf8')).resolves.toBe(
            'uploaded-bytes',
        );
    });

    it('treats an empty formatted subdirectory as the selected storage root', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');

        await manageSubject(storage).addUploadedVideoFile(uploadOption(adopted, { subDirectory: '' }));

        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('uses the injected root resolver and skips formatting when no subdirectory was supplied', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const resolveRoot = vi.fn(async () => storage);
        const formatSubdirectory = vi.fn(async () => Promise.reject(new Error('unexpected formatter call')));
        target.uploadFileSystem = { ...placementFileSystem(), realpath: resolveRoot };
        target.recordingUtilModel.formatFilePathString = formatSubdirectory;

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(resolveRoot).toHaveBeenCalledOnce();
        expect(formatSubdirectory).not.toHaveBeenCalled();
    });

    it('prepares the selected storage root through the production filesystem adapter', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        await mkdir(storage);
        const target = manageSubject(storage, true);

        const prepared = await target.prepareUploadDirectory(storage);

        expect(prepared.logicalPath).toBe(storage);
        await prepared.close();
    });

    it.each(['nested//child', '.', '..'])(
        'rejects unsafe segment grammar %s before opening a descriptor',
        async subDirectory => {
            const root = await temporaryRoot();
            const storage = join(root, 'storage');
            await mkdir(storage);
            const target = manageSubject(storage);
            const descriptorOpen = vi.fn(async () =>
                Promise.reject(new Error('unexpected descriptor open for invalid grammar')),
            );
            target.uploadFileSystem = { ...placementFileSystem(), open: descriptorOpen };

            await expect(target.prepareUploadDirectory(storage, subDirectory)).rejects.toThrow('UploadPathError');

            expect(descriptorOpen).not.toHaveBeenCalled();
        },
    );

    it('shares one underlying close attempt across repeated pinned handle closes', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        await mkdir(storage);
        const target = manageSubject(storage);
        const close = vi.fn();
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async (...args: Parameters<typeof open>) => {
                const handle = await open(...args);
                return {
                    fd: handle.fd,
                    stat: () => handle.stat(),
                    close: async () => {
                        close();
                        await handle.close();
                    },
                };
            },
        };

        const prepared = await target.prepareUploadDirectory(storage);
        await prepared.close();
        await prepared.close();

        expect(close).toHaveBeenCalledOnce();
    });

    it('closes every pinned directory handle exactly once after nested placement', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const closes: Array<ReturnType<typeof vi.fn>> = [];
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async (...args: Parameters<typeof open>) => {
                const handle = await open(...args);
                if (typeof args[1] !== 'number') {
                    return handle;
                }
                const close = vi.fn(async () => handle.close());
                closes.push(close);
                return { fd: handle.fd, stat: () => handle.stat(), close };
            },
        };

        await target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'nested/child' }));

        expect(closes).toHaveLength(3);
        for (const close of closes) {
            expect(close).toHaveBeenCalledOnce();
        }
    });

    it('closes the pinned parent once when opening a child directory fails', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const close = vi.fn();
        let directoryOpenAttempts = 0;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async (...args: Parameters<typeof open>) => {
                if (typeof args[1] !== 'number') {
                    return open(...args);
                }
                directoryOpenAttempts += 1;
                if (directoryOpenAttempts === 2) {
                    throw Object.assign(new Error('synthetic child open failure'), { code: 'EIO' });
                }
                const handle = await open(...args);
                return {
                    fd: handle.fd,
                    stat: () => handle.stat(),
                    close: async () => {
                        close();
                        await handle.close();
                    },
                };
            },
        };

        await expect(
            target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'nested' })),
        ).rejects.toMatchObject({ code: 'EIO' });

        expect(close).toHaveBeenCalledOnce();
        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('closes the pinned child once and preserves a parent close failure', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        await mkdir(storage);
        const target = manageSubject(storage);
        const failure = new Error('synthetic parent close failure');
        const parentClose = vi.fn();
        const childClose = vi.fn();
        let directoryOpenAttempts = 0;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async (...args: Parameters<typeof open>) => {
                const handle = await open(...args);
                directoryOpenAttempts += 1;
                return {
                    fd: handle.fd,
                    stat: () => handle.stat(),
                    close:
                        directoryOpenAttempts === 1
                            ? async () => {
                                  parentClose();
                                  await handle.close();
                                  throw failure;
                              }
                            : async () => {
                                  childClose();
                                  await handle.close();
                              },
                };
            },
        };

        await expect(target.prepareUploadDirectory(storage, 'nested')).rejects.toBe(failure);

        expect(parentClose).toHaveBeenCalledOnce();
        expect(childClose).toHaveBeenCalledOnce();
    });

    it('attempts the final pinned handle close once without rolling back a committed upload', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const insert = vi.fn(async () => 701);
        const close = vi.fn();
        const logError = vi.fn();
        target.videoFileDB.insertOnce = insert;
        target.log.system.error = logError;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async (...args: Parameters<typeof open>) => {
                const handle = await open(...args);
                return {
                    fd: handle.fd,
                    stat: () => handle.stat(),
                    close: async () => {
                        close();
                        await handle.close();
                        throw new Error('synthetic close failure');
                    },
                };
            },
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).resolves.toBeUndefined();

        expect(close).toHaveBeenCalledOnce();
        expect(insert).toHaveBeenCalledOnce();
        expect(logError.mock.calls).toEqual([
            ['failed to close pinned upload directory'],
            [expect.objectContaining({ message: 'synthetic close failure' })],
        ]);
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('removes the empty adopted token directory after placing its exact payload', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const tokenDirectory = join(root, 'adopted', 'token-a');
        const adopted = join(tokenDirectory, 'payload');
        await mkdir(storage);
        await mkdir(tokenDirectory, { recursive: true });
        await writeFile(adopted, 'uploaded-bytes');

        await manageSubject(storage).addUploadedVideoFile(uploadOption(adopted));

        await expect(lstat(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('does not remove a directory for a source outside the adopted token grammar', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const removeDirectory = vi.fn(rmdir);
        target.uploadFileSystem = { ...placementFileSystem(), rmdir: removeDirectory };

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it.each([
        ['payload outside adopted', ['not-adopted', 'token-a', 'payload']],
        ['non-payload inside adopted', ['adopted', 'token-a', 'other']],
    ])('does not remove a token directory for %s', async (_label, sourceSegments) => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const tokenDirectory = join(root, sourceSegments[0], sourceSegments[1]);
        const source = join(tokenDirectory, sourceSegments[2]);
        await mkdir(storage);
        await mkdir(tokenDirectory, { recursive: true });
        await writeFile(source, 'uploaded-bytes');
        const target = manageSubject(storage);
        const removeDirectory = vi.fn(rmdir);
        target.uploadFileSystem = { ...placementFileSystem(), rmdir: removeDirectory };

        await target.addUploadedVideoFile(uploadOption(source));

        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it('keeps placement committed when empty adopted token cleanup fails', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const tokenDirectory = join(root, 'adopted', 'token-a');
        const adopted = join(tokenDirectory, 'payload');
        await mkdir(storage);
        await mkdir(tokenDirectory, { recursive: true });
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const cleanupFailure = Object.assign(new Error('rmdir failure'), { code: 'EIO' });
        target.uploadFileSystem = {
            ...placementFileSystem(),
            rmdir: async () => Promise.reject(cleanupFailure),
        };

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect((await lstat(tokenDirectory)).isDirectory()).toBe(true);
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('cleans the adopted payload and token directory when recorded lookup rejects', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const tokenDirectory = join(root, 'adopted', 'token-a');
        const adopted = join(tokenDirectory, 'payload');
        await mkdir(storage);
        await mkdir(tokenDirectory, { recursive: true });
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const failure = new Error('synthetic recorded lookup failure');
        target.recordedDB.findId = async () => Promise.reject(failure);

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toBe(failure);

        await expect(lstat(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('cleans the adopted payload when the recording does not exist', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.recordedDB.findId = async () => null;

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('RecordedIdIsNull');

        await expect(lstat(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('cleans the adopted payload when the configured storage does not exist', async () => {
        const root = await temporaryRoot();
        const adopted = join(root, 'adopted-payload');
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(root);
        const logError = vi.fn();
        target.videoUtil.getParentDirPath = () => null;
        target.log.system.error = logError;

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('ParentDirectoryIsNull');

        expect(logError).toHaveBeenCalledWith('parent directory is null: synthetic-storage');
        await expect(lstat(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each([new Error('open failure without a code'), 'non-error open failure', null])(
        'propagates a pinned directory open failure %p unchanged',
        async failure => {
            const root = await temporaryRoot();
            const storage = join(root, 'storage');
            const adopted = join(root, 'adopted-payload');
            await mkdir(storage);
            await writeFile(adopted, 'uploaded-bytes');
            const target = manageSubject(storage);
            target.uploadFileSystem = {
                ...placementFileSystem(),
                open: async () => Promise.reject(failure),
            };

            await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toBe(failure);

            await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        },
    );

    it.each(['ELOOP', 'ENOENT', 'ENOTDIR'])(
        'normalizes descriptor path validation error %s without opening a candidate',
        async code => {
            const root = await temporaryRoot();
            const storage = join(root, 'storage');
            await mkdir(storage);
            const target = manageSubject(storage);
            target.uploadFileSystem = {
                ...placementFileSystem(),
                open: async () => Promise.reject(Object.assign(new Error('synthetic path failure'), { code })),
            };

            await expect(target.prepareUploadDirectory(storage)).rejects.toThrow('UploadPathError');
        },
    );

    it('closes a descriptor whose own stat is not a directory', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        await mkdir(storage);
        const target = manageSubject(storage);
        const close = vi.fn(async () => undefined);
        const descriptorStat = vi.fn(async () => syntheticDirectoryStats());
        const logicalStat = vi.fn(async () => syntheticDirectoryStats());
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async () => ({
                fd: 73,
                stat: async () => syntheticDirectoryStats({ isDirectory: () => false }),
                close,
            }),
            stat: descriptorStat,
            lstat: logicalStat,
        };

        await expect(target.prepareUploadDirectory(storage)).rejects.toThrow('UploadPathError');

        expect(close).toHaveBeenCalledOnce();
        expect(descriptorStat).not.toHaveBeenCalled();
        expect(logicalStat).not.toHaveBeenCalled();
    });

    it('closes a descriptor when its descriptor-relative stat cannot be resolved', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        await mkdir(storage);
        const target = manageSubject(storage);
        const close = vi.fn(async () => undefined);
        target.uploadFileSystem = {
            ...placementFileSystem(),
            open: async () => ({
                fd: 74,
                stat: async () => syntheticDirectoryStats(),
                close,
            }),
            stat: async () => Promise.reject(new Error('synthetic descriptor stat failure')),
        };

        await expect(target.prepareUploadDirectory(storage)).rejects.toThrow('UploadPathError');

        expect(close).toHaveBeenCalledOnce();
    });

    it.each([
        ['descriptor type', syntheticDirectoryStats({ isDirectory: () => false }), syntheticDirectoryStats()],
        ['logical type', syntheticDirectoryStats(), syntheticDirectoryStats({ isDirectory: () => false })],
        ['descriptor device', syntheticDirectoryStats({ dev: 81 }), syntheticDirectoryStats()],
        ['descriptor inode', syntheticDirectoryStats({ ino: 82 }), syntheticDirectoryStats()],
        ['logical device', syntheticDirectoryStats(), syntheticDirectoryStats({ dev: 83 })],
        ['logical inode', syntheticDirectoryStats(), syntheticDirectoryStats({ ino: 84 })],
    ])('rejects a pinned directory %s identity mismatch', async (_label, descriptorStats, logicalStats) => {
        const root = await temporaryRoot();
        const target = manageSubject(root);
        target.uploadFileSystem = {
            ...placementFileSystem(),
            stat: async () => descriptorStats,
            lstat: async () => logicalStats,
        };
        const directory = {
            descriptorPath: '/synthetic-descriptor-path',
            logicalPath: '/synthetic-logical-path',
            identity: { dev: 71, ino: 72 },
        };

        await expect(target.assertPinnedUploadDirectory(directory)).rejects.toThrow('UploadPathError');
    });

    it('propagates directory creation failure after cleaning only adopted', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const failure = Object.assign(new Error('synthetic mkdir failure'), { code: 'EACCES' });
        target.uploadFileSystem = {
            ...placementFileSystem(),
            mkdir: async () => Promise.reject(failure),
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'nested' }))).rejects.toBe(
            failure,
        );

        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(join(storage, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects a storage root that is not a directory before placement', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage-file');
        const adopted = join(root, 'adopted-payload');
        await writeFile(storage, 'storage-bytes');
        await writeFile(adopted, 'uploaded-bytes');

        await expect(manageSubject(storage).addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow(
            'UploadPathError',
        );

        await expect(readFile(storage, 'utf8')).resolves.toBe('storage-bytes');
    });

    it('rejects an intermediate storage symlink without following or modifying its target', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const external = join(root, 'external');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await mkdir(external);
        await writeFile(join(external, 'existing.ts'), 'external-bytes');
        await symlink(external, join(storage, 'linked'));
        await writeFile(adopted, 'adopted-bytes');
        const target = manageSubject(storage);

        await expect(
            target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'linked/nested' })),
        ).rejects.toThrow('UploadPathError');

        await expect(readFile(join(external, 'existing.ts'), 'utf8')).resolves.toBe('external-bytes');
        await expect(readFile(join(external, 'nested', 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('pins the selected directory identity across a symlink swap before the placement effect', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const selected = join(storage, 'selected');
        const displaced = join(root, 'displaced');
        const outside = join(root, 'outside');
        const adopted = join(root, 'adopted-payload');
        await mkdir(selected, { recursive: true });
        await mkdir(outside);
        await writeFile(join(outside, 'existing.ts'), 'outside-bytes');
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        let swapped = false;
        const swapDirectory = async () => {
            if (swapped) {
                return;
            }
            swapped = true;
            await rename(selected, displaced);
            await symlink(outside, selected);
        };
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async (source: string, destination: string) => {
                await swapDirectory();
                await link(source, destination);
            },
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'selected' }))).rejects.toThrow(
            'UploadPathError',
        );

        await expect(readFile(join(outside, 'existing.ts'), 'utf8')).resolves.toBe('outside-bytes');
        await expect(lstat(join(outside, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(join(displaced, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('preserves conflicting files and exclusively selects the next numbered candidate', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(join(storage, 'synthetic.ts'), 'existing-zero');
        await writeFile(join(storage, 'synthetic(1).ts'), 'existing-one');
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);

        await target.addUploadedVideoFile(uploadOption(adopted));

        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('existing-zero');
        await expect(readFile(join(storage, 'synthetic(1).ts'), 'utf8')).resolves.toBe('existing-one');
        await expect(readFile(join(storage, 'synthetic(2).ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('does not overwrite a writer that creates the first candidate at the placement commit boundary', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        const firstDestination = join(storage, 'synthetic.ts');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        let raced = false;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async (source: string, destination: string) => {
                if (!raced) {
                    raced = true;
                    await writeFile(firstDestination, 'competitor-bytes', { flag: 'wx' });
                }
                await link(source, destination);
            },
        };

        await target.addUploadedVideoFile(uploadOption(adopted));

        await expect(readFile(firstDestination, 'utf8')).resolves.toBe('competitor-bytes');
        await expect(readFile(join(storage, 'synthetic(1).ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('uses the pinned descriptor to clean its candidate when the directory is swapped during DB rejection', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const selected = join(storage, 'selected');
        const displaced = join(root, 'displaced');
        const outside = join(root, 'outside');
        const adopted = join(root, 'adopted-payload');
        await mkdir(selected, { recursive: true });
        await mkdir(outside);
        await writeFile(join(outside, 'synthetic.ts'), 'outside-competitor');
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const failure = new Error('synthetic DB failure');
        target.videoFileDB.insertOnce = async () => {
            await rename(selected, displaced);
            await symlink(outside, selected);
            throw failure;
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'selected' }))).rejects.toBe(
            failure,
        );

        await expect(readFile(join(outside, 'synthetic.ts'), 'utf8')).resolves.toBe('outside-competitor');
        await expect(lstat(join(displaced, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('registers the placed descriptor size when the logical directory changes after final validation', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const displaced = join(root, 'displaced');
        const adopted = join(root, 'adopted-payload');
        const replacementContents = 'replacement-file-with-a-different-size';
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const insert = vi.fn(async () => 501);
        const descriptorStats = vi.fn((filePath: string) => stat(filePath));
        let logicalDirectoryChecks = 0;
        target.videoFileDB.insertOnce = insert;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            stat: descriptorStats,
            lstat: async (filePath: string) => {
                const stats = await lstat(filePath);
                if (filePath === storage) {
                    logicalDirectoryChecks += 1;
                    if (logicalDirectoryChecks === 4) {
                        await rename(storage, displaced);
                        await mkdir(storage);
                        await writeFile(join(storage, 'synthetic.ts'), replacementContents);
                    }
                }
                return stats;
            },
        };

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(logicalDirectoryChecks).toBe(4);
        expect(insert.mock.calls[0][0]).toMatchObject({ filePath: 'synthetic.ts', size: 14 });
        expect(
            descriptorStats.mock.calls
                .map(([filePath]) => filePath)
                .filter(filePath => basename(filePath) === 'synthetic.ts'),
        ).toHaveLength(1);
        await expect(readFile(join(displaced, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe(replacementContents);
    });

    it('gives simultaneous requests distinct exclusive candidates without overwriting either payload', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adoptedA = join(root, 'adopted-a');
        const adoptedB = join(root, 'adopted-b');
        await mkdir(storage);
        await writeFile(adoptedA, 'upload-a');
        await writeFile(adoptedB, 'upload-b');

        await Promise.all([
            manageSubject(storage).addUploadedVideoFile(uploadOption(adoptedA)),
            manageSubject(storage).addUploadedVideoFile(uploadOption(adoptedB)),
        ]);

        const contents = await Promise.all([
            readFile(join(storage, 'synthetic.ts'), 'utf8'),
            readFile(join(storage, 'synthetic(1).ts'), 'utf8'),
        ]);
        expect(contents.sort()).toEqual(['upload-a', 'upload-b']);
    });

    it('uses an exclusive copy fallback and removes adopted only after copy completion', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        let linkAttempts = 0;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => {
                linkAttempts += 1;
                throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
            },
        };

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(linkAttempts).toBe(1);
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects a non-cross-device hard-link failure without creating a destination', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('hard-link failure'), { code: 'EIO' })),
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('FileMoveError');

        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('cleans both a partial copy and adopted when copy fallback fails', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
            copyFile: async (_source: string, destination: string) => {
                await writeFile(destination, 'partial-bytes');
                throw Object.assign(new Error('copy failure'), { code: 'EIO' });
            },
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('FileMoveError');

        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('preserves a copy competitor and retries with the next exclusive candidate', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        const firstDestination = join(storage, 'synthetic.ts');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
            copyFile: async (source: string, destination: string, mode?: number) => {
                if (basename(destination) === 'synthetic.ts') {
                    await writeFile(destination, 'competitor-bytes', { flag: 'wx' });
                    throw Object.assign(new Error('copy competitor'), { code: 'EEXIST' });
                }
                await copyFile(source, destination, mode);
            },
        };

        await target.addUploadedVideoFile(uploadOption(adopted));

        await expect(readFile(firstDestination, 'utf8')).resolves.toBe('competitor-bytes');
        await expect(readFile(join(storage, 'synthetic(1).ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('does not commit destination ownership when adopted unlink fails after copy', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        let adoptedUnlinkAttempts = 0;
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
            unlink: async (filePath: string) => {
                if (filePath === adopted) {
                    adoptedUnlinkAttempts += 1;
                    throw Object.assign(new Error('unlink failure'), { code: 'EIO' });
                }
                await unlink(filePath);
            },
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('FileMoveError');

        expect(adoptedUnlinkAttempts).toBe(1);
        await expect(readFile(adopted, 'utf8')).resolves.toBe('uploaded-bytes');
        await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(['', '.', '..', '/synthetic.ts', '../synthetic.ts', 'nested/synthetic.ts', 'nested\\synthetic.ts'])(
        'rejects unsafe file name %s before creating a candidate',
        async fileName => {
            const root = await temporaryRoot();
            const storage = join(root, 'storage');
            const adopted = join(root, 'adopted-payload');
            await mkdir(storage);
            await writeFile(adopted, 'uploaded-bytes');
            const target = manageSubject(storage);

            await expect(target.addUploadedVideoFile(uploadOption(adopted, { fileName }))).rejects.toThrow(
                'UploadPathError',
            );

            await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        },
    );

    it.each([
        ['254-byte', `a.${'x'.repeat(252)}`],
        ['255-byte', `a.${'x'.repeat(253)}`],
    ])('places a valid %s original name unchanged when the destination is empty', async (_label, fileName) => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const insert = vi.fn(async () => 501);
        const target = manageSubject(storage);
        target.videoFileDB.insertOnce = insert;

        await target.addUploadedVideoFile(uploadOption(adopted, { fileName }));

        expect(Buffer.byteLength(fileName)).toBe(Number.parseInt(_label, 10));
        expect(insert.mock.calls[0][0]).toMatchObject({ filePath: fileName, size: 14 });
        await expect(readFile(join(storage, fileName), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it.each([
        ['single-byte stem', `${'a'.repeat(252)}.ts`, `${'a'.repeat(249)}(1).ts`],
        ['multi-byte stem', `${'録'.repeat(84)}.ts`, `${'録'.repeat(83)}(1).ts`],
    ])('keeps a colliding 255-byte %s within NAME_MAX without splitting UTF-8', async (_label, fileName, expected) => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(join(storage, fileName), 'competitor-bytes');
        await writeFile(adopted, 'uploaded-bytes');

        await manageSubject(storage).addUploadedVideoFile(uploadOption(adopted, { fileName }));

        expect(Buffer.byteLength(expected)).toBe(255);
        await expect(readFile(join(storage, fileName), 'utf8')).resolves.toBe('competitor-bytes');
        await expect(readFile(join(storage, expected), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('rejects a numbered collision candidate that cannot fit within NAME_MAX', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        const fileName = `a.${'x'.repeat(252)}`;
        await mkdir(storage);
        await writeFile(join(storage, fileName), 'competitor-bytes');
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const insert = vi.fn();
        const linkAttempts = vi.fn((source: string, destination: string) => link(source, destination));
        target.videoFileDB.insertOnce = insert;
        target.uploadFileSystem = { ...placementFileSystem(), link: linkAttempts };

        await expect(target.addUploadedVideoFile(uploadOption(adopted, { fileName }))).rejects.toThrow(
            'UploadPathError',
        );

        expect(linkAttempts).toHaveBeenCalledOnce();
        expect(insert).not.toHaveBeenCalled();
        await expect(readFile(join(storage, fileName), 'utf8')).resolves.toBe('competitor-bytes');
        await expect(lstat(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('accepts a numbered candidate whose suffix and extension exactly fill NAME_MAX', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        const fileName = `a.${'x'.repeat(251)}`;
        const expected = `(1)${extname(fileName)}`;
        await mkdir(storage);
        await writeFile(join(storage, fileName), 'competitor-bytes');
        await writeFile(adopted, 'uploaded-bytes');

        await manageSubject(storage).addUploadedVideoFile(uploadOption(adopted, { fileName }));

        expect(Buffer.byteLength(expected)).toBe(255);
        await expect(readFile(join(storage, fileName), 'utf8')).resolves.toBe('competitor-bytes');
        await expect(readFile(join(storage, expected), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    // 10_000 is uploadCandidateLimit (src/model/operator/recorded/RecordedManageModel.ts:62), a
    // v3-only internal safety bound on the `(1)`..`(9999)` candidate search with no v2
    // counterpart -- approved in .kiro/specs/server-recorded-content/tasks.md:158.
    it('bounds an all-conflict candidate search at 10000 attempts and cleans only its adopted source', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const linkAttempts = vi.fn(async () =>
            Promise.reject(Object.assign(new Error('conflict'), { code: 'EEXIST' })),
        );
        const directoryOpen = vi.fn((...args: Parameters<typeof open>) => open(...args));
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: linkAttempts,
            open: directoryOpen,
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('UploadCandidateLimitError');

        expect(linkAttempts).toHaveBeenCalledTimes(10_000);
        expect(directoryOpen).toHaveBeenCalledOnce();
        expect(typeof directoryOpen.mock.calls[0][1]).toBe('number');
        await expect(lstat(adopted)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps the placed file and DB row when both post-commit notifications fail', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const insert = vi.fn(async () => 601);
        const addFileNotification = vi.fn(() => {
            throw new Error('synthetic file notification failure');
        });
        const thumbnailNotification = vi.fn(() => {
            throw new Error('synthetic thumbnail notification failure');
        });
        target.videoFileDB.insertOnce = insert;
        target.recordedEvent = {
            emitAddVideoFile: addFileNotification,
            emitAddUploadedVideoFile: thumbnailNotification,
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).resolves.toBeUndefined();

        expect(insert).toHaveBeenCalledOnce();
        expect(insert.mock.calls[0][0]).toMatchObject({
            recordedId: 500,
            parentDirectoryName: 'synthetic-storage',
            filePath: 'synthetic.ts',
            type: 'ts',
            name: 'Synthetic upload',
            size: 14,
        });
        expect(addFileNotification).toHaveBeenCalledWith(601);
        expect(thumbnailNotification).toHaveBeenCalledWith(601, true);
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('removes the moved destination and skips notifications when DB registration fails', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const failure = new Error('synthetic DB failure');
        const addFileNotification = vi.fn();
        const thumbnailNotification = vi.fn();
        target.videoFileDB.insertOnce = vi.fn(async () => Promise.reject(failure));
        target.recordedEvent = {
            emitAddVideoFile: addFileNotification,
            emitAddUploadedVideoFile: thumbnailNotification,
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toBe(failure);

        expect(addFileNotification).not.toHaveBeenCalled();
        expect(thumbnailNotification).not.toHaveBeenCalled();
        await expect(readFile(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('swallows a failed rollback unlink of the placed file after DB registration fails', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const dbFailure = new Error('synthetic DB failure');
        const rollbackUnlinkFailure = new Error('synthetic rollback unlink failure');
        target.videoFileDB.insertOnce = vi.fn(async () => Promise.reject(dbFailure));
        target.uploadFileSystem = {
            ...placementFileSystem(),
            unlink: async (filePath: string) => {
                // The rollback in the outer catch unlinks through the pinned directory's
                // descriptor-relative path (/proc/self/fd/<n>/...), while the earlier, required
                // removal of the source token inside `placeUploadedFile` unlinks the plain
                // filesystem path -- only the former is the rollback this test targets.
                if (filePath.includes('/proc/self/fd/')) {
                    throw rollbackUnlinkFailure;
                }
                return unlink(filePath);
            },
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toBe(dbFailure);

        // the rollback unlink failure was swallowed instead of masking the DB failure, so the
        // placed file is still on disk (the failed rollback never removed it).
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
    });

    it('logs the FileMoveError itself when its underlying cause is undefined', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        const errorLog = vi.fn();
        target.log = { system: { info: () => undefined, error: errorLog } };
        target.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
            // Rejecting with a non-Error value means `fileSystemErrorCode` treats it as an
            // unrecognized failure and the eventual `new Error('FileMoveError', { cause: error })`
            // is built with a falsy `cause`, exercising the `error.cause ?? error` fallback.
            copyFile: async () => Promise.reject(undefined),
        };

        await expect(target.addUploadedVideoFile(uploadOption(adopted))).rejects.toThrow('FileMoveError');

        const loggedFallbackError = errorLog.mock.calls.some(
            ([logged]) => logged instanceof Error && logged.message === 'FileMoveError',
        );
        expect(loggedFallbackError).toBe(true);
    });

    it('walks the entire upload placement through the production filesystem adapter with a nested subdirectory', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const tokenDirectory = join(root, 'adopted', 'token-prod');
        const adopted = join(tokenDirectory, 'payload');
        await mkdir(storage);
        await mkdir(tokenDirectory, { recursive: true });
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage, true);
        target.videoFileDB.insertOnce = vi.fn(async () => 601);

        await target.addUploadedVideoFile(uploadOption(adopted, { subDirectory: 'nested' }));

        await expect(readFile(join(storage, 'nested', 'synthetic.ts'), 'utf8')).resolves.toBe('uploaded-bytes');
        expect(target.videoFileDB.insertOnce).toHaveBeenCalledOnce();
        expect(target.videoFileDB.insertOnce.mock.calls[0][0]).toMatchObject({
            filePath: join('nested', 'synthetic.ts'),
        });
        // the adopted token directory was cleaned up through the production `rmdir` once its
        // payload was consumed by the placement.
        await expect(lstat(tokenDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reports that no thumbnail is needed when the recording already has one', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.recordedDB.findId = async () => ({ thumbnails: [{ id: 1 }] });
        const thumbnailNotification = vi.fn();
        target.recordedEvent.emitAddUploadedVideoFile = thumbnailNotification;

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(thumbnailNotification).toHaveBeenCalledWith(501, false);
    });

    it('requests a thumbnail when legacy recording data omits the thumbnail collection', async () => {
        const root = await temporaryRoot();
        const storage = join(root, 'storage');
        const adopted = join(root, 'adopted-payload');
        await mkdir(storage);
        await writeFile(adopted, 'uploaded-bytes');
        const target = manageSubject(storage);
        target.recordedDB.findId = async () => ({});
        const thumbnailNotification = vi.fn();
        target.recordedEvent.emitAddUploadedVideoFile = thumbnailNotification;

        await target.addUploadedVideoFile(uploadOption(adopted));

        expect(thumbnailNotification).toHaveBeenCalledWith(501, true);
    });

    it('move-copy-delete-enumerate-links', async () => {
        const root = await temporaryRoot();
        const uploadRoot = join(root, 'upload');
        const storage = join(root, 'storage');
        const dropLogRoot = join(root, 'drop-log');
        const externalRoot = join(root, 'external');
        const externalFile = join(externalRoot, 'outside.ts');
        await Promise.all([mkdir(storage), mkdir(dropLogRoot), mkdir(externalRoot)]);
        await createIncoming(uploadRoot, 'task-7-4');

        const adoption = new AdoptionModel(uploadRoot);
        await adoption.initialize();
        const adopted = await adoption.adopt(join(uploadRoot, 'incoming', 'task-7-4', 'payload'));
        await expect(readFile(join(uploadRoot, 'incoming', 'task-7-4', 'payload'))).rejects.toMatchObject({
            code: 'ENOENT',
        });

        const upload = manageSubject(storage);
        upload.uploadFileSystem = {
            ...placementFileSystem(),
            link: async () => Promise.reject(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
        };
        await upload.addUploadedVideoFile(uploadOption(adopted));
        await expect(readFile(join(storage, 'synthetic.ts'), 'utf8')).resolves.toBe('synthetic-upload');
        await expect(readFile(adopted)).rejects.toMatchObject({ code: 'ENOENT' });

        await writeFile(externalFile, 'outside-bytes');
        const externalLink = join(storage, 'external-link.ts');
        await symlink(externalFile, externalLink);
        const { target } = cleanupSubject([storage], dropLogRoot);
        await target.videoFileCleanup();

        await expect(lstat(join(storage, 'synthetic.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(externalLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(externalFile, 'utf8')).resolves.toBe('outside-bytes');
        expect(target.videoFileCleanupState).toBe('idle');
    });
});

describe('recorded cleanup filesystem integration [Task 6.4]', () => {
    it('[RC-9.1-RC-9.17] isolates two concurrent cleanup effects and notifies only confirmed changes', async () => {
        const root = await temporaryRoot();
        const videoRoot = join(root, 'recorded');
        const dropLogRoot = join(root, 'drop-log');
        const externalRoot = join(root, 'external');
        const externalDirectory = join(externalRoot, 'directory');
        const emptyDirectory = join(videoRoot, 'empty-directory');
        const failedDirectory = join(videoRoot, 'failed-directory');
        const hiddenVideoDirectory = join(videoRoot, '.hidden-directory');
        const hiddenDropLogDirectory = join(dropLogRoot, '.hidden-directory');
        await Promise.all([
            mkdir(emptyDirectory, { recursive: true }),
            mkdir(failedDirectory, { recursive: true }),
            mkdir(hiddenVideoDirectory, { recursive: true }),
            mkdir(hiddenDropLogDirectory, { recursive: true }),
            mkdir(externalDirectory, { recursive: true }),
            mkdir(dropLogRoot, { recursive: true }),
        ]);

        const sharedVideo = join(videoRoot, 'shared.ts');
        const retainedAfterUnlinkFailure = join(videoRoot, 'retained-after-unlink-failure.ts');
        const deletedAfterUnlinkFailure = join(videoRoot, 'deleted-after-unlink-failure.ts');
        const failedDirectoryChild = join(failedDirectory, 'retained.ts');
        const hiddenVideo = join(videoRoot, '.hidden.ts');
        const hiddenVideoChild = join(hiddenVideoDirectory, 'retained.ts');
        const sharedDropLog = join(dropLogRoot, 'shared.log');
        const orphanDropLog = join(dropLogRoot, 'orphan.log');
        const hiddenDropLog = join(dropLogRoot, '.hidden.log');
        const hiddenDropLogChild = join(hiddenDropLogDirectory, 'retained.log');
        const externalFile = join(externalRoot, 'outside.ts');
        const externalDirectoryChild = join(externalDirectory, 'outside.ts');
        const videoFileLink = join(videoRoot, 'file-link.ts');
        const videoDirectoryLink = join(videoRoot, 'directory-link');
        const brokenVideoLink = join(videoRoot, 'broken-link.ts');
        const dropLogFileLink = join(dropLogRoot, 'file-link.log');
        await Promise.all([
            writeFile(sharedVideo, 'shared-video-bytes'),
            writeFile(retainedAfterUnlinkFailure, 'retained-video-bytes'),
            writeFile(deletedAfterUnlinkFailure, 'deleted-video-bytes'),
            writeFile(failedDirectoryChild, 'failed-directory-bytes'),
            writeFile(hiddenVideo, 'hidden-video-bytes'),
            writeFile(hiddenVideoChild, 'hidden-video-child-bytes'),
            writeFile(sharedDropLog, 'shared-drop-log-bytes'),
            writeFile(orphanDropLog, 'orphan-drop-log-bytes'),
            writeFile(hiddenDropLog, 'hidden-drop-log-bytes'),
            writeFile(hiddenDropLogChild, 'hidden-drop-log-child-bytes'),
            writeFile(externalFile, 'external-file-bytes'),
            writeFile(externalDirectoryChild, 'external-directory-bytes'),
        ]);
        await Promise.all([
            symlink(externalFile, videoFileLink),
            symlink(externalDirectory, videoDirectoryLink),
            symlink(join(externalRoot, 'missing-target.ts'), brokenVideoLink),
            symlink(externalFile, dropLogFileLink),
        ]);

        const sharedVideoRow: CleanupVideoRow = {
            filePath: 'shared.ts',
            id: 8_001,
            parentDirectoryName: 'synthetic-storage-0',
            recordedId: 8_101,
        };
        const databaseOnlyVideoRow: CleanupVideoRow = {
            filePath: 'database-only.ts',
            id: 8_002,
            parentDirectoryName: 'synthetic-storage-0',
            recordedId: 8_101,
        };
        const sharedDropLogRow: CleanupDropLogRow = { filePath: 'shared.log', id: 8_201 };
        const relationFailureRow: CleanupDropLogRow = { filePath: 'relation-failure.log', id: 8_202 };
        const rowFailureRow: CleanupDropLogRow = { filePath: 'row-failure.log', id: 8_203 };
        const changedDropLogRow: CleanupDropLogRow = { filePath: 'changed.log', id: 8_204 };
        const { dropLogRows, relatedDropLogIds, target, videoRows } = cleanupSubject(
            [videoRoot],
            dropLogRoot,
            [sharedVideoRow, databaseOnlyVideoRow],
            [sharedDropLogRow, relationFailureRow, rowFailureRow, changedDropLogRow],
        );

        const startGate = cleanupGate();
        const starts: string[] = [];
        target.videoFileDB.findAll.mockImplementation(async () => {
            starts.push('video');
            await startGate.promise;
            return [...videoRows.values()];
        });
        target.dropLogFileDB.findAll.mockImplementation(async () => {
            starts.push('drop-log');
            await startGate.promise;
            return [...dropLogRows.values()];
        });

        const relationFailure = new Error('synthetic relation removal failure');
        const rowFailure = new Error('synthetic row removal failure');
        const unlinkFailure = new Error('synthetic unlink failure');
        const subdirectoryFailure = new Error('synthetic subdirectory listing failure');
        target.recordedDB.removeDropLogFileId.mockImplementation(async (dropLogFileId: number) => {
            if (dropLogFileId === relationFailureRow.id) throw relationFailure;
            return relatedDropLogIds.delete(dropLogFileId);
        });
        target.dropLogFileDB.deleteOnce.mockImplementation(async (dropLogFileId: number) => {
            if (dropLogFileId === rowFailureRow.id) throw rowFailure;
            return dropLogRows.delete(dropLogFileId);
        });

        const actualUnlink = FileUtil.unlink.bind(FileUtil);
        vi.spyOn(FileUtil, 'unlink').mockImplementation(async filePath => {
            if (filePath === retainedAfterUnlinkFailure) throw unlinkFailure;
            await actualUnlink(filePath);
        });
        const actualReaddir = realFs.readdir.bind(realFs);
        nodeFs.readdir.mockImplementation(((directoryPath: import('node:fs').PathLike, callback: any) => {
            if (String(directoryPath) === failedDirectory) {
                callback(subdirectoryFailure, []);
                return;
            }
            actualReaddir(directoryPath, callback);
        }) as typeof realFs.readdir);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const api: any = Object.create(RecordedApiModel.prototype);
        api.ipc = {
            recorded: {
                dropLogFileCleanup: () => target.dropLogFileCleanup(),
                videoFileCleanup: () => target.videoFileCleanup(),
            },
        };
        const operation = api.fileCleanup();
        try {
            await flushCleanupStarts();
            expect(starts).toEqual(['video', 'drop-log']);
        } finally {
            startGate.resolve();
            await operation;
        }

        expect([...videoRows.keys()]).toEqual([sharedVideoRow.id]);
        expect(target.recordedEvent.emitDeleteVideoFile.mock.calls).toEqual([[databaseOnlyVideoRow.id]]);
        expect([...dropLogRows.keys()]).toEqual([sharedDropLogRow.id, relationFailureRow.id, rowFailureRow.id]);
        expect([...relatedDropLogIds]).toEqual([sharedDropLogRow.id, relationFailureRow.id]);
        expect(target.recordedEvent.emitDropLogFileChanged.mock.calls).toEqual([
            [rowFailureRow.id],
            [changedDropLogRow.id],
        ]);
        expect(target.log.system.error).toHaveBeenCalledWith(relationFailure);
        expect(target.log.system.error).toHaveBeenCalledWith(rowFailure);
        expect(target.log.system.error).toHaveBeenCalledWith(unlinkFailure);
        expect(consoleError).toHaveBeenCalledWith(
            `failed to enumerate managed subdirectory: ${failedDirectory}`,
            subdirectoryFailure,
        );

        await expect(readFile(sharedVideo, 'utf8')).resolves.toBe('shared-video-bytes');
        await expect(readFile(sharedDropLog, 'utf8')).resolves.toBe('shared-drop-log-bytes');
        await expect(readFile(retainedAfterUnlinkFailure, 'utf8')).resolves.toBe('retained-video-bytes');
        await expect(stat(deletedAfterUnlinkFailure)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(orphanDropLog)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(emptyDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(failedDirectoryChild, 'utf8')).resolves.toBe('failed-directory-bytes');
        await expect(readFile(hiddenVideo, 'utf8')).resolves.toBe('hidden-video-bytes');
        await expect(readFile(hiddenVideoChild, 'utf8')).resolves.toBe('hidden-video-child-bytes');
        await expect(readFile(hiddenDropLog, 'utf8')).resolves.toBe('hidden-drop-log-bytes');
        await expect(readFile(hiddenDropLogChild, 'utf8')).resolves.toBe('hidden-drop-log-child-bytes');
        await expect(lstat(videoFileLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(videoDirectoryLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(brokenVideoLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(lstat(dropLogFileLink)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(externalFile, 'utf8')).resolves.toBe('external-file-bytes');
        await expect(readFile(externalDirectoryChild, 'utf8')).resolves.toBe('external-directory-bytes');
        expect(target.videoFileCleanupState).toBe('idle');
        expect(target.dropLogFileCleanupState).toBe('idle');
    });

    it.each(['video', 'drop-log'] as const)(
        '[RC-9.9/9.16] isolates a %s root failure from the other cleanup kind',
        async failedKind => {
            const root = await temporaryRoot();
            const existingVideoRoot = join(root, 'recorded');
            const existingDropLogRoot = join(root, 'drop-log');
            const missingVideoRoot = join(root, 'missing-recorded');
            const missingDropLogRoot = join(root, 'missing-drop-log');
            const videoRoot = failedKind === 'video' ? missingVideoRoot : existingVideoRoot;
            const dropLogRoot = failedKind === 'drop-log' ? missingDropLogRoot : existingDropLogRoot;
            if (failedKind !== 'video') await mkdir(existingVideoRoot);
            if (failedKind !== 'drop-log') await mkdir(existingDropLogRoot);
            const survivingOrphan =
                failedKind === 'video'
                    ? join(existingDropLogRoot, 'surviving-cleanup.log')
                    : join(existingVideoRoot, 'surviving-cleanup.ts');
            await writeFile(survivingOrphan, 'surviving-cleanup-bytes');
            const { target } = cleanupSubject([videoRoot], dropLogRoot);

            const [videoResult, dropLogResult] = await Promise.allSettled([
                target.videoFileCleanup(),
                target.dropLogFileCleanup(),
            ]);

            if (failedKind === 'video') {
                expect(videoResult).toMatchObject({ status: 'rejected', reason: { code: 'ENOENT' } });
                expect(dropLogResult).toEqual({ status: 'fulfilled', value: undefined });
            } else {
                expect(videoResult).toEqual({ status: 'fulfilled', value: undefined });
                expect(dropLogResult).toMatchObject({ status: 'rejected', reason: { code: 'ENOENT' } });
            }
            await expect(stat(survivingOrphan)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(target.videoFileCleanupState).toBe('idle');
            expect(target.dropLogFileCleanupState).toBe('idle');
        },
    );
});

const VideoUtil = (
    require(join(snapshot, 'model/api/video/VideoUtil.js')) as {
        default: { prototype: object };
    }
).default;

interface LegacyDeletionVideoRow {
    readonly filePath: string;
    readonly id: number;
    readonly parentDirectoryName: string;
    readonly recordedId: number;
}

/**
 * 整理(`videoFileCleanup()`)が使う旧`delete()`/`deleteVideoFile()`を、実fileの上で動かす。
 * 管理保存先(main・tmp・thumbnail・drop-log)と、その外の`outside`を同じ一時directoryに置く。
 */
const legacyDeletionFixture = async (
    options: { readonly isRecording?: boolean; readonly rows?: readonly LegacyDeletionVideoRow[] } = {},
) => {
    const root = await temporaryRoot();
    const mainRoot = join(root, 'main');
    const tmpRoot = join(root, 'tmp');
    const thumbnailRoot = join(root, 'thumbnail');
    const dropLogRoot = join(root, 'drop-log');
    const outsideRoot = join(root, 'outside');
    await Promise.all([
        mkdir(mainRoot, { recursive: true }),
        mkdir(tmpRoot, { recursive: true }),
        mkdir(thumbnailRoot, { recursive: true }),
        mkdir(dropLogRoot, { recursive: true }),
        mkdir(outsideRoot, { recursive: true }),
    ]);
    const videoRows = new Map((options.rows ?? []).map(row => [row.id, row]));
    const recordedId = 9_100;
    const recordedRow = {
        id: recordedId,
        isProtected: false,
        isRecording: options.isRecording ?? false,
        reserveId: null,
        thumbnails: [] as Array<{ filePath: string; id: number }>,
        dropLogFile: null as { filePath: string; id: number } | null,
    };
    const target: any = Object.create(RecordedManageModel.prototype);
    target.config = {
        dropLog: dropLogRoot,
        recorded: [mainRoot].map(path => ({ name: 'main', path })),
        recordedTmp: tmpRoot,
        thumbnail: thumbnailRoot,
    };
    target.log = { system: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    target.recordedDB = {
        deleteOnce: vi.fn(async () => undefined),
        findId: vi.fn(async (id: number) =>
            id === recordedId ? { ...recordedRow, videoFiles: [...videoRows.values()] } : null,
        ),
    };
    target.videoFileDB = {
        deleteOnce: vi.fn(async (videoFileId: number) => {
            videoRows.delete(videoFileId);
        }),
        deleteRecordedId: vi.fn(async () => {
            videoRows.clear();
        }),
        findAll: vi.fn(async () => [...videoRows.values()]),
        findId: vi.fn(async (videoFileId: number) => videoRows.get(videoFileId) ?? null),
    };
    target.thumbnailDB = { deleteRecordedId: vi.fn(async () => undefined) };
    target.dropLogFileDB = { deleteOnce: vi.fn(async () => undefined) };
    target.recordedEvent = { emitDeleteRecorded: vi.fn(), emitDeleteVideoFile: vi.fn() };
    target.recordingManageModel = { cancel: vi.fn(), hasReserve: vi.fn(() => false) };
    target.videoUtil = Object.create(VideoUtil.prototype, {
        config: { get: () => target.config },
        videoFileDB: { value: target.videoFileDB },
    });
    return {
        mainRoot,
        outsideRoot,
        recordedId,
        recordedRow,
        root,
        target,
        thumbnailRoot,
        tmpRoot,
        dropLogRoot,
        videoRows,
    };
};

const exists = async (filePath: string): Promise<boolean> =>
    lstat(filePath).then(
        () => true,
        () => false,
    );

describe('legacy cleanup-path deletion filesystem integration [RC-8.10]', () => {
    it('leaves files behind root escapes and linked parents while deleting the managed files', async () => {
        const rows: LegacyDeletionVideoRow[] = [
            { filePath: 'managed.ts', id: 9_101, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: '../outside/escape.ts', id: 9_102, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: 'linked/through-link.ts', id: 9_103, parentDirectoryName: 'main', recordedId: 9_100 },
        ];
        const { mainRoot, outsideRoot, recordedId, recordedRow, target, thumbnailRoot } = await legacyDeletionFixture({
            rows,
        });
        recordedRow.thumbnails.push(
            { filePath: 'managed.jpg', id: 9_111 },
            { filePath: '../outside/thumbnail.jpg', id: 9_112 },
        );
        recordedRow.dropLogFile = { filePath: '../outside/drop.log', id: 9_121 };
        const files = {
            drop: join(outsideRoot, 'drop.log'),
            escape: join(outsideRoot, 'escape.ts'),
            managed: join(mainRoot, 'managed.ts'),
            managedThumbnail: join(thumbnailRoot, 'managed.jpg'),
            throughLink: join(outsideRoot, 'through-link.ts'),
            thumbnail: join(outsideRoot, 'thumbnail.jpg'),
        };
        await Promise.all([
            writeFile(files.drop, 'synthetic-bytes'),
            writeFile(files.escape, 'synthetic-bytes'),
            writeFile(files.managed, 'synthetic-bytes'),
            writeFile(files.managedThumbnail, 'synthetic-bytes'),
            writeFile(files.throughLink, 'synthetic-bytes'),
            writeFile(files.thumbnail, 'synthetic-bytes'),
        ]);
        await symlink(outsideRoot, join(mainRoot, 'linked'));

        await expect(target.delete(recordedId)).resolves.toBeUndefined();

        expect(await exists(files.managed)).toBe(false);
        expect(await exists(files.managedThumbnail)).toBe(false);
        expect(await exists(files.escape)).toBe(true);
        expect(await exists(files.throughLink)).toBe(true);
        expect(await exists(files.thumbnail)).toBe(true);
        expect(await exists(files.drop)).toBe(true);
        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(target.recordedEvent.emitDeleteRecorded).toHaveBeenCalledOnce();
    });

    it('deletes a file left in the recorded temporary directory', async () => {
        const rows: LegacyDeletionVideoRow[] = [
            { filePath: 'remaining.ts', id: 9_201, parentDirectoryName: 'tmp', recordedId: 9_100 },
        ];
        const { recordedId, target, tmpRoot } = await legacyDeletionFixture({ rows });
        const remaining = join(tmpRoot, 'remaining.ts');
        await writeFile(remaining, 'synthetic-bytes');

        await expect(target.delete(recordedId)).resolves.toBeUndefined();

        expect(await exists(remaining)).toBe(false);
    });

    it('removes the registration of an individual file whose path escapes the root without touching the target', async () => {
        const rows: LegacyDeletionVideoRow[] = [
            { filePath: '../outside/escape.ts', id: 9_301, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: 'kept.ts', id: 9_302, parentDirectoryName: 'main', recordedId: 9_100 },
        ];
        const { outsideRoot, target, videoRows } = await legacyDeletionFixture({ rows });
        const escape = join(outsideRoot, 'escape.ts');
        await writeFile(escape, 'synthetic-bytes');

        await expect(target.deleteVideoFile(9_301)).resolves.toBeUndefined();

        expect(await exists(escape)).toBe(true);
        expect(videoRows.has(9_301)).toBe(false);
        expect(videoRows.has(9_302)).toBe(true);
    });

    it('deletes an individual file left in the recorded temporary directory', async () => {
        const rows: LegacyDeletionVideoRow[] = [
            { filePath: 'remaining.ts', id: 9_401, parentDirectoryName: 'tmp', recordedId: 9_100 },
            { filePath: 'kept.ts', id: 9_402, parentDirectoryName: 'main', recordedId: 9_100 },
        ];
        const { target, tmpRoot, videoRows } = await legacyDeletionFixture({ rows });
        const remaining = join(tmpRoot, 'remaining.ts');
        await writeFile(remaining, 'synthetic-bytes');

        await expect(target.deleteVideoFile(9_401)).resolves.toBeUndefined();

        expect(await exists(remaining)).toBe(false);
        expect(videoRows.has(9_401)).toBe(false);
    });

    it('keeps the root-external file of a recording whose own file is missing when the cleanup runs', async () => {
        const rows: LegacyDeletionVideoRow[] = [
            { filePath: 'missing.ts', id: 9_501, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: '../outside/escape.ts', id: 9_502, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: 'linked/through-link.ts', id: 9_503, parentDirectoryName: 'main', recordedId: 9_100 },
        ];
        const { mainRoot, outsideRoot, recordedId, target } = await legacyDeletionFixture({
            isRecording: true,
            rows,
        });
        const escape = join(outsideRoot, 'escape.ts');
        const throughLink = join(outsideRoot, 'through-link.ts');
        await Promise.all([writeFile(escape, 'synthetic-bytes'), writeFile(throughLink, 'synthetic-bytes')]);
        await symlink(outsideRoot, join(mainRoot, 'linked'));

        await expect(target.videoFileCleanup()).resolves.toBeUndefined();

        expect(target.recordedDB.deleteOnce).toHaveBeenCalledWith(recordedId);
        expect(await exists(escape)).toBe(true);
        expect(await exists(throughLink)).toBe(true);
    });

    it('deletes the recorded temporary file of a whole deletion through the prepared-path file removal', async () => {
        const { target, tmpRoot } = await legacyDeletionFixture();
        const remaining = join(tmpRoot, 'remaining.ts');
        await writeFile(remaining, 'synthetic-bytes');

        await target.removeRecordedFiles({
            dropLogFile: null,
            thumbnails: [],
            videoFiles: [{ filePath: 'remaining.ts', parentDirectoryName: 'tmp' }],
        });

        expect(await exists(remaining)).toBe(false);
    });

    describe('files registered with a leading separator', () => {
        // 登録pathの先頭の区切りは、保存先の絶対pathに見える literal を避けるため組み立てて作る
        const led = (relative: string, count = 1): string => '/'.repeat(count) + relative;
        const registered = (mainRoot: string) => ({
            file: join(mainRoot, 'anime', 'x.ts'),
            nested: join(mainRoot, 'anime', 'nested', 'y.ts'),
            doubled: join(mainRoot, 'doubled', 'z.ts'),
        });
        const writeRegistered = async (mainRoot: string) => {
            const files = registered(mainRoot);
            await mkdir(join(mainRoot, 'anime', 'nested'), { recursive: true });
            await mkdir(join(mainRoot, 'doubled'), { recursive: true });
            await Promise.all(Object.values(files).map(file => writeFile(file, 'synthetic-bytes')));
            return files;
        };
        const rowsFor = (): LegacyDeletionVideoRow[] => [
            { filePath: led('anime/x.ts'), id: 9_601, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: led('anime/nested/y.ts'), id: 9_602, parentDirectoryName: 'main', recordedId: 9_100 },
            { filePath: led('doubled/z.ts', 2), id: 9_603, parentDirectoryName: 'main', recordedId: 9_100 },
        ];

        it('deletes the files of a whole or storage-capacity deletion', async () => {
            const { mainRoot, recordedId, target } = await legacyDeletionFixture();
            const files = await writeRegistered(mainRoot);

            await target.deleteExactRecordedResources({
                dropLogFile: null,
                id: recordedId,
                thumbnails: [],
                videoFiles: rowsFor(),
            });

            for (const file of Object.values(files)) {
                expect(await exists(file)).toBe(false);
            }
            expect(target.videoFileDB.deleteOnce.mock.calls).toEqual([[9_601], [9_602], [9_603]]);
        });

        it('deletes the file of an individual file deletion', async () => {
            const rows = rowsFor();
            const { mainRoot, target, videoRows } = await legacyDeletionFixture({ rows });
            const files = await writeRegistered(mainRoot);

            const prepared = await target.prepareVideoFileDeletion(9_601);
            expect(prepared.status).toBe('prepared');
            await expect(target.deletePreparedVideoFile(prepared.token)).resolves.toEqual({
                status: 'video-file-deleted',
            });

            expect(await exists(files.file)).toBe(false);
            expect(await exists(files.nested)).toBe(true);
            expect(await exists(files.doubled)).toBe(true);
            expect(videoRows.has(9_601)).toBe(false);
        });

        it('deletes the files of the cleanup-path deletions', async () => {
            const rows = rowsFor();
            const { mainRoot, recordedId, target, videoRows } = await legacyDeletionFixture({ rows });
            const files = await writeRegistered(mainRoot);

            await expect(target.deleteVideoFile(9_601)).resolves.toBeUndefined();
            expect(await exists(files.file)).toBe(false);
            expect(videoRows.has(9_601)).toBe(false);

            await expect(target.delete(recordedId)).resolves.toBeUndefined();
            expect(await exists(files.nested)).toBe(false);
            expect(await exists(files.doubled)).toBe(false);
        });

        it('still refuses a registered path that leaves the root after the leading separator is removed', async () => {
            const { mainRoot, outsideRoot, recordedId, target } = await legacyDeletionFixture();
            const escape = join(outsideRoot, 'escape.ts');
            const throughLink = join(outsideRoot, 'through-link.ts');
            await Promise.all([writeFile(escape, 'synthetic-bytes'), writeFile(throughLink, 'synthetic-bytes')]);
            await symlink(outsideRoot, join(mainRoot, 'linked'));
            const outOfRoot = [
                led('../outside/escape.ts'),
                led('../outside/escape.ts', 2),
                led('anime/../../outside/escape.ts'),
                led('', 1),
                led('', 2),
            ];
            const refused = [...outOfRoot, led('linked/through-link.ts')];

            await target.deleteExactRecordedResources({
                dropLogFile: null,
                id: recordedId,
                thumbnails: [],
                videoFiles: refused.map((filePath, index) => ({
                    filePath,
                    id: 9_700 + index,
                    parentDirectoryName: 'main',
                })),
            });

            expect(await exists(escape)).toBe(true);
            expect(await exists(throughLink)).toBe(true);
            expect(await exists(mainRoot)).toBe(true);
            for (const filePath of outOfRoot) {
                expect(target.log.system.error).toHaveBeenCalledWith(`refused out-of-root deletion: ${filePath}`);
            }
            expect(target.log.system.error).toHaveBeenCalledWith(
                expect.stringMatching(/^refused unsafe deletion: .*main\/linked\/through-link\.ts$/),
            );
        });
    });
});
