import { describe, expect, it, vi } from 'vitest';

import { immediateRetry, loadCompiled, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

const basePersistedRule = {
    id: 1,
    updateCnt: 0,
    isTimeSpecification: false,
    keyword: 'synthetic',
    ignoreKeyword: null,
    keyCS: false,
    keyRegExp: false,
    name: true,
    description: false,
    extended: false,
    ignoreKeyCS: false,
    ignoreKeyRegExp: false,
    ignoreName: false,
    ignoreDescription: false,
    ignoreExtended: false,
    GR: true,
    BS: false,
    CS: false,
    SKY: false,
    channelIds: '[11,12]',
    genres: '[{"genre":1,"subGenre":2}]',
    times: '[{"week":1,"start":10,"range":20}]',
    isFree: false,
    durationMin: null,
    durationMax: null,
    searchPeriods: '[{"startAt":100,"endAt":200}]',
    enable: true,
    allowEndLack: true,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
    tags: '[7]',
    parentDirectoryName: null,
    directory: null,
    recordedFormat: null,
    mode1: null,
    parentDirectoryName1: null,
    directory1: null,
    mode2: null,
    parentDirectoryName2: null,
    directory2: null,
    mode3: null,
    parentDirectoryName3: null,
    directory3: null,
};

describe('repository serialization and ownership characterization', () => {
    it('[PERSIST-2.2-RULE-JSON] restores every persisted composite JSON value without replacing it', async () => {
        const connection = {
            getRepository: vi.fn(() => ({ findOne: vi.fn(async () => ({ ...basePersistedRule })) })),
        };
        const RuleDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).resolves.toMatchObject({
            searchOption: {
                channelIds: [11, 12],
                genres: [{ genre: 1, subGenre: 2 }],
                times: [{ week: 1, start: 10, range: 20 }],
                searchPeriods: [{ startAt: 100, endAt: 200 }],
            },
            reserveOption: { tags: [7] },
        });
    });

    it('[PERSIST-2.2-RULE-CORRUPT] propagates corrupt persisted JSON instead of inventing defaults', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                findOne: vi.fn(async () => ({ ...basePersistedRule, channelIds: '{broken-json' })),
            })),
        };
        const RuleDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RuleDB.js');
        const repository = new RuleDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).rejects.toBeInstanceOf(SyntaxError);
    });

    it('[PERSIST-2.1-PROGRAM-RAW] returns stored extended text without reinterpreting program business state', async () => {
        const stored = {
            id: 41,
            extended: 'synthetic display text',
            rawExtended: '{"synthetic":"stored"}',
            isFree: false,
        };
        const connection = { getRepository: vi.fn(() => ({ findOne: vi.fn(async () => stored) })) };
        const ProgramDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ProgramDB.js');
        const repository = new ProgramDB(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findId(41)).resolves.toBe(stored);
    });

    it('[PERSIST-2.3-THUMBNAIL-UNDEFINED] normalizes an undefined query result to null instead of returning it as-is', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => undefined) })),
                })),
            })),
        };
        const ThumbnailDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ThumbnailDB.js');
        const repository = new ThumbnailDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).resolves.toBeNull();
    });

    it('[PERSIST-2.3-DROPLOG-UNDEFINED] normalizes an undefined query result to null instead of returning it as-is', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => undefined) })),
                })),
            })),
        };
        const DropLogFileDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/DropLogFileDB.js');
        const repository = new DropLogFileDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).resolves.toBeNull();
    });

    it('[PERSIST-2.3-VIDEOFILE-UNDEFINED] normalizes an undefined query result to null instead of returning it as-is', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => undefined) })),
                })),
            })),
        };
        const VideoFileDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/VideoFileDB.js');
        const repository = new VideoFileDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.findId(1)).resolves.toBeNull();
    });

    it('[PERSIST-2.3-VIDEOFILE-UPDATE-PATH-NULL] rejects path updates when the video file row is missing', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => null) })),
                })),
            })),
        };
        const VideoFileDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/VideoFileDB.js');
        const repository = new VideoFileDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(
            repository.updateFilePath({
                videoFileId: 9,
                parentDirectoryName: 'recorded',
                filePath: 'missing.ts',
            }),
        ).rejects.toThrow('VideoFileIsNull');
    });

    it('[PERSIST-2.3-VIDEOFILE-UPDATE-SIZE-NULL] rejects size updates when the video file row is missing', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => null) })),
                })),
            })),
        };
        const VideoFileDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/VideoFileDB.js');
        const repository = new VideoFileDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.updateSize(9, 1024)).rejects.toThrow('VideoFileIsNull');
    });

    it('[PERSIST-2.3-CHANNEL-UNDEFINED] normalizes an undefined findOne result to null instead of returning it as-is', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                findOne: vi.fn(async () => undefined),
            })),
        };
        const ChannelDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            { getConfig: () => ({}) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findId(1)).resolves.toBeNull();
    });

    it('[PERSIST-2.3-RESERVE-TIMESPEC-UNDEFINED] normalizes an undefined findTimeSpecification result to null instead of returning it as-is', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                findOne: vi.fn(async () => undefined),
            })),
        };
        const ReserveDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ReserveDB.js');
        const repository = new ReserveDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(
            repository.findTimeSpecification({ channelId: 1, startAt: 100, endAt: 200 }),
        ).resolves.toBeNull();
    });

    it('[PERSIST-2.3-CHANNEL-FINDALL-UNSORTED] returns the raw query order when findAll leaves needSort at its false default', async () => {
        const rows = [{ id: 2 }, { id: 1 }];
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    orderBy: vi.fn(() => ({ getMany: vi.fn(async () => rows) })),
                })),
            })),
        };
        const ChannelDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            // A channelOrder is configured so a call that actually reached sortChannels would reorder
            // this result; leaving needSort at its default proves findAll's `needSort === true ? ... :
            // result` (ChannelDB.ts:191) took the untouched-`result` arm instead.
            { getConfig: () => ({ channelOrder: [1, 2] }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findAll()).resolves.toEqual(rows);
    });

    it('[PERSIST-2.3-CHANNELTYPES-UNSORTED] returns the raw query order when findChannleTypes leaves needSort at its false default', async () => {
        const rows = [{ id: 2 }, { id: 1 }];
        const whereSpy = vi.fn(() => ({ orderBy: vi.fn(() => ({ getMany: vi.fn(async () => rows) })) }));
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({ where: whereSpy })),
            })),
        };
        const ChannelDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            // A channelOrder is configured so a call that actually reached sortChannels would reorder
            // this result; leaving needSort at its default proves findChannleTypes's `needSort === true
            // ? ... : result` (ChannelDB.ts:191) took the untouched-`result` arm instead.
            { getConfig: () => ({ channelOrder: [1, 2] }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findChannleTypes(['GR'])).resolves.toEqual(rows);
        expect(whereSpy).toHaveBeenCalledWith([{ channelType: 'GR' }]);
    });

    it('[PERSIST-2.3-CHANNEL-SORT-MISSING-ID] skips a configured channelOrder id absent from the query result', async () => {
        const rows = [{ id: 2 }, { id: 1 }];
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    orderBy: vi.fn(() => ({ getMany: vi.fn(async () => rows) })),
                })),
            })),
        };
        const ChannelDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/ChannelDB.js');
        const repository = new ChannelDB(
            { getLogger: () => ({ system: { error: vi.fn(), info: vi.fn() } }) },
            // id 999 is not present in `rows`, so sortChannels's `order.forEach` must skip it
            // (ChannelDB.ts:239 `if (i === -1) return;`) before placing id 1 ahead of id 2.
            { getConfig: () => ({ channelOrder: [999, 1] }) },
            repositoryOperator(connection),
            immediateRetry,
        );

        await expect(repository.findAll(true)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('[PERSIST-2.3-RECORDEDTAG-UPDATE-NULL] rejects tag updates when the tag row is missing', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({ getOne: vi.fn(async () => null) })),
                })),
            })),
        };
        const RecordedTagDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.updateOnce(3, 'name', '#fff')).rejects.toThrow('TagIsNull');
    });

    it('[PERSIST-2.3-RECORDEDTAG-SET-RELATION-TAG-NULL] rejects relation setup when the tag row is missing', async () => {
        const recorded = { id: 11, tags: [], save: vi.fn(async () => recorded) };
        const connection = {
            getRepository: vi.fn((entity: { name?: string } | string) => {
                const name = typeof entity === 'string' ? entity : entity?.name;
                if (name === 'Recorded' || name === 'recorded') {
                    return {
                        createQueryBuilder: vi.fn(() => ({
                            where: vi.fn(() => ({
                                leftJoinAndSelect: vi.fn(() => ({
                                    getOne: vi.fn(async () => recorded),
                                })),
                            })),
                        })),
                    };
                }
                return {
                    createQueryBuilder: vi.fn(() => ({
                        where: vi.fn(() => ({ getOne: vi.fn(async () => null) })),
                    })),
                };
            }),
        };
        const RecordedTagDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.setRelation(3, 11)).rejects.toThrow('RecordedTagIsUndefined');
    });

    it('[PERSIST-2.3-RECORDEDTAG-FIND-RECORDED-NULL] rejects relation setup when the recorded row is missing', async () => {
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({
                        leftJoinAndSelect: vi.fn(() => ({
                            getOne: vi.fn(async () => null),
                        })),
                    })),
                })),
            })),
        };
        const RecordedTagDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.setRelation(3, 11)).rejects.toThrow('RecordedIsUndefined');
    });

    it('[PERSIST-2.3-RECORDEDTAG-DELETE-ALL-RELATION] clears every tag relation for a recorded row and saves it', async () => {
        const recorded = {
            id: 11,
            tags: [{ id: 1 }, { id: 2 }],
            save: vi.fn(async function (this: { id: number; tags: unknown[] }) {
                return this;
            }),
        };
        const connection = {
            getRepository: vi.fn(() => ({
                createQueryBuilder: vi.fn(() => ({
                    where: vi.fn(() => ({
                        leftJoinAndSelect: vi.fn(() => ({
                            getOne: vi.fn(async () => recorded),
                        })),
                    })),
                })),
            })),
        };
        const RecordedTagDB = loadCompiled<new (...arguments_: any[]) => any>('model/db/RecordedTagDB.js');
        const repository = new RecordedTagDB(silentLoggerModel, repositoryOperator(connection), immediateRetry);

        await expect(repository.deleteAllRelation(11)).resolves.toBeUndefined();
        expect(recorded.tags).toEqual([]);
        expect(recorded.save).toHaveBeenCalledTimes(1);
    });
});

