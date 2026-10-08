import 'reflect-metadata';

import { Container } from 'inversify';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { compiledSnapshot } from './harness';
import { loadCompiledDefault, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));

interface StorageDeletionCandidatePort {
    findOldestUnused(request: {
        readonly excludedRecordedIds: ReadonlySet<number>;
        readonly storageName: string;
    }): Promise<number | null>;
}

const candidateQuery = (result: { id: number } | undefined | Error, dialect: 'mysql' | 'sqlite' = 'sqlite') => {
    const relationQueries: Array<{
        andWhere: ReturnType<typeof vi.fn>;
        from: ReturnType<typeof vi.fn>;
        getQuery: ReturnType<typeof vi.fn>;
        select: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
    }> = [];
    const query = {
        addOrderBy: vi.fn(),
        andWhere: vi.fn(),
        getRawOne: vi.fn(async () => {
            if (result instanceof Error) throw result;
            return result;
        }),
        orderBy: vi.fn(),
        select: vi.fn(),
        subQuery: vi.fn(() => {
            const relationQuery = {
                andWhere: vi.fn(),
                from: vi.fn(),
                getQuery: vi.fn(() => `(SELECT 1 FROM synthetic_relation_${relationQueries.length})`),
                select: vi.fn(),
                where: vi.fn(),
            };
            for (const method of ['andWhere', 'from', 'select', 'where'] as const) {
                relationQuery[method].mockReturnValue(relationQuery);
            }
            relationQueries.push(relationQuery);
            return relationQuery;
        }),
        take: vi.fn(),
        where: vi.fn(),
    };
    for (const method of ['addOrderBy', 'andWhere', 'orderBy', 'select', 'take', 'where'] as const) {
        query[method].mockReturnValue(query);
    }
    const connection = {
        getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => query) })),
        options: { type: dialect },
    };
    const retry = { run: vi.fn(<T>(job: () => Promise<T>) => job()) };
    const RecordedDB = loadCompiledDefault<StorageDeletionCandidatePort>('model/db/RecordedDB.js');
    const repository = new RecordedDB(silentLoggerModel, repositoryOperator(connection), retry);
    return { query, relationQueries, repository, retry };
};

describe('storage deletion candidate persistence contract', () => {
    it('[PERSIST-2.7] returns one primitive id and applies storage, protection, exclusion, and stable order together', async () => {
        const harness = candidateQuery({ id: 73 });
        const excludedRecordedIds = new Set([11, 12]);

        await expect(harness.repository.findOldestUnused({ storageName: 'main', excludedRecordedIds })).resolves.toBe(
            73,
        );

        expect(harness.query.select).toHaveBeenCalledWith('recorded.id', 'id');
        expect(harness.query.where).toHaveBeenCalledWith('recorded.isProtected = :isProtected', {
            isProtected: 0,
        });
        expect(harness.relationQueries).toHaveLength(2);
        expect(harness.relationQueries[0].from.mock.calls[0][1]).toBe('matchingVideo');
        expect(harness.relationQueries[0].where).toHaveBeenCalledWith('matchingVideo.recordedId = recorded.id');
        expect(harness.relationQueries[0].andWhere).toHaveBeenCalledWith(
            'CAST(matchingVideo.parentDirectoryName AS BLOB) = CAST(:storageName AS BLOB)',
        );
        expect(harness.relationQueries[1].from.mock.calls[0][1]).toBe('mismatchingVideo');
        expect(harness.relationQueries[1].where).toHaveBeenCalledWith('mismatchingVideo.recordedId = recorded.id');
        expect(harness.relationQueries[1].andWhere).toHaveBeenCalledWith(
            'CAST(mismatchingVideo.parentDirectoryName AS BLOB) <> CAST(:storageName AS BLOB)',
        );
        expect(harness.query.andWhere.mock.calls).toEqual([
            ['EXISTS (SELECT 1 FROM synthetic_relation_1)', { storageName: 'main' }],
            ['NOT EXISTS (SELECT 1 FROM synthetic_relation_2)'],
            ['recorded.id NOT IN (:...excludedRecordedIds)', { excludedRecordedIds: [11, 12] }],
        ]);
        expect(harness.query.orderBy).toHaveBeenCalledWith('recorded.startAt', 'ASC');
        expect(harness.query.addOrderBy).toHaveBeenCalledWith('recorded.id', 'ASC');
        expect(harness.query.take).toHaveBeenCalledWith(1);
        expect(harness.retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-2.7] uses byte-exact storage identity for the MySQL query', async () => {
        const harness = candidateQuery(undefined, 'mysql');

        await expect(
            harness.repository.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
        ).resolves.toBeNull();

        expect(harness.relationQueries[0].andWhere).toHaveBeenCalledWith(
            'CAST(matchingVideo.parentDirectoryName AS BINARY) = CAST(:storageName AS BINARY)',
        );
        expect(harness.relationQueries[1].andWhere).toHaveBeenCalledWith(
            'CAST(mismatchingVideo.parentDirectoryName AS BINARY) <> CAST(:storageName AS BINARY)',
        );
    });

    it('[PERSIST-2.7] maps absence to null without generating an empty NOT IN predicate', async () => {
        const harness = candidateQuery(undefined);

        await expect(
            harness.repository.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
        ).resolves.toBeNull();

        expect(harness.query.andWhere.mock.calls).toHaveLength(2);
        expect(harness.query.andWhere.mock.calls.flat()).not.toContain('recorded.id NOT IN (:...excludedRecordedIds)');
    });

    it('[PERSIST-2.7] preserves the final query rejection instead of converting it to no candidate', async () => {
        const failure = new Error('synthetic candidate query rejection');
        const harness = candidateQuery(failure);

        await expect(
            harness.repository.findOldestUnused({ storageName: 'main', excludedRecordedIds: new Set() }),
        ).rejects.toBe(failure);
        expect(harness.retry.run).toHaveBeenCalledOnce();
    });

    it('[PERSIST-2.7] binds the storage-owned candidate port to the singleton RecordedDB provider', () => {
        const container = new Container();
        const { set } = require(join(compiledSnapshot, 'model/ModelContainerSetter.js')) as {
            set(container: Container): void;
        };
        set(container);
        container.rebind('IDBOperator').toConstantValue({});
        container.rebind('IPromiseRetry').toConstantValue({});
        container.rebind('ILoggerModel').toConstantValue(silentLoggerModel);

        expect(container.get('IStorageDeletionCandidatePort')).toBe(container.get('IRecordedDB'));
    });
});
