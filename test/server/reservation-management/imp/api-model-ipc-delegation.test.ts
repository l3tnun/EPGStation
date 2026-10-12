import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import { ReserveApiModel } from '../_harness';

describe('ReserveApiModel IPC thin delegation', () => {
    it('[RM-IMP-API-IPC-DELEGATION] add, edit, cancel, removeSkip, removeOverlap, and updateAll each delegate to the injected ipc.reserveation client exactly once with the given arguments and propagate the result', async () => {
        const rejection = new Error('synthetic-cancel-rejection');
        const ipc = {
            reserveation: {
                add: vi.fn().mockResolvedValue(41),
                edit: vi.fn().mockResolvedValue(undefined),
                cancel: vi.fn().mockRejectedValue(rejection),
                removeSkip: vi.fn().mockResolvedValue(undefined),
                removeOverlap: vi.fn().mockResolvedValue(undefined),
                updateAll: vi.fn().mockResolvedValue(undefined),
            },
        };
        const api = new ReserveApiModel(ipc, {});
        const addOption = { allowEndLack: true, isTimeSpecified: false };
        const editOption = { allowEndLack: false };

        await expect(api.add(addOption)).resolves.toBe(41);
        await expect(api.edit(11, editOption)).resolves.toBeUndefined();
        await expect(api.cancel(11)).rejects.toBe(rejection);
        await expect(api.removeSkip(12)).resolves.toBeUndefined();
        await expect(api.removeOverlap(13)).resolves.toBeUndefined();
        await expect(api.updateAll()).resolves.toBeUndefined();

        expect(ipc.reserveation.add).toHaveBeenCalledExactlyOnceWith(addOption);
        expect(ipc.reserveation.edit).toHaveBeenCalledExactlyOnceWith(11, editOption);
        expect(ipc.reserveation.cancel).toHaveBeenCalledExactlyOnceWith(11);
        expect(ipc.reserveation.removeSkip).toHaveBeenCalledExactlyOnceWith(12);
        expect(ipc.reserveation.removeOverlap).toHaveBeenCalledExactlyOnceWith(13);
        // production hardcodes updateAll(false); do not pass true through the thin API
        expect(ipc.reserveation.updateAll).toHaveBeenCalledExactlyOnceWith(false);
    });
});
