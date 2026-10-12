import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRunnerDouble, loadEntity, type RunnerFaults } from './db-unit-fakes';
import { immediateRetry, loadCompiled, repositoryOperator } from './repository-harness';
import { createRecordingLoggerModel } from '../harness/silent-logger-model';

type Restorable = { restore(items: object[]): Promise<void> };

const rule = {
    id: 5,
    updateCnt: 2,
    isTimeSpecification: false,
    searchOption: { keyword: 'restored keyword' },
    reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
};

interface Subject {
    readonly name: string;
    readonly modulePath: string;
    readonly wipes: readonly string[];
    readonly inserted: string;
    readonly items: readonly object[];
    readonly insertedValue: (item: object) => unknown;
}

const plain = (item: object): unknown => item;

const subjects: readonly Subject[] = [
    {
        name: 'RecordedDB',
        modulePath: 'model/db/RecordedDB.js',
        wipes: ['Thumbnail', 'VideoFile', 'Recorded'],
        inserted: 'Recorded',
        items: [{ id: 11 }, { id: 12 }],
        insertedValue: plain,
    },
    {
        name: 'VideoFileDB',
        modulePath: 'model/db/VideoFileDB.js',
        wipes: ['VideoFile'],
        inserted: 'VideoFile',
        items: [{ id: 21 }, { id: 22 }],
        insertedValue: plain,
    },
    {
        name: 'DropLogFileDB',
        modulePath: 'model/db/DropLogFileDB.js',
        wipes: ['Thumbnail', 'VideoFile', 'Recorded', 'DropLogFile'],
        inserted: 'DropLogFile',
        items: [{ id: 31 }, { id: 32 }],
        insertedValue: plain,
    },
    {
        name: 'ThumbnailDB',
        modulePath: 'model/db/ThumbnailDB.js',
        wipes: ['Thumbnail'],
        inserted: 'Thumbnail',
        items: [{ id: 41 }, { id: 42 }],
        insertedValue: plain,
    },
    {
        name: 'RecordedTagDB',
        modulePath: 'model/db/RecordedTagDB.js',
        wipes: ['RecordedTag'],
        inserted: 'RecordedTag',
        items: [{ id: 51 }, { id: 52 }],
        insertedValue: plain,
    },
    {
        name: 'RecordedHistoryDB',
        modulePath: 'model/db/RecordedHistoryDB.js',
        wipes: ['RecordedHistory'],
        inserted: 'RecordedHistory',
        items: [{ id: 61 }, { id: 62 }],
        insertedValue: plain,
    },
    {
        name: 'ReserveDB',
        modulePath: 'model/db/ReserveDB.js',
        wipes: ['Reserve'],
        inserted: 'Reserve',
        items: [{ id: 71 }, { id: 72 }],
        insertedValue: plain,
    },
    {
        name: 'RuleDB',
        modulePath: 'model/db/RuleDB.js',
        wipes: ['Rule'],
        inserted: 'Rule',
        items: [rule],
        insertedValue: () => expect.objectContaining({ id: 5, updateCnt: 2, keyword: 'restored keyword' }),
    },
];

const build = (subject: Subject, faults: RunnerFaults) => {
    const double = createRunnerDouble(faults);
    const connection = { createQueryRunner: vi.fn(() => double.runner) };
    const Repository = loadCompiled<new (...arguments_: any[]) => Restorable>(subject.modulePath);
    const logging = createRecordingLoggerModel();
    const repository = new Repository(logging.loggerModel, repositoryOperator(connection), immediateRetry);
    return { ...double, diagnostic: logging.error, repository };
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe.each(subjects)('$name restore transaction lifecycle (unittest/imp)', subject => {
    const insertedEntity = loadEntity(subject.inserted);

    it('[4.3] wipes the owned tables, inserts every item in order, commits, then releases', async () => {
        const fixture = build(subject, {});

        await expect(fixture.repository.restore([...subject.items])).resolves.toBeUndefined();

        expect(fixture.deletedEntities).toEqual(subject.wipes.map(name => loadEntity(name)));
        expect(fixture.runner.manager.insert.mock.calls).toEqual(
            subject.items.map(item => [insertedEntity, subject.insertedValue(item)]),
        );
        expect(fixture.events).toEqual([
            'start',
            ...subject.wipes.map(() => 'delete-all'),
            ...subject.items.map(() => 'insert'),
            'commit',
            'release',
        ]);
        expect(fixture.runner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('[4.4] rolls an active transaction back, releases, and reports restore error when an insert fails', async () => {
        const fixture = build(subject, { insert: true });
        const diagnostic = fixture.diagnostic;

        await expect(fixture.repository.restore([...subject.items])).rejects.toThrow('restore error');

        expect(fixture.runner.commitTransaction).not.toHaveBeenCalled();
        expect(fixture.runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(fixture.runner.release).toHaveBeenCalledOnce();
        expect(fixture.events.slice(-2)).toEqual(['rollback', 'release']);
        expect(diagnostic.mock.calls).toEqual([[fixture.primary]]);
    });

    it('[4.9] keeps restore error as the public error and records the cleanup failure when rollback fails', async () => {
        const fixture = build(subject, { insert: true, rollback: true });
        const diagnostic = fixture.diagnostic;

        await expect(fixture.repository.restore([...subject.items])).rejects.toThrow('restore error');

        expect(fixture.runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(fixture.runner.release).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.primary], [fixture.rollbackFailure]]);
    });

    it('[4.8] does not roll back a transaction that never started but still releases the runner', async () => {
        const fixture = build(subject, { start: true });
        const diagnostic = fixture.diagnostic;

        await expect(fixture.repository.restore([...subject.items])).rejects.toThrow('restore error');

        expect(fixture.runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(fixture.runner.manager.insert).not.toHaveBeenCalled();
        expect(fixture.runner.release).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[fixture.primary]]);
    });

    it('[4.9] reports restore error and records the diagnostic when only release fails after a commit', async () => {
        const fixture = build(subject, { release: true });
        const diagnostic = fixture.diagnostic;

        await expect(fixture.repository.restore([...subject.items])).rejects.toThrow('restore error');

        expect(fixture.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(fixture.runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(diagnostic.mock.calls).toEqual([[fixture.releaseFailure]]);
    });
});
