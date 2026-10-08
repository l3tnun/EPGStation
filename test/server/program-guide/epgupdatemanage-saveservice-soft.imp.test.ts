import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EPGUpdateManageModel = (
    require(join(snapshot, 'model', 'epgUpdater', 'EPGUpdateManageModel.js')) as {
        default: new (...args: unknown[]) => {
            saveService(): Promise<void>;
            serviceQueue: Array<{ resource: string; type: string; data: Record<string, unknown> }>;
        };
    }
).default;

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * residual-4201 G1: EPGUpdateManageModel.saveService soft residual.
 * - empty serviceQueue → early return L394–396 (no tuner fetch / no channelDB update)
 * - queued service in excludeChannelIndex or excludeSidIndex → continue L416–419 (no create/update)
 * Real EPGUpdateManageModel; tuner/DB seams stubbed only.
 */
describe('EPGUpdateManageModel.saveService soft residual (unittest/imp)', () => {
    it('[R2-EPG-SAVESERVICE-SOFT] empty queue returns early; excluded service skips create/update', async () => {
        const getServices = vi.fn(async () => []);
        const channelUpdate = vi.fn(async () => undefined);
        const systemLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

        const emptyModel = new EPGUpdateManageModel(
            { getLogger: () => ({ system: systemLog }) },
            { getConfig: () => ({ mirakurunPath: 'http://program-guide.invalid/' }) },
            { getServices, getPrograms: vi.fn(async () => []) },
            { insert: vi.fn(async () => undefined), update: channelUpdate },
            { deleteOld: vi.fn(), insert: vi.fn(), update: vi.fn() },
        );

        await expect(emptyModel.saveService()).resolves.toBeUndefined();
        expect(getServices).not.toHaveBeenCalled();
        expect(channelUpdate).not.toHaveBeenCalled();

        const excludeGetServices = vi.fn(async () => []);
        const excludeChannelUpdate = vi.fn(async () => undefined);
        const excludedChannelId = 9001;
        const excludeModel = new EPGUpdateManageModel(
            { getLogger: () => ({ system: systemLog }) },
            {
                getConfig: () => ({
                    mirakurunPath: 'http://program-guide.invalid/',
                    excludeChannels: [excludedChannelId],
                }),
            },
            { getServices: excludeGetServices, getPrograms: vi.fn(async () => []) },
            { insert: vi.fn(async () => undefined), update: excludeChannelUpdate },
            { deleteOld: vi.fn(), insert: vi.fn(), update: vi.fn() },
        );
        excludeModel.serviceQueue.push({
            resource: 'service',
            type: 'create',
            data: {
                id: excludedChannelId,
                serviceId: 100 + excludedChannelId,
                networkId: 10,
                name: 'synthetic-excluded-channel',
                channel: { type: 'GR', channel: `${excludedChannelId}` },
            },
        });

        await expect(excludeModel.saveService()).resolves.toBeUndefined();
        expect(excludeGetServices).toHaveBeenCalledOnce();
        expect(excludeChannelUpdate).toHaveBeenCalledExactlyOnceWith({ insert: [], update: [] });
        expect(excludeModel.serviceQueue).toEqual([]);
    });
});
