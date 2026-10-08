import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, makeChild, makeServer } from '../_harness';

describe('IPCServer initialization and recording-deletion ports', () => {
    it('[IMP-CHAR-PM-7.2] runs the upload adoption initialization once for concurrent and later calls and shares its result', async () => {
        let finishInitialization!: () => void;
        const initialize = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishInitialization = resolve;
                }),
        );
        const { server } = makeServer({ recordedUploadAdoption: { adopt: vi.fn(), initialize } as never });

        const first = server.initialize();
        const second = server.initialize();
        expect(initialize).toHaveBeenCalledOnce();
        finishInitialization();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

        await expect(server.initialize()).resolves.toBeUndefined();
        expect(initialize).toHaveBeenCalledOnce();
    });

    it('[IMP-CHAR-PM-7.2] propagates an upload adoption initialization failure to every caller', async () => {
        const failure = new Error('synthetic upload adoption initialization failure');
        const initialize = vi.fn(async () => {
            throw failure;
        });
        const { server } = makeServer({ recordedUploadAdoption: { adopt: vi.fn(), initialize } as never });

        await expect(server.initialize()).rejects.toBe(failure);
        await expect(server.initialize()).rejects.toBe(failure);
        expect(initialize).toHaveBeenCalledOnce();
    });

    it('[IMP-CHAR-PM-7.2] cancels the active recording through the recording manager before a user deletion commits', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const token = {};
        domains.recorded.prepareUserDeletion.mockResolvedValue({
            isRecording: true,
            reserveId: 77,
            status: 'prepared',
            token,
        });
        domains.recording.hasReserve.mockReturnValue(true);
        server.register(child);

        child.emit('message', { args: { recordedId: 301 }, func: 'delete', id: 301, model: 'recorded' });
        await flushImmediate();

        expect(domains.recording.hasReserve).toHaveBeenCalledExactlyOnceWith(77);
        expect(domains.recording.cancelForDeletion).toHaveBeenCalledExactlyOnceWith(77);
        expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
        expect(domains.recording.cancelForDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        expect(child.send).toHaveBeenCalledExactlyOnceWith({ id: 301, result: undefined });
    });

    it('[IMP-CHAR-PM-7.2] cancels the active recording through the recording manager when a video-file deletion widens to the whole recorded', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const token = {};
        domains.recorded.prepareVideoFileDeletion.mockResolvedValue({
            recordedId: 302,
            status: 'whole-recorded-deletion-required',
        });
        domains.recorded.prepareUserDeletion.mockResolvedValue({
            isRecording: true,
            reserveId: 78,
            status: 'prepared',
            token,
        });
        domains.recording.hasReserve.mockReturnValue(true);
        server.register(child);

        child.emit('message', { args: { videoFileId: 9 }, func: 'deleteVideoFile', id: 302, model: 'recorded' });
        await flushImmediate();

        expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(302);
        expect(domains.recording.hasReserve).toHaveBeenCalledExactlyOnceWith(78);
        expect(domains.recording.cancelForDeletion).toHaveBeenCalledExactlyOnceWith(78);
        expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
        expect(child.send).toHaveBeenCalledExactlyOnceWith({ id: 302, result: undefined });
    });
});
