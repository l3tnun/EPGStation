import { describe, expect, it, vi } from 'vitest';
import { deferred, loadTool, makeDependencies, versionlessBackup, withProcess } from './_harness';

describe('management backup characterization', () => {
    it('[backup read and write] awaits eight metadata reads and writes compact versionless JSON directly', async () => {
        const harness = makeDependencies();
        const writeFileSync = vi.fn();
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        await tool.backup();
        expect(harness.ledger.filter(value => value.startsWith('read:'))).toEqual([
            'read:rule',
            'read:reserve',
            'read:drop-log',
            'read:recorded',
            'read:thumbnail',
            'read:video-file',
            'read:recorded-history',
            'read:recorded-tag',
        ]);
        expect(writeFileSync).toHaveBeenCalledWith('synthetic-output', JSON.stringify(versionlessBackup()), {
            encoding: 'utf-8',
        });
        for (const value of Object.values(JSON.parse(writeFileSync.mock.calls[0][1]))) {
            expect(value).toHaveLength(1);
        }
    });

    it('[MT-2.1] awaits each repository before logging and starting the next fixed stage', async () => {
        const names = [
            'rule',
            'reserve',
            'drop-log',
            'recorded',
            'thumbnail',
            'video-file',
            'recorded-history',
            'recorded-tag',
        ];
        const gates = names.map(() => deferred<any>());
        const values = versionlessBackup();
        const results = [
            [values.ruleItems, 1],
            [values.reserveItems, 1],
            values.dropLogFileItems,
            [values.recordedItems, 1],
            values.thumbnailItems,
            values.videoFileItems,
            values.recordedHistoryItems,
            [values.recordedTagItems, 1],
        ];
        const repositories = [
            'IRuleDB',
            'IReserveDB',
            'IDropLogFileDB',
            'IRecordedDB',
            'IThumbnailDB',
            'IVideoFileDB',
            'IRecordedHistoryDB',
            'IRecordedTagDB',
        ];
        const harness = makeDependencies(
            Object.fromEntries(
                repositories.map((repository, index) => [repository, { findAll: vi.fn(() => gates[index].promise) }]),
            ),
        );
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync: vi.fn() });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        const pending = tool.backup();
        for (let index = 0; index < repositories.length; index++) {
            expect(harness.dependencies[repositories[index]].findAll).toHaveBeenCalledOnce();
            if (index + 1 < repositories.length) {
                expect(harness.dependencies[repositories[index + 1]].findAll).not.toHaveBeenCalled();
            }
            gates[index].resolve(results[index]);
            await Promise.resolve();
        }
        await pending;
        expect(harness.ledger.filter(value => value.startsWith('log:'))).toEqual([
            'log:--- start backup ---',
            'log:rule',
            'log:reserve',
            'log:drop log file',
            'log:recorded',
            'log:thumbnail file',
            'log:video file',
            'log:recorded history',
            'log:recorded tag',
            'log:--- writing ---',
        ]);
    });

    it('[MT-2.2] exposes a direct non-atomic write failure without rename, fsync, or old-byte restoration', async () => {
        const harness = makeDependencies();
        let visibleBytes = 'synthetic-old-bytes';
        const failure = new Error('synthetic direct write failure');
        const writeFileSync = vi.fn((_path: string, bytes: string) => {
            visibleBytes = bytes.slice(0, 17);
            throw failure;
        });
        const filesystem = { readFileSync: vi.fn(), writeFileSync };
        const Tool = await loadTool('DBTools.js', harness.container, filesystem);
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        await expect(tool.backup()).rejects.toBe(failure);
        expect(writeFileSync).toHaveBeenCalledOnce();
        expect(visibleBytes).not.toBe('synthetic-old-bytes');
        expect(Object.keys(filesystem)).toEqual(['readFileSync', 'writeFileSync']);
    });

    it.each([
        ['IRuleDB', 'rule'],
        ['IReserveDB', 'reserve'],
        ['IDropLogFileDB', 'drop-log'],
        ['IRecordedDB', 'recorded'],
        ['IThumbnailDB', 'thumbnail'],
        ['IVideoFileDB', 'video-file'],
        ['IRecordedHistoryDB', 'recorded-history'],
        ['IRecordedTagDB', 'recorded-tag'],
    ])('[backup read failure] preserves preceding reads and stops at a failed %s read', async (repository, stage) => {
        const stages = [
            ['IRuleDB', 'rule'],
            ['IReserveDB', 'reserve'],
            ['IDropLogFileDB', 'drop-log'],
            ['IRecordedDB', 'recorded'],
            ['IThumbnailDB', 'thumbnail'],
            ['IVideoFileDB', 'video-file'],
            ['IRecordedHistoryDB', 'recorded-history'],
            ['IRecordedTagDB', 'recorded-tag'],
        ] as const;
        const failure = new Error(`synthetic ${stage} repository failure`);
        const harness = makeDependencies();
        harness.dependencies[repository].findAll.mockImplementationOnce(async () => {
            harness.ledger.push(`read:${stage}:attempt`);
            throw failure;
        });
        const writeFileSync = vi.fn();
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        await expect(tool.backup()).rejects.toBe(failure);
        const failedIndex = stages.findIndex(([name]) => name === repository);
        for (const [index, [name]] of stages.entries()) {
            expect(harness.dependencies[name].findAll).toHaveBeenCalledTimes(index <= failedIndex ? 1 : 0);
        }
        expect(harness.ledger.filter(value => value.startsWith('read:'))).toEqual([
            ...stages.slice(0, failedIndex).map(([, name]) => `read:${name}`),
            `read:${stage}:attempt`,
        ]);
        expect(writeFileSync).not.toHaveBeenCalled();
    });

    it.each(['MT-2.3', 'MT-2.4', 'MT-2.5'])(
        '[%s] requests unjoined metadata and performs no media/configuration file operation',
        async () => {
            const harness = makeDependencies();
            const readFileSync = vi.fn();
            const writeFileSync = vi.fn();
            const filesystem = { readFileSync, writeFileSync };
            const Tool = await loadTool('DBTools.js', harness.container, filesystem);
            const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
            await tool.backup();
            expect(harness.dependencies.IRecordedDB.findAll).toHaveBeenCalledWith(
                { isHalfWidth: false },
                { isNeedVideoFiles: false, isNeedThumbnails: false, isNeedsDropLog: false, isNeedTags: false },
            );
            const document = JSON.parse(writeFileSync.mock.calls[0][1]);
            expect(Object.keys(document)).toEqual(Object.keys(versionlessBackup()));
            expect(readFileSync).not.toHaveBeenCalled();
            expect(Object.keys(filesystem)).toEqual(['readFileSync', 'writeFileSync']);
            expect(document).not.toHaveProperty('version');
            expect(document).not.toHaveProperty('recordedTagRelations');
            expect(document.recordedItems[0]).not.toHaveProperty('videoFiles');
            expect(document.recordedItems[0]).not.toHaveProperty('thumbnails');
            expect(document.recordedItems[0]).not.toHaveProperty('dropLogFile');
            expect(document.recordedItems[0]).not.toHaveProperty('tags');
        },
    );
});
