import { describe, expect, it, vi } from 'vitest';

import { immediateRetry, loadCompiledDefault, repositoryOperator, silentLogger } from './repository-harness';
import { createRecordingLoggerModel, silentLoggerModel } from '../harness/silent-logger-model';

const queryBuilder = (result: unknown) => {
    const builder = {
        andWhere: vi.fn(),
        createQueryBuilder: vi.fn(),
        delete: vi.fn(),
        execute: vi.fn(async () => result),
        from: vi.fn(),
        getMany: vi.fn(async () => result),
        getManyAndCount: vi.fn(async () => result),
        getOne: vi.fn(async () => result),
        insert: vi.fn(),
        into: vi.fn(),
        leftJoinAndSelect: vi.fn(),
        orderBy: vi.fn(),
        set: vi.fn(),
        skip: vi.fn(),
        take: vi.fn(),
        update: vi.fn(),
        values: vi.fn(),
        where: vi.fn(),
    };
    for (const method of Object.keys(builder)) {
        if (!['execute', 'getMany', 'getManyAndCount', 'getOne'].includes(method)) {
            (builder[method as keyof typeof builder] as ReturnType<typeof vi.fn>).mockReturnValue(builder);
        }
    }
    return builder;
};

const transactionRunner = () => {
    let active = false;
    // TypeORM 1.x rejects manager.delete(Entity, {}) with an empty criteria object, so full-table
    // wipes (ChannelDB.insert, RuleDB/ReserveDB/RecordedHistoryDB.restore) go through
    // manager.createQueryBuilder().delete().from(Entity).execute() instead. The mock manager needs
    // that chain so those repositories do not hit `queryRunner.manager.createQueryBuilder is not
    // a function`.
    const deleteBuilder = queryBuilder(undefined);
    const manager = {
        createQueryBuilder: vi.fn(() => deleteBuilder),
        delete: vi.fn(async () => undefined),
        insert: vi.fn(async () => ({ identifiers: [{ id: 73 }] })),
        update: vi.fn(async () => undefined),
    };
    const runner = {
        commitTransaction: vi.fn(async () => {
            active = false;
        }),
        get isTransactionActive() {
            return active;
        },
        manager,
        release: vi.fn(async () => undefined),
        rollbackTransaction: vi.fn(async () => {
            active = false;
        }),
        startTransaction: vi.fn(async () => {
            active = true;
        }),
    };
    return { deleteBuilder, manager, runner };
};

