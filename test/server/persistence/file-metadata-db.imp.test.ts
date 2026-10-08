import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFluentBuilder, immediateRun, loadEntity } from './db-unit-fakes';
import { loadCompiled, repositoryOperator } from './repository-harness';

type Provider = Record<string, (...arguments_: any[]) => Promise<any>>;

const load = (path: string) => loadCompiled<new (...arguments_: any[]) => Provider>(path);

/**
 * `connection.createQueryBuilder()` serves the write builder, `getRepository(entity).createQueryBuilder()`
 * serves the read builder; both record their calls.
 */
const makeProvider = (
    path: string,
    terminals: { read?: Record<string, () => unknown>; write?: Record<string, () => unknown> } = {},
) => {
    const read = createFluentBuilder(terminals.read as never);
    const write = createFluentBuilder(terminals.write as never);
    const getRepository = vi.fn(() => ({ createQueryBuilder: vi.fn(() => read.builder) }));
    const connection = { getRepository, createQueryBuilder: vi.fn(() => write.builder) };
    const retry = { run: vi.fn(immediateRun) };
    const Repository = load(path);
    return { getRepository, provider: new Repository(repositoryOperator(connection), retry), read, retry, write };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('VideoFileDB writes and reads (unittest/imp)', () => {
    const VideoFile = loadEntity('VideoFile');
    const path = 'model/db/VideoFileDB.js';

    it('[3.1] insertOnce inserts the video file and returns the generated id', async () => {
        const videoFile = { filePath: 'a.ts' };
        const fixture = makeProvider(path, { write: { execute: async () => ({ identifiers: [{ id: 15 }] }) } });

        await expect(fixture.provider.insertOnce(videoFile)).resolves.toBe(15);

        expect(fixture.write.argsOf('into')).toEqual([[VideoFile]]);
        expect(fixture.write.argsOf('values')).toEqual([[videoFile]]);
    });

    it('[3.1] updateFilePath rewrites the directory name and file path of an existing row', async () => {
        const fixture = makeProvider(path, { read: { getOne: async () => ({ id: 3 }) } });

        await expect(
            fixture.provider.updateFilePath({ videoFileId: 3, parentDirectoryName: 'recorded', filePath: 'b/c.ts' }),
        ).resolves.toBeUndefined();

        expect(fixture.read.argsOf('where')).toEqual([[{ id: 3 }]]);
        expect(fixture.write.methods()).toEqual(['update', 'set', 'where', 'execute']);
        expect(fixture.write.argsOf('update')).toEqual([[VideoFile]]);
        expect(fixture.write.argsOf('set')).toEqual([[{ parentDirectoryName: 'recorded', filePath: 'b/c.ts' }]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 3 }]]);
    });

    it('[3.1] updateSize writes the new size of an existing row', async () => {
        const fixture = makeProvider(path, { read: { getOne: async () => ({ id: 4 }) } });

        await expect(fixture.provider.updateSize(4, 123456)).resolves.toBeUndefined();

        expect(fixture.write.argsOf('set')).toEqual([[{ size: 123456 }]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 4 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it('[3.1] deleteOnce deletes one row by id', async () => {
        const fixture = makeProvider(path);

        await expect(fixture.provider.deleteOnce(6)).resolves.toBeUndefined();

        expect(fixture.write.methods()).toEqual(['delete', 'from', 'where', 'execute']);
        expect(fixture.write.argsOf('from')).toEqual([[VideoFile]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 6 }]]);
    });

    it('[3.1] deleteRecordedId deletes the rows of one recorded program', async () => {
        const fixture = makeProvider(path);

        await expect(fixture.provider.deleteRecordedId(8)).resolves.toBeUndefined();

        expect(fixture.write.argsOf('from')).toEqual([[VideoFile]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ recordedId: 8 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it.each([
        { found: { id: 2 }, expected: { id: 2 } },
        { found: undefined, expected: null },
    ])('[3.2] findId maps $found to $expected', async ({ found, expected }) => {
        const fixture = makeProvider(path, { read: { getOne: async () => found } });

        await expect(fixture.provider.findId(2)).resolves.toEqual(expected);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(VideoFile);
        expect(fixture.read.argsOf('where')).toEqual([[{ id: 2 }]]);
    });

    it('[3.2] findAll returns every video file', async () => {
        const rows = [{ id: 1 }, { id: 2 }];
        const fixture = makeProvider(path, { read: { getMany: async () => rows } });

        await expect(fixture.provider.findAll()).resolves.toBe(rows);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(VideoFile);
    });
});

describe('DropLogFileDB writes and reads (unittest/imp)', () => {
    const DropLogFile = loadEntity('DropLogFile');
    const path = 'model/db/DropLogFileDB.js';

    it('[3.1] insertOnce inserts the drop log and returns the generated id', async () => {
        const dropLog = { filePath: 'a.ts.log' };
        const fixture = makeProvider(path, { write: { execute: async () => ({ identifiers: [{ id: 21 }] }) } });

        await expect(fixture.provider.insertOnce(dropLog)).resolves.toBe(21);

        expect(fixture.write.argsOf('into')).toEqual([[DropLogFile]]);
        expect(fixture.write.argsOf('values')).toEqual([[dropLog]]);
    });

    it('[3.1] updateCnt writes the three counters of the row', async () => {
        const fixture = makeProvider(path);

        await expect(
            fixture.provider.updateCnt({ id: 5, errorCnt: 1, dropCnt: 2, scramblingCnt: 3 }),
        ).resolves.toBeUndefined();

        expect(fixture.write.argsOf('update')).toEqual([[DropLogFile]]);
        expect(fixture.write.argsOf('set')).toEqual([[{ errorCnt: 1, dropCnt: 2, scramblingCnt: 3 }]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 5 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it.each([
        { affected: 1, expected: true },
        { affected: 0, expected: false },
        { affected: undefined, expected: false },
    ])('[3.1] deleteOnce reports $expected when affected is $affected', async ({ affected, expected }) => {
        const fixture = makeProvider(path, { write: { execute: async () => ({ affected }) } });

        await expect(fixture.provider.deleteOnce(9)).resolves.toBe(expected);

        expect(fixture.write.argsOf('from')).toEqual([[DropLogFile]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 9 }]]);
    });

    it.each([
        { found: { id: 2 }, expected: { id: 2 } },
        { found: undefined, expected: null },
    ])('[3.2] findId maps $found to $expected', async ({ found, expected }) => {
        const fixture = makeProvider(path, { read: { getOne: async () => found } });

        await expect(fixture.provider.findId(2)).resolves.toEqual(expected);

        expect(fixture.read.argsOf('where')).toEqual([[{ id: 2 }]]);
    });

    it('[3.2] findAll returns every drop log', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider(path, { read: { getMany: async () => rows } });

        await expect(fixture.provider.findAll()).resolves.toBe(rows);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(DropLogFile);
    });
});

describe('ThumbnailDB writes and reads (unittest/imp)', () => {
    const Thumbnail = loadEntity('Thumbnail');
    const path = 'model/db/ThumbnailDB.js';

    it('[3.1] insertOnce inserts the thumbnail and returns the generated id', async () => {
        const thumbnail = { filePath: 't.jpg' };
        const fixture = makeProvider(path, { write: { execute: async () => ({ identifiers: [{ id: 31 }] }) } });

        await expect(fixture.provider.insertOnce(thumbnail)).resolves.toBe(31);

        expect(fixture.write.argsOf('into')).toEqual([[Thumbnail]]);
        expect(fixture.write.argsOf('values')).toEqual([[thumbnail]]);
    });

    it('[3.1] deleteOnce deletes one thumbnail by id', async () => {
        const fixture = makeProvider(path);

        await expect(fixture.provider.deleteOnce(7)).resolves.toBeUndefined();

        expect(fixture.write.argsOf('from')).toEqual([[Thumbnail]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ id: 7 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it('[3.1] deleteRecordedId deletes the thumbnails of one recorded program', async () => {
        const fixture = makeProvider(path);

        await expect(fixture.provider.deleteRecordedId(8)).resolves.toBeUndefined();

        expect(fixture.write.argsOf('from')).toEqual([[Thumbnail]]);
        expect(fixture.write.argsOf('where')).toEqual([[{ recordedId: 8 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it.each([
        { found: { id: 2 }, expected: { id: 2 } },
        { found: undefined, expected: null },
    ])('[3.2] findId maps $found to $expected', async ({ found, expected }) => {
        const fixture = makeProvider(path, { read: { getOne: async () => found } });

        await expect(fixture.provider.findId(2)).resolves.toEqual(expected);

        expect(fixture.read.argsOf('where')).toEqual([[{ id: 2 }]]);
    });

    it('[3.2] findAll returns every thumbnail', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider(path, { read: { getMany: async () => rows } });

        await expect(fixture.provider.findAll()).resolves.toBe(rows);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Thumbnail);
    });
});

describe('RecordedHistoryDB writes and reads (unittest/imp)', () => {
    const RecordedHistory = loadEntity('RecordedHistory');
    const path = 'model/db/RecordedHistoryDB.js';

    it('[3.1] insertOnce inserts the history row and returns the generated id', async () => {
        const history = { name: 'program' };
        const fixture = makeProvider(path, { write: { execute: async () => ({ identifiers: [{ id: 51 }] }) } });

        await expect(fixture.provider.insertOnce(history)).resolves.toBe(51);

        expect(fixture.write.argsOf('into')).toEqual([[RecordedHistory]]);
        expect(fixture.write.argsOf('values')).toEqual([[history]]);
    });

    it('[3.1] delete removes the history rows that ended before the given time', async () => {
        const fixture = makeProvider(path);

        await expect(fixture.provider.delete(9000)).resolves.toBeUndefined();

        expect(fixture.write.argsOf('from')).toEqual([[RecordedHistory]]);
        expect(fixture.write.argsOf('where')).toEqual([['endAt < :time', { time: 9000 }]]);
        expect(fixture.write.methods().at(-1)).toBe('execute');
    });

    it('[3.2] findAll returns every history row', async () => {
        const rows = [{ id: 1 }];
        const fixture = makeProvider(path, { read: { getMany: async () => rows } });

        await expect(fixture.provider.findAll()).resolves.toBe(rows);

        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(RecordedHistory);
    });
});
