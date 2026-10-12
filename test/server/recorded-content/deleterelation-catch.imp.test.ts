import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedTagManadeModel = (
    require(join(snapshot, 'model', 'operator', 'recordedTag', 'RecordedTagManadeModel.js')) as {
        default: new (...args: unknown[]) => {
            deleteRelation(tagId: number, recordedId: number): Promise<void>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedTagManadeModel.deleteRelation reject catch (L106–109).
 * Happy deleteRelation is covered elsewhere; DB rejection logs once and rethrows.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = () => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const relationFailure = new Error('SyntheticTagDeleteRelationFailure');
    const recordedTagDB = {
        deleteRelation: vi.fn(async (_tagId: number, _recordedId: number) => {
            throw relationFailure;
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
    return { model, recordedTagDB, recordedTagEvent, relationFailure, systemLog };
};

describe('RecordedTagManadeModel.deleteRelation catch (unittest/imp)', () => {
    it('[R2-RECORDEDTAG-DELETERELATION-CATCH] deleteRelation reject logs once and rethrows identity', async () => {
        const { model, recordedTagDB, recordedTagEvent, relationFailure, systemLog } = makeSubject();

        await expect(model.deleteRelation(502, 9002)).rejects.toBe(relationFailure);

        expect(recordedTagDB.deleteRelation).toHaveBeenCalledExactlyOnceWith(502, 9002);
        expect(systemLog.error).toHaveBeenCalledWith('delete tag relation error tagId: 502 recordedId: 9002');
        expect(systemLog.error).toHaveBeenCalledTimes(1);
        expect(recordedTagEvent.emitDeletedRelation).not.toHaveBeenCalled();
    });
});
