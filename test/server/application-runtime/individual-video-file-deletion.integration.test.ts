import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeContainer, createSyntheticChild } from './_runtime-harness';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('individual video file deletion Runtime composition', () => {
    it(
        '[AR-4.3] direct-or-fresh-whole-delete routes a prepared video file to the direct provider path and a ' +
            'whole-recorded-deletion-required preparation to the fresh whole coordinator, each exactly once and ' +
            'reaching the same provider ports',
        async () => {
            const container = buildRuntimeContainer();
            const ledger: string[] = [];
            const directToken = Object.freeze({ videoFileId: 91 });
            const wholeUserToken = Object.freeze({ recordedId: 99 });
            const recordedManage = {
                deletePrepared: vi.fn(async (suppliedToken: object) => {
                    expect(suppliedToken).toBe(wholeUserToken);
                    ledger.push('deletePrepared:99');
                }),
                deletePreparedVideoFile: vi.fn(async (suppliedToken: object) => {
                    expect(suppliedToken).toBe(directToken);
                    ledger.push('deletePreparedVideoFile:91');
                    return { status: 'video-file-deleted' as const };
                }),
                prepareUserDeletion: vi.fn(async (recordedId: number) => {
                    ledger.push(`prepareUserDeletion:${recordedId}`);
                    return { isRecording: false, reserveId: null, status: 'prepared' as const, token: wholeUserToken };
                }),
                prepareVideoFileDeletion: vi.fn(async (videoFileId: number) => {
                    ledger.push(`prepareVideoFileDeletion:${videoFileId}`);
                    if (videoFileId === 91) return { status: 'prepared' as const, token: directToken };
                    return { recordedId: 99, status: 'whole-recorded-deletion-required' as const };
                }),
            };
            const recordingManage = {
                cancelForDeletion: vi.fn(async (reserveId: number) => {
                    ledger.push(`cancelForDeletion:${reserveId}`);
                }),
                hasReserve: vi.fn((_reserveId: number) => {
                    ledger.push('hasReserve');
                    return false;
                }),
            };
            container.rebind('IRecordedManageModel').toConstantValue(recordedManage);
            container.rebind('IRecordingManageModel').toConstantValue(recordingManage);

            const ipcServer = container.get<{ register(child: unknown): void }>('IIPCServer');
            expect(container.get('IIPCServer')).toBe(ipcServer);

            const child = createSyntheticChild(9_101);
            ipcServer.register(child);
            ipcServer.register(child);
            expect(child.listenerCount('message')).toBe(1);

            // direct path: a prepared video file is deleted through the provider directly, without touching the
            // fresh whole-recorded-deletion coordinator.
            child.emit('message', { args: { videoFileId: 91 }, func: 'deleteVideoFile', id: 601, model: 'recorded' });
            await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(1), { interval: 0 });

            expect(ledger).toEqual(['prepareVideoFileDeletion:91', 'deletePreparedVideoFile:91']);
            expect(recordedManage.prepareUserDeletion).not.toHaveBeenCalled();
            expect(recordedManage.deletePrepared).not.toHaveBeenCalled();
            expect(child.send.mock.calls[0]?.[0]).toMatchObject({ id: 601 });

            // fresh-whole path: a whole-recorded-deletion-required preparation routes through the fresh,
            // internally-constructed ParentUserDeletionCoordinator, reaching the same provider ports exactly once.
            child.emit('message', { args: { videoFileId: 92 }, func: 'deleteVideoFile', id: 602, model: 'recorded' });
            await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(2), { interval: 0 });

            expect(ledger).toEqual([
                'prepareVideoFileDeletion:91',
                'deletePreparedVideoFile:91',
                'prepareVideoFileDeletion:92',
                'prepareUserDeletion:99',
                'deletePrepared:99',
            ]);
            expect(recordedManage.prepareVideoFileDeletion).toHaveBeenCalledTimes(2);
            expect(recordedManage.deletePreparedVideoFile).toHaveBeenCalledOnce();
            expect(recordedManage.prepareUserDeletion).toHaveBeenCalledOnce();
            expect(recordedManage.prepareUserDeletion).toHaveBeenCalledWith(99);
            expect(recordedManage.deletePrepared).toHaveBeenCalledOnce();
            expect(recordingManage.hasReserve).not.toHaveBeenCalled();
            expect(child.send.mock.calls[1]?.[0]).toMatchObject({ id: 602 });

            // Releasing the peer must leave zero residual message-dispatch listeners on the synthetic transport
            // (no leaked binding of the parent handler adapter's own request channel).
            ipcServer.register(createSyntheticChild(9_102));
            expect(child.listenerCount('message')).toBe(0);
        },
    );
});