/**
 * Fluent query-builder fake for current legacy RecordedDB.findOld assembly.
 * Characterizes the two sequential orderBy calls as written in source today;
 * does not assert real SQL multi-key ordering semantics.
 */
const findOldQueryBuilder = (result: unknown, getOneImpl?: () => Promise<unknown>) => {
    const builder = {
        getOne: vi.fn(getOneImpl ?? (async () => result)),
        leftJoinAndSelect: vi.fn(),
        orderBy: vi.fn(),
        where: vi.fn(),
    };
    for (const method of ['leftJoinAndSelect', 'orderBy', 'where'] as const) {
        builder[method].mockReturnValue(builder);
    }
    return builder;
};

describe('RecordedDB.findOld current fluent assembly (unittest/imp)', () => {
    it('[PERSIST-2-RECORDED-FIND-OLD] characterizes current legacy fluent assembly with dual orderBy, four joins, and promiseRetry terminal', async () => {
        const row = { id: 17, isProtected: false, name: 'synthetic-find-old-row' };
        const builder = findOldQueryBuilder(row);
        const createQueryBuilder = vi.fn(() => builder);
        const getRepository = vi.fn(() => ({ createQueryBuilder }));
        const connection = { getRepository };
        const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
        const RecordedDB = loadCompiled<new (...arguments_: any[]) => { findOld(): Promise<unknown> }>(
            'model/db/RecordedDB.js',
        );
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(repository.findOld()).resolves.toEqual(row);

        expect(getRepository).toHaveBeenCalledOnce();
        expect(createQueryBuilder).toHaveBeenCalledWith('recorded');
        expect(builder.where).toHaveBeenCalledWith({ isProtected: false });
        // Current source calls orderBy twice in sequence (startAt then id). TypeORM orderBy
        // overwrites prior keys; this case records the assembly calls, not multi-key ORDER BY.
        expect(builder.orderBy.mock.calls).toEqual([
            ['recorded.startAt', 'ASC'],
            ['recorded.id', 'ASC'],
        ]);
        expect(builder.leftJoinAndSelect.mock.calls).toEqual([
            ['recorded.videoFiles', 'videoFiles'],
            ['recorded.thumbnails', 'thumbnails'],
            ['recorded.dropLogFile', 'dropLogFile'],
            ['recorded.tags', 'tags'],
        ]);
        expect(builder.getOne).toHaveBeenCalledOnce();
        expect(retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-2-RECORDED-FIND-OLD-ABSENT] maps an undefined getOne result to null through the current assembly', async () => {
        const builder = findOldQueryBuilder(undefined);
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
        const RecordedDB = loadCompiled<new (...arguments_: any[]) => { findOld(): Promise<unknown> }>(
            'model/db/RecordedDB.js',
        );
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(repository.findOld()).resolves.toBeNull();
        expect(builder.getOne).toHaveBeenCalledOnce();
        expect(retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-2-RECORDED-FIND-OLD-REJECT] propagates a getOne rejection through promiseRetry without converting to null', async () => {
        const sentinel = new Error('SYNTHETIC_FIND_OLD_GETONE_REJECTION');
        const builder = findOldQueryBuilder(undefined, async () => {
            throw sentinel;
        });
        const connection = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) };
        const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
        const RecordedDB = loadCompiled<new (...arguments_: any[]) => { findOld(): Promise<unknown> }>(
            'model/db/RecordedDB.js',
        );
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(repository.findOld()).rejects.toBe(sentinel);
        expect(builder.getOne).toHaveBeenCalledOnce();
        expect(retry.run).toHaveBeenCalledOnce();
    });
});

