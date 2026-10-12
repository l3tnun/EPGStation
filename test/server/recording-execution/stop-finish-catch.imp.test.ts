import { afterEach, describe, expect, it, vi } from 'vitest';

import { load } from './_harness';

const DropCheckerModel = load<
    new (...args: unknown[]) => {
        dest: string | null;
        onFinish(): Promise<void>;
        stop(): Promise<void>;
        transformStream: { unpipe(): void } | null;
    }
>('model', 'operator', 'recording', 'DropCheckerModel.js');

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Real DropCheckerModel.stop onFinish reject catch (L364–367).
 * Happy stop/finish paths are covered elsewhere; finish rejection only logs and continues teardown.
 * Object.create is forbidden — use the real constructor; reassign instance onFinish only.
 */
describe('DropCheckerModel.stop onFinish catch (unittest/imp)', () => {
    it('[R2-DROPCHECKER-STOP-FINISH-CATCH] onFinish reject logs pair, resolves, and continues teardown', async () => {
        const systemLog = { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() };
        const finishFailure = new Error('SyntheticOnFinishFailure');
        const checker = new DropCheckerModel({ getLogger: () => ({ system: systemLog }) });
        checker.dest = 'synthetic-drop-dest.log';
        const unpipe = vi.fn();
        checker.transformStream = { unpipe };
        checker.onFinish = vi.fn(async () => {
            throw finishFailure;
        });

        await expect(checker.stop()).resolves.toBeUndefined();

        expect(checker.onFinish).toHaveBeenCalledOnce();
        expect(systemLog.error).toHaveBeenCalledWith('finish drop check error: synthetic-drop-dest.log');
        expect(systemLog.error).toHaveBeenCalledWith(finishFailure);
        expect(systemLog.error).toHaveBeenCalledTimes(2);
        expect(unpipe).toHaveBeenCalledOnce();
        expect(checker.transformStream).toBeNull();
    });
});
