import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedTagManadeModel = (
    require(join(snapshot, 'model', 'operator', 'recordedTag', 'RecordedTagManadeModel.js')) as {
        default: new (...args: unknown[]) => {
            setRelation(tagId: number, recordedId: number): Promise<void>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedTagManadeModel.setRelation reject catch (L73–76).
 * Happy setRelation is covered elsewhere; DB rejection logs once and rethrows.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = () => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const relationFailure = new Error('SyntheticTagSetRelationFailure');
    const recordedTagDB = {
        setRelation: vi.fn(async (_tagId: number, _recordedId: number) => {
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

describe('RecordedTagManadeModel.setRelation catch (unittest/imp)', () => {
    it('[R2-RECORDEDTAG-SETRELATION-CATCH] setRelation reject logs once and rethrows identity', async () => {
        const { model, recordedTagDB, recordedTagEvent, relationFailure, systemLog } = makeSubject();

        await expect(model.setRelation(501, 9001)).rejects.toBe(relationFailure);

        expect(recordedTagDB.setRelation).toHaveBeenCalledExactlyOnceWith(501, 9001);
        expect(systemLog.error).toHaveBeenCalledWith('set tag relation error tagId: 501 recordedId: 9001');
        expect(systemLog.error).toHaveBeenCalledTimes(1);
        expect(recordedTagEvent.emitRelated).not.toHaveBeenCalled();
    });
});
