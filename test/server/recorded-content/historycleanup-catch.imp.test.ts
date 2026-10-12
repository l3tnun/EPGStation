import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const RecordedManageModel = (
    require(join(snapshot, 'model', 'operator', 'recorded', 'RecordedManageModel.js')) as {
        default: new (...args: unknown[]) => {
            historyCleanup(): Promise<void>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real RecordedManageModel.historyCleanup delete-reject catch (L1138–1141).
 * Happy delete is already covered (RC-6.4); delete rejection only logs and resolves.
 * Object.create is forbidden — use the real constructor.
 */
const makeSubject = () => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const deleteFailure = new Error('SyntheticHistoryDeleteFailure');
    const recordedHistoryDB = {
        delete: vi.fn(async (_time: number) => {
            throw deleteFailure;
        }),
    };
    const model = new RecordedManageModel(
        { getLogger: () => ({ system: systemLog }) },
        {
            getConfig: () => ({
                dropLog: 'synthetic-drop',
                recorded: [],
                recordedHistoryRetentionPeriodDays: 7,
                thumbnail: 'synthetic-thumbnail',
            }),
        },
        { findId: vi.fn(), deleteOnce: vi.fn() },
        { findId: vi.fn(), deleteOnce: vi.fn() },
        { deleteOnce: vi.fn() },
        { deleteOnce: vi.fn() },
        recordedHistoryDB,
        { cancel: vi.fn(), hasReserve: vi.fn() },
        { emitDeleteRecorded: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
        { formatFilePathString: vi.fn() },
    );
    return { deleteFailure, model, recordedHistoryDB, systemLog };
};

describe('RecordedManageModel.historyCleanup delete catch (unittest/imp)', () => {
    it('[R2-RECORDED-HISTORYCLEANUP-CATCH] delete reject logs twice and resolves without throw', async () => {
        vi.spyOn(Date.prototype, 'getTime').mockReturnValue(2_000_000_000);
        const { deleteFailure, model, recordedHistoryDB, systemLog } = makeSubject();

        await expect(model.historyCleanup()).resolves.toBeUndefined();

        expect(recordedHistoryDB.delete).toHaveBeenCalledExactlyOnceWith(
            2_000_000_000 - 7 * 24 * 60 * 60 * 1000,
        );
        expect(systemLog.error).toHaveBeenCalledWith('failed to historyCleanup');
        expect(systemLog.error).toHaveBeenCalledWith(deleteFailure);
        expect(systemLog.error).toHaveBeenCalledTimes(2);
    });
});
