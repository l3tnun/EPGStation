import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EPGUpdateManageModel = (
    require(join(snapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as {
        default: new (...args: unknown[]) => {
            updateChannels(): Promise<void>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real EPGUpdateManageModel.updateChannels insert-reject catch (L174–178).
 * getServices resolves; channelDB.insert rejects → log pair + rethrow.
 */
const makeSubject = () => {
    const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const insertFailure = new Error('SyntheticChannelInsertFailure');
    const channelDB = {
        insert: vi.fn(async (_services: unknown) => {
            throw insertFailure;
        }),
        update: vi.fn(async () => undefined),
    };
    const tunerServerAccess = {
        getPrograms: vi.fn(async () => []),
        getServices: vi.fn(async () => [{ id: 9001, serviceId: 101 }]),
    };
    const model = new EPGUpdateManageModel(
        { getLogger: () => ({ system: systemLog }) },
        { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
        tunerServerAccess,
        channelDB,
        { deleteOld: vi.fn(), insert: vi.fn(), update: vi.fn() },
    );
    return { channelDB, insertFailure, model, systemLog, tunerServerAccess };
};

describe('EPGUpdateManageModel.updateChannels insert catch (unittest/imp)', () => {
    it('[R2-EPG-UPDATECHANNELS-INSERT-CATCH] insert reject logs twice and rethrows', async () => {
        const { channelDB, insertFailure, model, systemLog, tunerServerAccess } = makeSubject();

        await expect(model.updateChannels()).rejects.toBe(insertFailure);

        expect(tunerServerAccess.getServices).toHaveBeenCalledOnce();
        expect(channelDB.insert).toHaveBeenCalledOnce();
        expect(systemLog.error).toHaveBeenCalledWith('update channel error');
        expect(systemLog.error).toHaveBeenCalledWith(insertFailure);
        expect(systemLog.error).toHaveBeenCalledTimes(2);
    });
});
