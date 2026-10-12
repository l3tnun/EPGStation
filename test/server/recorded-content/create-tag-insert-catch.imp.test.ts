import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedTagManadeModel = (
    require(join(snapshot, 'model', 'operator', 'recordedTag', 'RecordedTagManadeModel.js')) as {
        default: new (...args: unknown[]) => {
            create(name: string, color: string): Promise<number>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedTagManadeModel.create insert-reject catch (L38–41).
 * Happy create is covered elsewhere; insert rejection logs once and rethrows.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = () => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const insertFailure = new Error('SyntheticTagInsertFailure');
    const recordedTagDB = {
        insertOnce: vi.fn(async (_tag: unknown) => {
            throw insertFailure;
        }),
    };
    const recordedTagEvent = {
        emitCreated: vi.fn(),
        emitDeleted: vi.fn(),
        emitDeletedRelation: vi.fn(),
        emitRelated: vi.fn(),
        emitUpdated: vi.fn(),
    };
    const model = new RecordedTagManadeModel(
        { getLogger: () => ({ system: systemLog }) },
        recordedTagDB,
        recordedTagEvent,
    );
    return { insertFailure, model, recordedTagDB, recordedTagEvent, systemLog };
};

describe('RecordedTagManadeModel.create insert catch (unittest/imp)', () => {
    it('[R2-RECORDEDTAG-CREATE-INSERT-CATCH] insert reject logs once and rethrows identity', async () => {
        const { insertFailure, model, recordedTagDB, recordedTagEvent, systemLog } = makeSubject();

        await expect(model.create('synthetic-tag', '#00ff00')).rejects.toBe(insertFailure);

        expect(recordedTagDB.insertOnce).toHaveBeenCalledOnce();
        expect(systemLog.error).toHaveBeenCalledWith('create tag error: synthetic-tag');
        expect(systemLog.error).toHaveBeenCalledTimes(1);
        expect(recordedTagEvent.emitCreated).not.toHaveBeenCalled();
    });
});