describe('typed persistence repository contracts', () => {
    it.each([
        ['ChannelDB', 'model/db/ChannelDB.js', true],
        ['ProgramDB', 'model/db/ProgramDB.js', true],
        ['ReserveDB', 'model/db/ReserveDB.js', false],
        ['RuleDB', 'model/db/RuleDB.js', false],
        ['RecordedDB', 'model/db/RecordedDB.js', false],
        ['VideoFileDB', 'model/db/VideoFileDB.js', false],
        ['DropLogFileDB', 'model/db/DropLogFileDB.js', false],
        ['ThumbnailDB', 'model/db/ThumbnailDB.js', false],
        ['RecordedTagDB', 'model/db/RecordedTagDB.js', false],
    ])('[PERSIST-2-NULL-%s] maps an absent single-row lookup to null', async (_name, modulePath, needsContext) => {
        const builder = queryBuilder(modulePath.includes('RecordedDB') ? [] : undefined);
        const repository = { createQueryBuilder: vi.fn(() => builder), findOne: vi.fn(async () => undefined) };
        const connection = { getRepository: vi.fn(() => repository) };
        const Repository = loadCompiledDefault<{ findId(id: number): Promise<unknown> }>(modulePath);
        const instance = needsContext
            ? new Repository(
                  { getLogger: silentLogger },
                  { getConfig: () => ({}) },
                  repositoryOperator(connection),
                  immediateRetry,
              )
            : new Repository(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(instance.findId(404)).resolves.toBeNull();
    });

    it('[PERSIST-7.1-R2.1-CHANNEL-REPLACEMENT] persists a full channel replacement through its public port', async () => {
        const { deleteBuilder, manager, runner } = transactionRunner();
        const ChannelDB = loadCompiledDefault<{ insert(channels: object[]): Promise<void> }>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            { getLogger: silentLogger },
            { getConfig: () => ({}) },
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );

        await expect(
            repository.insert([
                {
                    channel: { channel: 'synthetic-11', type: 'GR' },
                    id: 11,
                    name: 'synthetic channel',
                    networkId: 1,
                    serviceId: 11,
                },
            ]),
        ).resolves.toBeUndefined();

        // TypeORM 1.x rejects manager.delete(Entity, {}) with empty criteria, so a full replace now
        // wipes the table via manager.createQueryBuilder().delete().from(Entity).execute().
        expect(manager.createQueryBuilder).toHaveBeenCalledOnce();
        expect(deleteBuilder.delete).toHaveBeenCalledOnce();
        expect(deleteBuilder.execute).toHaveBeenCalledOnce();
        expect(manager.insert).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ channel: 'synthetic-11', id: 11, serviceId: 11 }),
        );
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R2.1-PROGRAM-REPLACEMENT] persists a full program replacement through its public port', async () => {
        const { deleteBuilder, manager, runner } = transactionRunner();
        const ProgramDB = loadCompiledDefault<{
            insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: silentLogger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );

        await expect(
            repository.insert({ 1: { 11: { channel: 'synthetic-11', id: 11, type: 'GR' } } }, [
                {
                    duration: 1_000,
                    eventId: 2,
                    id: 2,
                    isFree: true,
                    name: 'synthetic-program',
                    networkId: 1,
                    serviceId: 11,
                    startAt: 2_000,
                },
            ]),
        ).resolves.toBeUndefined();

        // 削除対象の channel が指定されない全件差し替えは、TypeORM 1.x が空 criteria の
        // delete を拒否するため query builder を通る。
        expect(deleteBuilder.execute).toHaveBeenCalledOnce();
        expect(manager.delete).not.toHaveBeenCalled();
        expect(manager.insert).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ channelId: 11, eventId: 2, name: 'synthetic-program' }),
        );
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R2.2-RESERVE-CRUD] persists reserve create, update, and delete operations through its public port', async () => {
        const { manager, runner } = transactionRunner();
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(
            silentLoggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );
        const inserted: { id?: number } = {};

        await expect(
            repository.updateMany({ delete: [{ id: 1 }], insert: [inserted], update: [{ id: 3 }] }),
        ).resolves.toBeUndefined();

        expect(manager.delete).toHaveBeenCalledWith(expect.anything(), [1]);
        expect(manager.insert).toHaveBeenCalledWith(expect.anything(), inserted);
        expect(manager.update).toHaveBeenCalledWith(expect.anything(), 3, { id: 3 });
        expect(inserted).toEqual({ id: 73 });
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R2.2-RULE-CRUD] persists rule create, update, delete, and read operations through its public port', async () => {
        const builder = queryBuilder({ identifiers: [{ id: 73 }] });
        const stored = {
            BS: false,
            CS: false,
            GR: true,
            SKY: false,
            allowEndLack: false,
            avoidDuplicate: false,
            channelIds: null,
            description: false,
            directory: null,
            directory1: null,
            directory2: null,
            directory3: null,
            durationMax: null,
            durationMin: null,
            enable: true,
            extended: false,
            genres: null,
            id: 55,
            ignoreDescription: false,
            ignoreExtended: false,
            ignoreKeyCS: false,
            ignoreKeyRegExp: false,
            ignoreKeyword: null,
            ignoreName: false,
            isDeleteOriginalAfterEncode: false,
            isFree: false,
            isTimeSpecification: false,
            keyCS: false,
            keyRegExp: false,
            keyword: null,
            mode1: null,
            mode2: null,
            mode3: null,
            name: true,
            parentDirectoryName: null,
            parentDirectoryName1: null,
            parentDirectoryName2: null,
            parentDirectoryName3: null,
            periodToAvoidDuplicate: null,
            recordedFormat: null,
            searchPeriods: null,
            tags: null,
            times: null,
            updateCnt: 3,
        };
        const rule = {
            id: 55,
            isTimeSpecification: false,
            reserveOption: { allowEndLack: false, avoidDuplicate: false, enable: true },
            searchOption: { GR: true, name: true },
            // parentDirectoryName を省略したまま directory/recordedFormat のみ与え、保存オプションの
            // 各フィールドが独立して null 判定されることを確かめる。
            saveOption: { directory: 'synthetic/dir', recordedFormat: 'synthetic-fmt' },
            // mode2/mode3 の転送先 (encodeParentDirectoryName2/3) を与え、既定値の null 化ではなく
            // 実際の値がそのまま転写されることを確かめる。
            encodeOption: {
                mode2: 'mobile',
                encodeParentDirectoryName2: 'synthetic-parent-2',
                directory2: 'synthetic/mobile',
                mode3: 'review',
                encodeParentDirectoryName3: 'synthetic-parent-3',
                directory3: 'synthetic/review',
                isDeleteOriginalAfterEncode: true,
            },
        };
        const connection = {
            createQueryBuilder: vi.fn(() => builder),
            getRepository: vi.fn(() => ({ findOne: vi.fn(async () => stored) })),
        };
        const RuleDB = loadCompiledDefault<{
            deleteOnce(id: number): Promise<void>;
            findId(id: number, isNeedCnt?: boolean): Promise<unknown>;
            insertOnce(value: object): Promise<number>;
            updateOnce(value: object): Promise<void>;
        }>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.insertOnce(rule)).resolves.toBe(73);
        await expect(repository.updateOnce(rule)).resolves.toBeUndefined();
        await expect(repository.deleteOnce(55)).resolves.toBeUndefined();
        await expect(repository.findId(55, true)).resolves.toMatchObject({ id: 55, updateCnt: 3 });

        expect(builder.insert).toHaveBeenCalledOnce();
        expect(builder.update).toHaveBeenCalledOnce();
        expect(builder.delete).toHaveBeenCalledOnce();
        expect(builder.execute).toHaveBeenCalledTimes(3);
        expect(builder.where).toHaveBeenCalledWith('id = :id', { id: 55 });
        const insertedValue = builder.values.mock.calls[0][0];
        expect(insertedValue).toMatchObject({
            parentDirectoryName: null,
            directory: 'synthetic/dir',
            recordedFormat: 'synthetic-fmt',
            mode2: 'mobile',
            parentDirectoryName2: 'synthetic-parent-2',
            directory2: 'synthetic/mobile',
            mode3: 'review',
            parentDirectoryName3: 'synthetic-parent-3',
            directory3: 'synthetic/review',
            isDeleteOriginalAfterEncode: true,
        });
        const updatedValue = builder.set.mock.calls[0][0];
        expect(updatedValue).toMatchObject({
            parentDirectoryName: null,
            directory: 'synthetic/dir',
            recordedFormat: 'synthetic-fmt',
            mode2: 'mobile',
            parentDirectoryName2: 'synthetic-parent-2',
            directory2: 'synthetic/mobile',
            mode3: 'review',
            parentDirectoryName3: 'synthetic-parent-3',
            directory3: 'synthetic/review',
            isDeleteOriginalAfterEncode: true,
        });
    });

    it('[PERSIST-7.1-R2.2-RULE-READ-ENCODE23] surfaces mode2/mode3 encode destinations from a stored rule row', async () => {
        const stored = {
            BS: false,
            CS: false,
            GR: true,
            SKY: false,
            allowEndLack: false,
            avoidDuplicate: false,
            channelIds: null,
            description: false,
            directory: null,
            directory1: null,
            directory2: 'synthetic/mobile',
            directory3: 'synthetic/review',
            durationMax: null,
            durationMin: null,
            enable: true,
            extended: false,
            genres: null,
            id: 56,
            ignoreDescription: false,
            ignoreExtended: false,
            ignoreKeyCS: false,
            ignoreKeyRegExp: false,
            ignoreKeyword: null,
            ignoreName: false,
            isDeleteOriginalAfterEncode: true,
            isFree: false,
            isTimeSpecification: false,
            keyCS: false,
            keyRegExp: false,
            keyword: null,
            mode1: null,
            mode2: 'mobile',
            mode3: 'review',
            name: true,
            parentDirectoryName: null,
            parentDirectoryName1: null,
            parentDirectoryName2: 'synthetic-encoded-parent-2',
            parentDirectoryName3: 'synthetic-encoded-parent-3',
            periodToAvoidDuplicate: null,
            recordedFormat: null,
            searchPeriods: null,
            tags: null,
            times: null,
            updateCnt: 4,
        };
        const connection = { getRepository: vi.fn(() => ({ findOne: vi.fn(async () => stored) })) };
        const RuleDB = loadCompiledDefault<{ findId(id: number, isNeedCnt?: boolean): Promise<unknown> }>(
            'model/db/RuleDB.js',
        );
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(56, true)).resolves.toMatchObject({
            id: 56,
            encodeOption: {
                mode2: 'mobile',
                encodeParentDirectoryName2: 'synthetic-encoded-parent-2',
                directory2: 'synthetic/mobile',
                mode3: 'review',
                encodeParentDirectoryName3: 'synthetic-encoded-parent-3',
                directory3: 'synthetic/review',
                isDeleteOriginalAfterEncode: true,
            },
        });
    });

    it('[PERSIST-7.1-R2.2-RULE-INSERT-UNDEFINED-GUARD] characterizes the rule-undefined guard inside convertRuleToDBRule', async () => {
        const builder = queryBuilder({ identifiers: [{ id: 1 }] });
        const connection = { createQueryBuilder: vi.fn(() => builder) };
        const RuleDB = loadCompiledDefault<{ insertOnce(value: unknown): Promise<number> }>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        // convertRuleToDBRule の `typeof rule === 'undefined' ? 0 : (<RuleWithCnt>rule).updateCnt` は
        // rule 自体が undefined のときの防御分岐だが、同じオブジェクトリテラルの次のプロパティ
        // `isTimeSpecification: rule.isTimeSpecification` が無条件に rule を参照するため、
        // updateCnt に 0 が入った直後に TypeError で失敗する。insertOnce/updateOnce/restore はいずれも
        // 型定義上 rule を必須にしており、実際の呼び出し経路からこの防御分岐だけを単独で
        // 通過することはない。
        await expect(repository.insertOnce(undefined as unknown as Record<string, unknown>)).rejects.toThrow(
            TypeError,
        );
        expect(builder.values).not.toHaveBeenCalled();
    });

    it('[PERSIST-7.1-R2.3-HISTORY-READ] returns recorded history rows through its public repository port', async () => {
        const rows = [{ id: 91 }];
        const builder = queryBuilder(rows);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder })) };
        const RecordedHistoryDB = loadCompiledDefault<{ findAll(): Promise<unknown[]> }>(
            'model/db/RecordedHistoryDB.js',
        );
        const repository = new RecordedHistoryDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findAll()).resolves.toEqual(rows);
        expect(builder.getMany).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R2.3-RECORDED-CRUD] persists recorded create, update, and delete operations through its public port', async () => {
        const builder = queryBuilder({ identifiers: [{ id: 73 }] });
        const RecordedDB = loadCompiledDefault<{
            deleteOnce(id: number): Promise<void>;
            insertOnce(value: object): Promise<number>;
            updateOnce(value: { id: number }): Promise<void>;
        }>('model/db/RecordedDB.js');
        const repository = new RecordedDB(
            silentLoggerModel,
            repositoryOperator({ createQueryBuilder: vi.fn(() => builder) }),
            immediateRetry,
        );
        const recorded = { id: 44, name: 'synthetic-recorded' };

        await expect(repository.insertOnce(recorded)).resolves.toBe(73);
        await expect(repository.updateOnce(recorded)).resolves.toBeUndefined();
        await expect(repository.deleteOnce(44)).resolves.toBeUndefined();

        expect(builder.insert).toHaveBeenCalledOnce();
        expect(builder.update).toHaveBeenCalledOnce();
        expect(builder.delete).toHaveBeenCalledOnce();
        expect(builder.execute).toHaveBeenCalledTimes(3);
        expect(builder.values).toHaveBeenCalledWith(recorded);
        expect(builder.where).toHaveBeenCalledWith({ id: 44 });
    });

    it('[PERSIST-7.1-R2.3-HISTORY-SAVE] persists recorded history create and expiry delete through its public port', async () => {
        const builder = queryBuilder({ identifiers: [{ id: 73 }] });
        const RecordedHistoryDB = loadCompiledDefault<{
            delete(time: number): Promise<void>;
            insertOnce(value: object): Promise<number>;
        }>('model/db/RecordedHistoryDB.js');
        const repository = new RecordedHistoryDB(
            silentLoggerModel,
            repositoryOperator({ createQueryBuilder: vi.fn(() => builder) }),
            immediateRetry,
        );
        const history = { id: 19, name: 'synthetic-history' };

        await expect(repository.insertOnce(history)).resolves.toBe(73);
        await expect(repository.delete(1_234)).resolves.toBeUndefined();

        expect(builder.insert).toHaveBeenCalledOnce();
        expect(builder.delete).toHaveBeenCalledOnce();
        expect(builder.execute).toHaveBeenCalledTimes(2);
        expect(builder.values).toHaveBeenCalledWith(history);
        expect(builder.where).toHaveBeenCalledWith('endAt < :time', { time: 1_234 });
    });

    it.each([
        ['VideoFileDB', 'model/db/VideoFileDB.js'],
        ['DropLogFileDB', 'model/db/DropLogFileDB.js'],
        ['ThumbnailDB', 'model/db/ThumbnailDB.js'],
        ['RecordedTagDB', 'model/db/RecordedTagDB.js'],
    ])(
        '[PERSIST-2-INSERT-%s] returns the generated identifier without domain reinterpretation',
        async (_name, path) => {
            const builder = queryBuilder({ identifiers: [{ id: 73 }] });
            const connection = { createQueryBuilder: vi.fn(() => builder) };
            const Repository = loadCompiledDefault<{ insertOnce(value: object): Promise<number> }>(path);
            const instance = new Repository(silentLoggerModel, repositoryOperator(connection), immediateRetry);

            await expect(instance.insertOnce({ marker: 'synthetic' })).resolves.toBe(73);
            expect(builder.values).toHaveBeenCalledWith({ marker: 'synthetic' });
        },
    );

    it('[PERSIST-2-RECORDED-RELATIONS] selects only requested relations and preserves empty arrays', async () => {
        const builder = queryBuilder([]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder })) };
        const RecordedDB = loadCompiledDefault<{
            findIds(ids: number[], columns: object): Promise<unknown[]>;
        }>('model/db/RecordedDB.js');
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(
            repository.findIds([1, 2], {
                isNeedVideoFiles: true,
                isNeedThumbnails: false,
                isNeedsDropLog: true,
                isNeedTags: false,
            }),
        ).resolves.toEqual([]);
        expect(builder.leftJoinAndSelect.mock.calls).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.dropLogFile', 'dropLogFile'],
        ]);
        await expect(repository.findIds([], {})).resolves.toEqual([]);
    });

    it('[PERSIST-2-TAG-PAGE] applies filters, skip/take and returns items with the matching count', async () => {
        const rows = [{ id: 2, name: 'synthetic' }];
        const builder = queryBuilder([rows, 1]);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builder })) };
        const RecordedTagDB = loadCompiledDefault<{
            findAll(option: object): Promise<[object[], number]>;
        }>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findAll({ name: 'synthetic', offset: 2, limit: 1 })).resolves.toEqual([rows, 1]);
        expect(builder.skip).toHaveBeenCalledWith(2);
        expect(builder.take).toHaveBeenCalledWith(1);
        expect(builder.andWhere).toHaveBeenCalledTimes(1);
    });

    it('[PERSIST-7.1-R2.5-TAG-CRUD] persists tag create, update, and delete operations through its public port', async () => {
        const builder = queryBuilder({ identifiers: [{ id: 73 }] });
        builder.getOne.mockResolvedValue({ color: 'blue', id: 15, name: 'synthetic-tag' });
        const RecordedTagDB = loadCompiledDefault<{
            deleteOnce(id: number): Promise<void>;
            insertOnce(value: object): Promise<number>;
            updateOnce(id: number, name: string, color: string): Promise<void>;
        }>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(
            silentLoggerModel,
            repositoryOperator({
                createQueryBuilder: vi.fn(() => builder),
                getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })),
            }),
            immediateRetry,
        );

        await expect(repository.insertOnce({ color: 'blue', name: 'synthetic-tag' })).resolves.toBe(73);
        await expect(repository.updateOnce(15, 'renamed-tag', 'red')).resolves.toBeUndefined();
        await expect(repository.deleteOnce(15)).resolves.toBeUndefined();

        expect(builder.insert).toHaveBeenCalledOnce();
        expect(builder.update).toHaveBeenCalledOnce();
        expect(builder.delete).toHaveBeenCalledOnce();
        expect(builder.execute).toHaveBeenCalledTimes(3);
        expect(builder.set).toHaveBeenCalledWith({ color: 'red', halfWidthName: 'renamed-tag', name: 'renamed-tag' });
    });

    it('[PERSIST-7.1-R2.5-TAG-ASSOCIATION] persists only the selected recorded-tag association through its public port', async () => {
        const selectedTag = { id: 20, name: 'selected' };
        const retainedTag = { id: 10, name: 'retained' };
        const savedTagSnapshots: number[][] = [];
        const recorded = { save: vi.fn(), tags: [retainedTag] };
        recorded.save.mockImplementation(async () => {
            savedTagSnapshots.push(recorded.tags.map(tag => tag.id));
        });
        const recordedBuilder = queryBuilder(recorded);
        const tagBuilder = queryBuilder(selectedTag);
        const connection = {
            getRepository: vi
                .fn()
                .mockReturnValueOnce({ createQueryBuilder: vi.fn(() => recordedBuilder) })
                .mockReturnValueOnce({ createQueryBuilder: vi.fn(() => tagBuilder) })
                .mockReturnValueOnce({ createQueryBuilder: vi.fn(() => recordedBuilder) }),
        };
        const RecordedTagDB = loadCompiledDefault<{
            deleteRelation(tagId: number, recordedId: number): Promise<void>;
            setRelation(tagId: number, recordedId: number): Promise<void>;
        }>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.setRelation(20, 7)).resolves.toBeUndefined();
        await expect(repository.deleteRelation(20, 7)).resolves.toBeUndefined();

        expect(recorded.save).toHaveBeenCalledTimes(2);
        expect(savedTagSnapshots).toEqual([[10, 20], [10]]);
        expect(recorded.tags).toEqual([retainedTag]);
        expect(recordedBuilder.where).toHaveBeenCalledWith({ id: 7 });
        expect(tagBuilder.where).toHaveBeenCalledWith({ id: 20 });
    });

    it('[PERSIST-7.1-R2.6-PROGRAM-RAW] returns stored extended text without reinterpreting program business state', async () => {
        const stored = {
            extended: 'synthetic display text',
            id: 41,
            isFree: false,
            rawExtended: '{"synthetic":"stored"}',
        };
        const connection = { getRepository: vi.fn(() => ({ findOne: vi.fn(async () => stored) })) };
        const ProgramDB = loadCompiledDefault<{ findId(id: number): Promise<unknown> }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: silentLogger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findId(41)).resolves.toBe(stored);
    });

    it('[PERSIST-7.1-R3.10-RULE-CORRUPT] propagates corrupt persisted JSON instead of inventing defaults', async () => {
        const connection = {
            getRepository: vi.fn(() => ({ findOne: vi.fn(async () => ({ channelIds: '{broken-json' })) })),
        };
        const RuleDB = loadCompiledDefault<{ findId(id: number): Promise<unknown> }>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).rejects.toBeInstanceOf(SyntaxError);
    });

    it('[PERSIST-7.1-R3.1-R4.1-RESERVE-MUTATION] commits one reserve delete/insert/update batch without common retry', async () => {
        const { manager, runner } = transactionRunner();
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <Value>(job: () => Promise<Value>) => job()) };
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(
            repository.updateMany({ delete: [{ id: 1 }], insert: [{}], update: [{ id: 3 }] }),
        ).resolves.toBeUndefined();
        expect(manager.delete).toHaveBeenCalledOnce();
        expect(manager.insert).toHaveBeenCalledOnce();
        expect(manager.update).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
    });

    it('[PERSIST-7.1-R4.2-PROGRAM-COMMIT] commits one program replacement through the public port', async () => {
        const { manager, runner } = transactionRunner();
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const ProgramDB = loadCompiledDefault<{
            insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: silentLogger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(
            repository.insert(
                { 1: { 11: { channel: 'synthetic-11', id: 11, type: 'GR' } } },
                [
                    {
                        duration: 1_000,
                        eventId: 2,
                        id: 2,
                        isFree: true,
                        name: 'synthetic-program',
                        networkId: 1,
                        serviceId: 11,
                        startAt: 2_000,
                    },
                ],
                [11],
            ),
        ).resolves.toBeUndefined();
        expect(manager.delete).toHaveBeenCalledOnce();
        expect(manager.insert).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.release).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R4.2-FULL-AND-CHANNEL-REPLACE] commits full and selected-channel program replacements through public ports', async () => {
        const full = transactionRunner();
        const selectedChannel = transactionRunner();
        const ProgramDB = loadCompiledDefault<{
            insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: silentLogger },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator({
                createQueryRunner: vi.fn().mockReturnValueOnce(full.runner).mockReturnValueOnce(selectedChannel.runner),
            }),
            immediateRetry,
        );
        const channelTypes = { 1: { 11: { channel: 'synthetic-11', id: 11, type: 'GR' } } };
        const programs = [
            {
                duration: 1_000,
                eventId: 2,
                id: 2,
                isFree: true,
                name: 'synthetic-program',
                networkId: 1,
                serviceId: 11,
                startAt: 2_000,
            },
        ];

        await expect(repository.insert(channelTypes, programs)).resolves.toBeUndefined();
        await expect(repository.insert(channelTypes, programs, [11])).resolves.toBeUndefined();

        expect(full.deleteBuilder.execute).toHaveBeenCalledOnce();
        expect(full.manager.delete).not.toHaveBeenCalled();
        expect(selectedChannel.manager.delete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ channelId: expect.anything() }),
        );
        expect(JSON.stringify(selectedChannel.manager.delete.mock.calls[0]?.[1])).toContain('11');
        expect(full.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(selectedChannel.runner.commitTransaction).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R4.2-FULL-AND-CHANNEL-FAILURE] preserves InsertError and releases full and selected-channel failures', async () => {
        const logging = createRecordingLoggerModel();
        const full = transactionRunner();
        const selectedChannel = transactionRunner();
        const fullPrimary = new Error('synthetic-full-program-replacement-failure');
        const selectedChannelPrimary = new Error('synthetic-selected-channel-program-replacement-failure');
        full.deleteBuilder.execute.mockRejectedValue(fullPrimary);
        selectedChannel.manager.delete.mockRejectedValue(selectedChannelPrimary);
        const ProgramDB = loadCompiledDefault<{
            insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            logging.loggerModel,
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator({
                createQueryRunner: vi.fn().mockReturnValueOnce(full.runner).mockReturnValueOnce(selectedChannel.runner),
            }),
            immediateRetry,
        );
        const channelTypes = { 1: { 11: { channel: 'synthetic-11', id: 11, type: 'GR' } } };
        const programs = [
            {
                duration: 1_000,
                eventId: 2,
                id: 2,
                isFree: true,
                name: 'synthetic-program',
                networkId: 1,
                serviceId: 11,
                startAt: 2_000,
            },
        ];
        const diagnostic = logging.error;

        const publicErrors: unknown[] = [];
        for (const deleteChannelIds of [undefined, [11]] as const) {
            try {
                await repository.insert(channelTypes, programs, deleteChannelIds);
            } catch (error) {
                publicErrors.push(error);
            }
        }

        expect(publicErrors).toHaveLength(2);
        for (const publicError of publicErrors) {
            expect(publicError).toBeInstanceOf(Error);
            expect((publicError as Error).message).toBe('InsertError');
            expect((publicError as Error & { cause?: unknown }).cause).toBeUndefined();
        }

        for (const transaction of [full.runner, selectedChannel.runner]) {
            expect(transaction.commitTransaction).not.toHaveBeenCalled();
            expect(transaction.rollbackTransaction).toHaveBeenCalledOnce();
            expect(transaction.release).toHaveBeenCalledOnce();
        }
        expect(diagnostic.mock.calls).toEqual([[fullPrimary], [selectedChannelPrimary]]);
    });

    it('[PERSIST-7.1-R4.3-RESTORE-COMMIT] commits one typed restore through the public port', async () => {
        const { deleteBuilder, runner } = transactionRunner();
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const RuleDB = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.restore([])).resolves.toBeUndefined();
        // TypeORM 1.x rejects manager.delete(Entity, {}) with empty criteria, so restore() now wipes
        // the table via manager.createQueryBuilder().delete().from(Entity).execute().
        expect(deleteBuilder.delete).toHaveBeenCalledOnce();
        expect(deleteBuilder.execute).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.release).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R4.3-RESTORE-MIDWAY-ROLLBACK] rolls back a typed restore when an inserted item fails', async () => {
        const logging = createRecordingLoggerModel();
        const { deleteBuilder, manager, runner } = transactionRunner();
        const primary = new Error('synthetic-restore-insert-failure');
        manager.insert.mockRejectedValue(primary);
        const RecordedHistoryDB = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>(
            'model/db/RecordedHistoryDB.js',
        );
        const repository = new RecordedHistoryDB(
            logging.loggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );
        const diagnostic = logging.error;

        await expect(repository.restore([{ id: 1 }])).rejects.toThrow('restore error');
        expect(deleteBuilder.delete).toHaveBeenCalledOnce();
        expect(deleteBuilder.execute).toHaveBeenCalledOnce();
        expect(manager.insert).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).not.toHaveBeenCalled();
        expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(runner.isTransactionActive).toBe(false);
        expect(runner.release).toHaveBeenCalledOnce();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-7.1-R4.5-STAGED-RESTORE] keeps an earlier typed restore committed when a later restore fails', async () => {
        const logging = createRecordingLoggerModel();
        const first = transactionRunner();
        const second = transactionRunner();
        const primary = new Error('synthetic-later-restore-failure');
        second.runner.startTransaction.mockRejectedValue(primary);
        const RuleDB = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>('model/db/RuleDB.js');
        const ReserveDB = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>('model/db/ReserveDB.js');
        const ruleRepository = new RuleDB(
            logging.loggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => first.runner) }),
            immediateRetry,
        );
        const reserveRepository = new ReserveDB(
            logging.loggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => second.runner) }),
            immediateRetry,
        );
        const diagnostic = logging.error;

        await expect(ruleRepository.restore([])).resolves.toBeUndefined();
        await expect(reserveRepository.restore([])).rejects.toThrow('restore error');
        expect(first.runner.commitTransaction).toHaveBeenCalledOnce();
        expect(first.runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(second.runner.release).toHaveBeenCalledOnce();
        expect(diagnostic).toHaveBeenCalledWith(primary);
    });

    it('[PERSIST-7.1-R4.6-PROGRAM-PARTIAL] records an individual program failure and commits later work', async () => {
        const { manager, runner } = transactionRunner();
        const firstFailure = new Error('synthetic-program-delete-failure');
        manager.delete.mockImplementation(async (_target: unknown, id: number) => {
            if (id === 1) throw firstFailure;
        });
        const errors = vi.fn();
        const ProgramDB = loadCompiledDefault<{
            update(
                channelTypes: object,
                values: { delete: number[]; insert: object[]; update: object[] },
            ): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: () => ({ system: { error: errors, info: vi.fn() } }) },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );

        await expect(repository.update({}, { delete: [1, 2], insert: [], update: [] })).resolves.toBeUndefined();
        expect(manager.delete).toHaveBeenCalledTimes(2);
        expect(errors).toHaveBeenCalledWith('program delete error: 1');
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.release).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R4.7-CHANNEL-NONUNIFORM] continues a channel batch after an individual mutation failure', async () => {
        const { manager, runner } = transactionRunner();
        const insertFailure = new Error('synthetic-channel-insert-failure');
        manager.insert.mockImplementation(async (_target: unknown, value: { id: number }) => {
            if (value.id === 1) throw insertFailure;
            return { identifiers: [{ id: value.id }] };
        });
        manager.update.mockRejectedValue(new Error('synthetic-channel-update-failure'));
        const errors = vi.fn();
        const ChannelDB = loadCompiledDefault<{ insert(channels: object[], needsDeleted?: boolean): Promise<void> }>(
            'model/db/ChannelDB.js',
        );
        const repository = new ChannelDB(
            { getLogger: () => ({ system: { error: errors, info: vi.fn() } }) },
            { getConfig: () => ({}) },
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );

        await expect(
            repository.insert(
                [
                    {
                        channel: { channel: 'synthetic-1', type: 'GR' },
                        id: 1,
                        name: 'synthetic-1',
                        networkId: 1,
                        serviceId: 1,
                    },
                    {
                        channel: { channel: 'synthetic-2', type: 'GR' },
                        id: 2,
                        name: 'synthetic-2',
                        networkId: 1,
                        serviceId: 2,
                    },
                ],
                false,
            ),
        ).resolves.toBeUndefined();
        expect(manager.insert).toHaveBeenCalledTimes(2);
        expect(errors).toHaveBeenCalledWith('channel update error');
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.release).toHaveBeenCalledOnce();
    });

    it('[PERSIST-7.1-R4.8-COMMIT-FAILURE] rolls back and releases after a public batch commit failure', async () => {
        const logging = createRecordingLoggerModel();
        const { runner } = transactionRunner();
        const primary = new Error('synthetic-reserve-commit-failure');
        runner.commitTransaction.mockRejectedValue(primary);
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(
            logging.loggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );
        const diagnostic = logging.error;

        await expect(repository.updateMany({})).rejects.toThrow('ReserveUpdateManyError');
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(runner.isTransactionActive).toBe(false);
        expect(runner.release).toHaveBeenCalledOnce();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-7.1-R4.9-PRIMARY-CLEANUP-DIAGNOSTICS] separates primary, rollback, and release diagnostics from the public wrapper', async () => {
        const logging = createRecordingLoggerModel();
        const { manager, runner } = transactionRunner();
        const primary = new Error('synthetic-reserve-primary-failure');
        const rollback = new Error('synthetic-reserve-rollback-failure');
        const release = new Error('synthetic-reserve-release-failure');
        manager.delete.mockRejectedValue(primary);
        runner.rollbackTransaction.mockRejectedValue(rollback);
        runner.release.mockRejectedValue(release);
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(
            logging.loggerModel,
            repositoryOperator({ createQueryRunner: vi.fn(() => runner) }),
            immediateRetry,
        );
        const diagnostic = logging.error;

        let publicError: unknown;
        try {
            await repository.updateMany({ delete: [{ id: 1 }] });
        } catch (error) {
            publicError = error;
        }

        expect(publicError).toBeInstanceOf(Error);
        expect((publicError as Error).message).toBe('ReserveUpdateManyError');
        expect((publicError as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(diagnostic.mock.calls).toEqual([[primary], [rollback], [release]]);
    });

    it.each([
        ['RuleDB', 'model/db/RuleDB.js'],
        ['ReserveDB', 'model/db/ReserveDB.js'],
        ['RecordedDB', 'model/db/RecordedDB.js'],
        ['ThumbnailDB', 'model/db/ThumbnailDB.js'],
        ['VideoFileDB', 'model/db/VideoFileDB.js'],
        ['DropLogFileDB', 'model/db/DropLogFileDB.js'],
        ['RecordedHistoryDB', 'model/db/RecordedHistoryDB.js'],
        ['RecordedTagDB', 'model/db/RecordedTagDB.js'],
    ])(
        '[PERSIST-4.8-RESTORE-START-%s] keeps the restore error wrapper after a transaction start failure',
        async (_name, modulePath) => {
            const logging = createRecordingLoggerModel();
            const primary = new Error('synthetic-start-primary');
            const runner = {
                commitTransaction: vi.fn(),
                isTransactionActive: false,
                manager: { delete: vi.fn(), insert: vi.fn() },
                release: vi.fn(),
                rollbackTransaction: vi.fn(),
                startTransaction: vi.fn(async () => {
                    throw primary;
                }),
            };
            const connection = { createQueryRunner: vi.fn(() => runner) };
            const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
            const Repository = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>(modulePath);
            const repository = new Repository(logging.loggerModel, repositoryOperator(connection), retry);
            const diagnostic = logging.error;

            await expect(repository.restore([])).rejects.toThrow('restore error');
            expect(runner.startTransaction).toHaveBeenCalledOnce();
            expect(runner.rollbackTransaction).not.toHaveBeenCalled();
            expect(runner.release).toHaveBeenCalledOnce();
            expect(retry.run).not.toHaveBeenCalled();
            expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
        },
    );

    it('[PERSIST-4.8-CHANNEL-INSERT-START] releases an inactive runner and keeps the insert error wrapper after start failure', async () => {
        const logging = createRecordingLoggerModel();
        const primary = new Error('synthetic-channel-insert-start-primary');
        const runner = {
            commitTransaction: vi.fn(),
            isTransactionActive: false,
            manager: { delete: vi.fn(), insert: vi.fn(), update: vi.fn() },
            release: vi.fn(),
            rollbackTransaction: vi.fn(),
            startTransaction: vi.fn(async () => {
                throw primary;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ChannelDB = loadCompiledDefault<{ insert(channels: object[]): Promise<void> }>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            logging.loggerModel,
            { getConfig: () => ({}) },
            repositoryOperator(connection),
            retry,
        );
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.insert([]);
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('insert error');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-4.8-PROGRAM-INSERT-START] releases an inactive runner and keeps InsertError after start failure', async () => {
        const logging = createRecordingLoggerModel();
        const primary = new Error('synthetic-program-insert-start-primary');
        const runner = {
            commitTransaction: vi.fn(),
            isTransactionActive: false,
            manager: { delete: vi.fn(), insert: vi.fn() },
            release: vi.fn(),
            rollbackTransaction: vi.fn(async () => undefined),
            startTransaction: vi.fn(async () => {
                throw primary;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ProgramDB = loadCompiledDefault<{
            insert(channelTypes: object, programs: object[], deleteChannelIds?: number[]): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            logging.loggerModel,
            { getConfig: () => ({}) },
            repositoryOperator(connection),
            retry,
        );
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.insert({}, []);
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('InsertError');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-4.8-PROGRAM-UPDATE-START] releases an inactive runner and keeps UpdateError after start failure', async () => {
        const logging = createRecordingLoggerModel();
        const primary = new Error('synthetic-program-update-start-primary');
        const runner = {
            commitTransaction: vi.fn(),
            isTransactionActive: false,
            manager: { delete: vi.fn(), insert: vi.fn(), update: vi.fn() },
            release: vi.fn(),
            rollbackTransaction: vi.fn(async () => undefined),
            startTransaction: vi.fn(async () => {
                throw primary;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ProgramDB = loadCompiledDefault<{
            update(channelTypes: object, values: object): Promise<void>;
        }>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            logging.loggerModel,
            { getConfig: () => ({}) },
            repositoryOperator(connection),
            retry,
        );
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.update({}, { delete: [], insert: [], update: [] });
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('UpdateError');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-4.8-RESERVE-UPDATE-MANY-START] releases an inactive runner and keeps ReserveUpdateManyError after start failure', async () => {
        const logging = createRecordingLoggerModel();
        const primary = new Error('synthetic-reserve-update-many-start-primary');
        const runner = {
            commitTransaction: vi.fn(),
            isTransactionActive: false,
            manager: { delete: vi.fn(), insert: vi.fn(), update: vi.fn() },
            release: vi.fn(),
            rollbackTransaction: vi.fn(async () => undefined),
            startTransaction: vi.fn(async () => {
                throw primary;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(logging.loggerModel, repositoryOperator(connection), retry);
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.updateMany({});
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('ReserveUpdateManyError');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-4.8-RESERVE-UPDATE-MANY-ACTIVE] rolls an active transaction back and keeps ReserveUpdateManyError after a mutation failure', async () => {
        const logging = createRecordingLoggerModel();
        const primary = new Error('synthetic-reserve-update-many-mutation-primary');
        let active = false;
        const runner = {
            commitTransaction: vi.fn(),
            get isTransactionActive() {
                return active;
            },
            manager: {
                delete: vi.fn(async () => {
                    expect(active).toBe(true);
                    throw primary;
                }),
                insert: vi.fn(),
                update: vi.fn(),
            },
            release: vi.fn(async () => undefined),
            rollbackTransaction: vi.fn(async () => {
                expect(active).toBe(true);
                active = false;
            }),
            startTransaction: vi.fn(async () => {
                active = true;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(logging.loggerModel, repositoryOperator(connection), retry);
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.updateMany({ delete: [{ id: 1 }] });
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('ReserveUpdateManyError');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.manager.delete).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
        expect(runner.isTransactionActive).toBe(false);
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(primary);
    });

    it('[PERSIST-4.8-RESERVE-UPDATE-MANY-RELEASE] keeps ReserveUpdateManyError after release failure', async () => {
        const logging = createRecordingLoggerModel();
        const cleanup = new Error('synthetic-reserve-update-many-release-cleanup');
        let active = false;
        const runner = {
            commitTransaction: vi.fn(async () => {
                active = false;
            }),
            get isTransactionActive() {
                return active;
            },
            manager: { delete: vi.fn(), insert: vi.fn(), update: vi.fn() },
            release: vi.fn(async () => {
                throw cleanup;
            }),
            rollbackTransaction: vi.fn(async () => {
                active = false;
            }),
            startTransaction: vi.fn(async () => {
                active = true;
            }),
        };
        const connection = { createQueryRunner: vi.fn(() => runner) };
        const retry = { run: vi.fn(async <T>(job: () => Promise<T>) => job()) };
        const ReserveDB = loadCompiledDefault<{ updateMany(values: object): Promise<void> }>('model/db/ReserveDB.js');
        const repository = new ReserveDB(logging.loggerModel, repositoryOperator(connection), retry);
        const diagnostic = logging.error;

        let rejection: unknown;
        try {
            await repository.updateMany({});
        } catch (error) {
            rejection = error;
        }

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe('ReserveUpdateManyError');
        expect((rejection as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(runner.startTransaction).toHaveBeenCalledOnce();
        expect(runner.commitTransaction).toHaveBeenCalledOnce();
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
        expect(runner.release).toHaveBeenCalledOnce();
        expect(retry.run).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith(cleanup);
    });
});
