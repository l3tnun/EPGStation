import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLoggerModel } from '../harness/silent-logger-model';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedDB = (
    require(join(snapshot, 'model', 'db', 'RecordedDB.js')) as {
        default: new (...args: unknown[]) => {
            removeRecording(recordedId: number): Promise<void>;
            changeProtect(recordedId: number, isProtect: boolean): Promise<void>;
        };
    }
).default;
const Recorded = (
    require(join(snapshot, 'db', 'entities', 'Recorded.js')) as {
        default: new () => Record<string, unknown>;
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedDB.removeRecording / changeProtect with connection / query-builder / retry mocked.
 * Residual is findId===null and already-state early returns (L108–115, L178–185);
 * happy-path update is covered elsewhere while callers mock the DB methods.
 */
const makeFixture = (findRows: unknown[] = []) => {
    const findBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['where', 'leftJoinAndSelect'] as const) {
        findBuilder[method] = vi.fn(() => findBuilder);
    }
    findBuilder.getMany = vi.fn(async () => findRows);

    const updateBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['update', 'set', 'where'] as const) {
        updateBuilder[method] = vi.fn(() => updateBuilder);
    }
    updateBuilder.execute = vi.fn(async () => ({ affected: 1 }));

    const repositoryCreateQueryBuilder = vi.fn(() => findBuilder);
    const getRepository = vi.fn(() => ({ createQueryBuilder: repositoryCreateQueryBuilder }));
    const connectionCreateQueryBuilder = vi.fn(() => updateBuilder);
    const getConnection = vi.fn(async () => ({
        getRepository,
        createQueryBuilder: connectionCreateQueryBuilder,
    }));
    const retry = { run: vi.fn(async (job: () => Promise<unknown>) => job()) };
    const provider = new RecordedDB(silentLoggerModel, { getConnection }, retry);

    return {
        connectionCreateQueryBuilder,
        findBuilder,
        getConnection,
        getRepository,
        provider,
        repositoryCreateQueryBuilder,
        retry,
        updateBuilder,
    };
};

describe('RecordedDB removeRecording/changeProtect early-return guards (unittest/imp)', () => {
    it('[R2-RECORDEDDB-EARLY-RETURN] removeRecording throws RecordedIsNull when findId returns null', async () => {
        const fixture = makeFixture([]);

        await expect(fixture.provider.removeRecording(101)).rejects.toThrow('RecordedIsNull');

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Recorded);
        expect(fixture.repositoryCreateQueryBuilder).toHaveBeenCalledExactlyOnceWith('recorded');
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.findBuilder.getMany).toHaveBeenCalledOnce();
        expect(fixture.connectionCreateQueryBuilder).not.toHaveBeenCalled();
        expect(fixture.updateBuilder.execute).not.toHaveBeenCalled();
    });

    it('[R2-RECORDEDDB-EARLY-RETURN] removeRecording returns without update when isRecording is already false', async () => {
        const fixture = makeFixture([{ id: 102, isRecording: false, isProtected: false }]);

        await expect(fixture.provider.removeRecording(102)).resolves.toBeUndefined();

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Recorded);
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.findBuilder.getMany).toHaveBeenCalledOnce();
        expect(fixture.connectionCreateQueryBuilder).not.toHaveBeenCalled();
        expect(fixture.updateBuilder.update).not.toHaveBeenCalled();
        expect(fixture.updateBuilder.execute).not.toHaveBeenCalled();
    });

    it('[R2-RECORDEDDB-EARLY-RETURN] changeProtect throws RecordedIsNull when findId returns null', async () => {
        const fixture = makeFixture([]);

        await expect(fixture.provider.changeProtect(201, true)).rejects.toThrow('RecordedIsNull');

        expect(fixture.getConnection).toHaveBeenCalledOnce();
        expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Recorded);
        expect(fixture.repositoryCreateQueryBuilder).toHaveBeenCalledExactlyOnceWith('recorded');
        expect(fixture.retry.run).toHaveBeenCalledOnce();
        expect(fixture.findBuilder.getMany).toHaveBeenCalledOnce();
        expect(fixture.connectionCreateQueryBuilder).not.toHaveBeenCalled();
        expect(fixture.updateBuilder.execute).not.toHaveBeenCalled();
    });

    it.each([
        {
            title: 'true/true',
            recordedId: 202,
            isProtected: true,
            request: true,
        },
        {
            title: 'false/false',
            recordedId: 203,
            isProtected: false,
            request: false,
        },
    ])(
        '[R2-RECORDEDDB-EARLY-RETURN] changeProtect no-op when protect already matches ($title)',
        async ({ recordedId, isProtected, request }) => {
            const fixture = makeFixture([{ id: recordedId, isRecording: false, isProtected }]);

            await expect(fixture.provider.changeProtect(recordedId, request)).resolves.toBeUndefined();

            expect(fixture.getConnection).toHaveBeenCalledOnce();
            expect(fixture.getRepository).toHaveBeenCalledExactlyOnceWith(Recorded);
            expect(fixture.retry.run).toHaveBeenCalledOnce();
            expect(fixture.findBuilder.getMany).toHaveBeenCalledOnce();
            expect(fixture.connectionCreateQueryBuilder).not.toHaveBeenCalled();
            expect(fixture.updateBuilder.update).not.toHaveBeenCalled();
            expect(fixture.updateBuilder.execute).not.toHaveBeenCalled();
        },
    );
});
