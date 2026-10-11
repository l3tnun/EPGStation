import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdater = (require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdater.js')) as any).default;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } });

let restoreProcessSend: (() => void) | undefined;
const stubProcessSend = (): ReturnType<typeof vi.fn> => {
    const send = vi.fn(() => true);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
    Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });
    restoreProcessSend = () => {
        if (descriptor === undefined) {
            delete process.send;
        } else {
            Object.defineProperty(process, 'send', descriptor);
        }
    };
    return send;
};

afterEach(() => {
    restoreProcessSend?.();
    restoreProcessSend = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('program guide update without a live event stream', () => {
    it('[PG-MC-lifecycle] reports a completed full update to the parent when the fallback update runs', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const send = stubProcessSend();
        const updateManage = Object.assign(new EventEmitter(), {
            deleteOldPrograms: vi.fn(async () => undefined),
            updateAll: vi.fn(async () => undefined),
        });
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.isEventStreamAlive = false;
        updater.lastUpdatedTime = 0;
        updater.lastDeletedTime = 100_000;

        await updater.updatePeriodically();

        expect(updateManage.updateAll).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledExactlyOnceWith({ msg: 'updated' });
    });

    it('[PG-MC-lifecycle] does not report to the parent while the fallback update is not yet due', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const send = stubProcessSend();
        const updateManage = Object.assign(new EventEmitter(), {
            deleteOldPrograms: vi.fn(async () => undefined),
            updateAll: vi.fn(async () => undefined),
        });
        const updater = new EPGUpdater(
            { getLogger: logger },
            { getConfig: () => ({ epgUpdateIntervalTime: 1 }) },
            updateManage,
        ) as any;
        updater.isEventStreamAlive = false;
        updater.lastUpdatedTime = 50_000;
        updater.lastDeletedTime = 100_000;

        await updater.updatePeriodically();

        expect(updateManage.updateAll).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });
});