/**
 * Fluent update-builder fake for current RecordedDB.removeRuleId assembly.
 * connection.createQueryBuilder() → update(Recorded) → set(ruleId:null) → where → execute via retry.
 */
const removeRuleIdQueryBuilder = (executeImpl?: () => Promise<unknown>) => {
    const builder = {
        execute: vi.fn(executeImpl ?? (async () => ({ affected: 1 }))),
        set: vi.fn(),
        update: vi.fn(),
        where: vi.fn(),
    };
    for (const method of ['set', 'update', 'where'] as const) {
        builder[method].mockReturnValue(builder);
    }
    return builder;
};

describe('RecordedDB.removeRuleId current update assembly (unittest/imp)', () => {
    it('[PERSIST-2-RECORDED-REMOVE-RULE-ID] characterizes createQueryBuilder update/set/where/execute through promiseRetry', async () => {
        const builder = removeRuleIdQueryBuilder();
        const createQueryBuilder = vi.fn(() => builder);
        const connection = { createQueryBuilder };
        const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
        const Recorded = loadCompiled<unknown>('db/entities/Recorded.js');
        const RecordedDB = loadCompiled<new (...arguments_: any[]) => { removeRuleId(ruleId: number): Promise<void> }>(
            'model/db/RecordedDB.js',
        );
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(repository.removeRuleId(42)).resolves.toBeUndefined();

        expect(createQueryBuilder).toHaveBeenCalledOnce();
        expect(builder.update).toHaveBeenCalledWith(Recorded);
        expect(builder.set).toHaveBeenCalledWith({ ruleId: null });
        expect(builder.where).toHaveBeenCalledWith({ ruleId: 42 });
        expect(builder.execute).toHaveBeenCalledOnce();
        expect(retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-2-RECORDED-REMOVE-RULE-ID-REJECT] propagates an execute rejection through promiseRetry', async () => {
        const sentinel = new Error('SYNTHETIC_REMOVE_RULE_ID_EXECUTE_REJECTION');
        const builder = removeRuleIdQueryBuilder(async () => {
            throw sentinel;
        });
        const connection = { createQueryBuilder: vi.fn(() => builder) };
        const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
        const RecordedDB = loadCompiled<new (...arguments_: any[]) => { removeRuleId(ruleId: number): Promise<void> }>(
            'model/db/RecordedDB.js',
        );
        const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);

        await expect(repository.removeRuleId(7)).rejects.toBe(sentinel);
        expect(builder.execute).toHaveBeenCalledOnce();
        expect(retry.run).toHaveBeenCalledOnce();
    });
});
