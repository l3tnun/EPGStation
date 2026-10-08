import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushImmediate, flushNextTick, makeChild, makeClient, makeServer } from './_harness';
import { domainHandlerSpies, operationCases, operationKey, type OperationCase } from './operation-fixtures';

const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;
const canonicalUploadedVideoOption = {
    filePath: 'incoming/task-5-3/upload.ts',
    name: 'synthetic-upload-option',
};

const expectOnlyHandlerCalled = (
    domains: Record<string, Record<string, unknown>>,
    expected: any,
    operationName?: string,
): void => {
    const handlers = domainHandlerSpies(domains);
    expect(
        handlers.reduce((count, handler) => count + handler.mock.calls.length, 0),
        operationName,
    ).toBe(1);
    for (const handler of handlers) expect(handler).toHaveBeenCalledTimes(handler === expected ? 1 : 0);
};

const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

const expectClientRequestResourcesReleased = (client: any): void => {
    expect(client.pending.size).toBe(0);
    expect(client.retired.size).toBe(0);
    expect(client.leased.size).toBe(0);
    expect(client.allocationWaiters).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
};

const expectPeerReleased = (server: any, child: ReturnType<typeof makeChild>): void => {
    child.emit('disconnect');
    expect(server.child).toBeNull();
    expect(server.currentPeer).toBeNull();
    expect(child.listenerCount('message')).toBe(0);
    for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(0);
};

const selectCanonicalOperations = (...keys: readonly string[]): readonly OperationCase[] =>
    keys.map(key => {
        const matches = operationCases.filter(operation => operationKey(operation) === key);
        expect(matches, `canonical operation ${key}`).toHaveLength(1);
        if (key !== 'recorded.addUploadedVideoFile') return matches[0];
        return {
            ...matches[0],
            args: { option: canonicalUploadedVideoOption },
            handlerArgs: [canonicalUploadedVideoOption],
            invoke: client => client.recorded.addUploadedVideoFile(canonicalUploadedVideoOption),
        };
    });

const exerciseCanonicalOperation = async (operation: OperationCase, shouldFail: boolean): Promise<void> => {
    vi.useFakeTimers();
    const baselineMessageListeners = process.listenerCount('message');
    const clientHarness = makeClient();
    try {
        let settlements = 0;
        const pending = operation.invoke(clientHarness.client);
        const outcome = pending.then(
            value => {
                settlements += 1;
                return { status: 'fulfilled' as const, value };
            },
            (error: Error) => {
                settlements += 1;
                return { error, status: 'rejected' as const };
            },
        );
        await flushNextTick();

        expect(clientHarness.send).toHaveBeenCalledOnce();
        const request = clientHarness.send.mock.calls[0][0];
        expect(request).toEqual({
            args: operation.args,
            func: operation.func,
            id: expect.any(Number),
            model: operation.model,
        });
        expect(Number.isSafeInteger(request.id)).toBe(true);
        expect(request.id).toBeGreaterThan(0);
        expect(clientHarness.client.pending).toHaveLength(1);

        const recordedUploadAdoption = { adopt: vi.fn(async (filePath: string) => filePath) };
        const { domains, server } = makeServer({ recordedUploadAdoption });
        const child = makeChild();
        const handler = (domains as any)[operation.domain][operation.func];
        const failure = new Error(`synthetic-${operation.func}`);
        const operationName = operationKey(operation);
        const isRecordedDeletion = isRecordedDeletionOperation(operation);
        const isVideoFileDeletion = isVideoFileDeletionOperation(operation);
        const deletionPreparation = { isRecording: false, reserveId: null, status: 'prepared' as const, token: {} };
        const videoDeletionPreparation = { status: 'prepared' as const, token: {} };
        if (isRecordedDeletion) {
            domains.recorded.prepareUserDeletion.mockResolvedValue(deletionPreparation);
            if (shouldFail) domains.recorded.deletePrepared.mockRejectedValue(failure);
            else domains.recorded.deletePrepared.mockResolvedValue(undefined);
        } else if (isVideoFileDeletion) {
            domains.recorded.prepareVideoFileDeletion.mockResolvedValue(videoDeletionPreparation);
            if (shouldFail) domains.recorded.deletePreparedVideoFile.mockRejectedValue(failure);
            else domains.recorded.deletePreparedVideoFile.mockResolvedValue({ status: 'video-file-deleted' });
        } else if (shouldFail && ['recording.resetTimer', 'thumbnail.add'].includes(operationName)) {
            handler.mockImplementation(() => {
                throw failure;
            });
        } else if (shouldFail) handler.mockRejectedValue(failure);
        else handler.mockResolvedValue(operation.result);
        server.register(child);
        expect(child.listenerCount('message')).toBe(1);
        for (const event of terminalEvents) expect(child.listenerCount(event)).toBe(1);

        child.emit('message', request);
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);

        if (isRecordedDeletion) {
            expect(domains.recorded).not.toHaveProperty('delete');
            expect(domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(operation.handlerArgs[0]);
            expect(domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(deletionPreparation.token);
            expect(domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
                domains.recorded.deletePrepared.mock.invocationCallOrder[0],
            );
            for (const domainHandler of domainHandlerSpies(domains)) expect(domainHandler).not.toHaveBeenCalled();
        } else if (isVideoFileDeletion) {
            expect(handler).not.toHaveBeenCalled();
            expect(domains.recorded.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(operation.handlerArgs[0]);
            expect(domains.recorded.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(
                videoDeletionPreparation.token,
            );
            expect(domains.recorded.prepareVideoFileDeletion.mock.invocationCallOrder[0]).toBeLessThan(
                domains.recorded.deletePreparedVideoFile.mock.invocationCallOrder[0],
            );
            expect(domains.recorded.prepareUserDeletion).not.toHaveBeenCalled();
            expect(domains.recorded.deletePrepared).not.toHaveBeenCalled();
            expect(domains.recording.hasReserve).not.toHaveBeenCalled();
            expect(domains.recording.cancelForDeletion).not.toHaveBeenCalled();
            for (const domainHandler of domainHandlerSpies(domains)) expect(domainHandler).not.toHaveBeenCalled();
        } else expectOnlyHandlerCalled(domains, handler, operationName);
        if (operationName === 'recorded.addUploadedVideoFile') {
            expect(recordedUploadAdoption.adopt).toHaveBeenCalledExactlyOnceWith(canonicalUploadedVideoOption.filePath);
        } else expect(recordedUploadAdoption.adopt).not.toHaveBeenCalled();
        if (!isRecordedDeletion && !isVideoFileDeletion) expect(handler).toHaveBeenCalledWith(...operation.handlerArgs);
        const finalReply = shouldFail
            ? { error: failure.message, id: request.id }
            : { id: request.id, result: operation.result };
        const replies =
            operationName === 'recorded.addUploadedVideoFile'
                ? [{ id: request.id, type: 'uploadedVideoAdopted' }, finalReply]
                : [finalReply];
        expect(child.send, operationName).toHaveBeenCalledTimes(replies.length);
        expect(child.send.mock.calls.map(([message]) => message)).toEqual(replies);

        for (const reply of replies) await clientHarness.receive(reply);
        const terminal = await outcome;
        if (shouldFail) {
            expect(terminal).toEqual({
                error: expect.objectContaining({ message: failure.message }),
                status: 'rejected',
            });
        } else {
            expect(terminal).toEqual({ status: 'fulfilled', value: operation.result });
        }
        expect(settlements).toBe(1);
        expectClientRequestResourcesReleased(clientHarness.client);
        expectPeerReleased(server, child);
    } finally {
        clientHarness.cleanup();
        vi.useRealTimers();
        expect(process.listenerCount('message')).toBe(baselineMessageListeners);
    }
};

const exerciseCanonicalOperations = async (operations: readonly OperationCase[]): Promise<void> => {
    for (const operation of operations) {
        await exerciseCanonicalOperation(operation, false);
        await exerciseCanonicalOperation(operation, true);
    }
};

const isUploadAdoptionOperation = (operation: { func: string; model: string }): boolean =>
    operation.model === 'recorded' && operation.func === 'addUploadedVideoFile';

const isRecordedDeletionOperation = (operation: { func: string; model: string }): boolean =>
    operation.model === 'recorded' && operation.func === 'delete';

const isVideoFileDeletionOperation = (operation: { func: string; model: string }): boolean =>
    operation.model === 'recorded' && operation.func === 'deleteVideoFile';

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('SPEC-OPS client request envelopes', () => {
    it.each(operationCases)('$model.$func sends numeric id and exact model/func/args', async operation => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const harness = makeClient();
        try {
            const pending = operation.invoke(harness.client);
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledOnce();
            const message = harness.send.mock.calls[0][0];
            expect(message).toEqual({
                args: operation.args,
                func: operation.func,
                id: expect.any(Number),
                model: operation.model,
            });
            expect(Number.isFinite(message.id)).toBe(true);
            await harness.receive({ id: message.id, result: operation.result });
            await expect(pending).resolves.toEqual(operation.result);
        } finally {
            harness.cleanup();
        }
    });

    it('reserveation.clean sends a numeric id with no args even though no server dispatcher handles it', async () => {
        // `reserveation.clean` is deliberately excluded from `operationCases` (see the fixed
        // dispatcher table test below): the server-side handler was never implemented, so this
        // client method is never invoked by any of this suite's other end-to-end cases. It still
        // exists on the client's public surface, so its own message-construction contract is
        // exercised directly here rather than through the (nonexistent) server round trip.
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const harness = makeClient();
        try {
            const pending = harness.client.reserveation.clean();
            await flushNextTick();
            expect(harness.send).toHaveBeenCalledOnce();
            const message = harness.send.mock.calls[0][0];
            expect(message).toEqual({ func: 'clean', id: expect.any(Number), model: 'reserveation' });

            await harness.receive({ id: message.id, error: 'IPCFunctionError' });
            await expect(pending).rejects.toThrow('IPCFunctionError');
        } finally {
            harness.cleanup();
        }
    });
});

describe('SPEC-OPS parent dispatcher and replies', () => {
    it('matches the approved fixed dispatcher table exactly and excludes reserveation.clean', () => {
        const { server } = makeServer();
        const actual = Object.entries(server.functions)
            .flatMap(([model, functions]: [string, any]) => Object.keys(functions).map(func => `${model}.${func}`))
            .sort();
        expect(operationCases).toHaveLength(34);
        expect(actual).toEqual(operationCases.map(operationKey).sort());
        expect(actual).not.toContain('reserveation.clean');
    });

    it.each(
        operationCases.filter(
            operation =>
                !isUploadAdoptionOperation(operation) &&
                !isRecordedDeletionOperation(operation) &&
                !isVideoFileDeletionOperation(operation),
        ),
    )('$model.$func invokes one exact domain port and returns the same-id result', async operation => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const handler = (domains as any)[operation.domain][operation.func];
        handler.mockResolvedValue(operation.result);
        server.register(child);

        child.emit('message', {
            args: operation.args,
            func: operation.func,
            id: 201,
            model: operation.model,
        });
        await flushImmediate();

        expectOnlyHandlerCalled(domains, handler);
        expect(handler).toHaveBeenCalledWith(...operation.handlerArgs);
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ id: 201, result: operation.result });
    });

    it.each(
        operationCases.filter(
            operation =>
                !isUploadAdoptionOperation(operation) &&
                !isRecordedDeletionOperation(operation) &&
                !isVideoFileDeletionOperation(operation),
        ),
    )('$model.$func returns the exact domain error with the same id', async operation => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const handler = (domains as any)[operation.domain][operation.func];
        const isVoidHandler =
            operationKey(operation) === 'recording.resetTimer' ||
            operationKey(operation) === 'thumbnail.add' ||
            operationKey(operation) === 'encodeEvent.emitFinishEncode';
        if (isVoidHandler) {
            handler.mockImplementation(() => {
                throw new Error(`synthetic-${operation.func}`);
            });
        } else {
            handler.mockRejectedValue(new Error(`synthetic-${operation.func}`));
        }
        server.register(child);

        child.emit('message', {
            args: operation.args,
            func: operation.func,
            id: 202,
            model: operation.model,
        });
        await flushImmediate();

        expectOnlyHandlerCalled(domains, handler);
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ error: `synthetic-${operation.func}`, id: 202 });
    });

    it('routes recorded deletion through preparation and prepared deletion with the same-id success or failure', async () => {
        const success = makeServer();
        const successChild = makeChild();
        const successPreparation = { isRecording: false, reserveId: null, status: 'prepared' as const, token: {} };
        success.domains.recorded.prepareUserDeletion.mockResolvedValue(successPreparation);
        success.server.register(successChild);
        successChild.emit('message', { args: { recordedId: 211 }, func: 'delete', id: 211, model: 'recorded' });
        await flushImmediate();

        expect(success.domains.recorded).not.toHaveProperty('delete');
        expect(success.domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(211);
        expect(success.domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(successPreparation.token);
        expect(success.domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            success.domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        for (const handler of domainHandlerSpies(success.domains)) expect(handler).not.toHaveBeenCalled();
        expect(successChild.send).toHaveBeenCalledExactlyOnceWith({ id: 211, result: undefined });

        const failure = makeServer();
        const failureChild = makeChild();
        const failurePreparation = { isRecording: false, reserveId: null, status: 'prepared' as const, token: {} };
        const deletionFailure = new Error('synthetic-prepared-delete-error');
        failure.domains.recorded.prepareUserDeletion.mockResolvedValue(failurePreparation);
        failure.domains.recorded.deletePrepared.mockRejectedValue(deletionFailure);
        failure.server.register(failureChild);
        failureChild.emit('message', { args: { recordedId: 212 }, func: 'delete', id: 212, model: 'recorded' });
        await flushImmediate();

        expect(failure.domains.recorded.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(212);
        expect(failure.domains.recorded.deletePrepared).toHaveBeenCalledExactlyOnceWith(failurePreparation.token);
        expect(failure.domains.recorded.prepareUserDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            failure.domains.recorded.deletePrepared.mock.invocationCallOrder[0],
        );
        for (const handler of domainHandlerSpies(failure.domains)) expect(handler).not.toHaveBeenCalled();
        expect(failureChild.send).toHaveBeenCalledExactlyOnceWith({ error: deletionFailure.message, id: 212 });
    });

    it('routes video-file deletion through prepared video deletion with the unchanged wire and same-id success or failure', async () => {
        const success = makeServer();
        const successChild = makeChild();
        const successPreparation = { status: 'prepared' as const, token: {} };
        success.domains.recorded.prepareVideoFileDeletion.mockResolvedValue(successPreparation);
        success.domains.recorded.deletePreparedVideoFile.mockResolvedValue({ status: 'video-file-deleted' });
        success.server.register(successChild);
        successChild.emit('message', {
            args: { videoFileId: 213 },
            func: 'deleteVideoFile',
            id: 213,
            model: 'recorded',
        });
        await flushImmediate();

        expect(success.domains.recorded.deleteVideoFile).not.toHaveBeenCalled();
        expect(success.domains.recorded.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(213);
        expect(success.domains.recorded.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(
            successPreparation.token,
        );
        expect(success.domains.recorded.prepareVideoFileDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            success.domains.recorded.deletePreparedVideoFile.mock.invocationCallOrder[0],
        );
        expect(success.domains.recorded.prepareUserDeletion).not.toHaveBeenCalled();
        expect(success.domains.recorded.deletePrepared).not.toHaveBeenCalled();
        expect(success.domains.recording.hasReserve).not.toHaveBeenCalled();
        expect(success.domains.recording.cancelForDeletion).not.toHaveBeenCalled();
        expect(successChild.send).toHaveBeenCalledExactlyOnceWith({ id: 213, result: undefined });

        const failure = makeServer();
        const failureChild = makeChild();
        const failurePreparation = { status: 'prepared' as const, token: {} };
        const deletionFailure = new Error('synthetic-prepared-video-delete-error');
        failure.domains.recorded.prepareVideoFileDeletion.mockResolvedValue(failurePreparation);
        failure.domains.recorded.deletePreparedVideoFile.mockRejectedValue(deletionFailure);
        failure.server.register(failureChild);
        failureChild.emit('message', {
            args: { videoFileId: 214 },
            func: 'deleteVideoFile',
            id: 214,
            model: 'recorded',
        });
        await flushImmediate();

        expect(failure.domains.recorded.deleteVideoFile).not.toHaveBeenCalled();
        expect(failure.domains.recorded.prepareVideoFileDeletion).toHaveBeenCalledExactlyOnceWith(214);
        expect(failure.domains.recorded.deletePreparedVideoFile).toHaveBeenCalledExactlyOnceWith(
            failurePreparation.token,
        );
        expect(failure.domains.recorded.prepareVideoFileDeletion.mock.invocationCallOrder[0]).toBeLessThan(
            failure.domains.recorded.deletePreparedVideoFile.mock.invocationCallOrder[0],
        );
        expect(failure.domains.recorded.prepareUserDeletion).not.toHaveBeenCalled();
        expect(failure.domains.recorded.deletePrepared).not.toHaveBeenCalled();
        expect(failure.domains.recording.hasReserve).not.toHaveBeenCalled();
        expect(failure.domains.recording.cancelForDeletion).not.toHaveBeenCalled();
        expect(failureChild.send).toHaveBeenCalledExactlyOnceWith({ error: deletionFailure.message, id: 214 });
    });
});

describe('SPEC-OPS canonical R1 acceptance cases', () => {
    it('[PM-1.1] carries the broadcast status request and its owner result or error to one terminal Promise', async () => {
        await exerciseCanonicalOperations(selectCanonicalOperations('reserveation.getBroadcastStatus'));
    });

    it('[PM-1.2] carries every reservation mutation with exact arguments and a terminal carrier reply', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations(
                'reserveation.add',
                'reserveation.update',
                'reserveation.updateRule',
                'reserveation.updateAll',
                'reserveation.cancel',
                'reserveation.removeSkip',
                'reserveation.removeOverlap',
                'reserveation.edit',
            ),
        );
    });

    it('[PM-1.3] carries every recorded mutation with exact arguments and a terminal carrier reply', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations(
                'recorded.delete',
                'recorded.updateVideoFileSize',
                'recorded.addVideoFile',
                'recorded.addUploadedVideoFile',
                'recorded.createNewRecorded',
                'recorded.deleteVideoFile',
                'recorded.changeProtect',
                'recorded.videoFileCleanup',
                'recorded.dropLogFileCleanup',
            ),
        );
    });

    it('[PM-1.4] carries every recorded-tag mutation with exact arguments and a terminal carrier reply', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations(
                'recordedTag.create',
                'recordedTag.update',
                'recordedTag.setRelation',
                'recordedTag.deleteRelation',
                'recordedTag.delete',
            ),
        );
    });

    it('[PM-1.5] carries every rule mutation with exact arguments and a terminal carrier reply', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations('rule.add', 'rule.update', 'rule.enable', 'rule.disable', 'rule.delete'),
        );
    });

    it('[PM-1.6] carries every thumbnail mutation with exact arguments and a terminal carrier reply', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations(
                'thumbnail.regenerate',
                'thumbnail.fileCleanup',
                'thumbnail.add',
                'thumbnail.delete',
            ),
        );
    });

    it('[PM-1.7] carries recording refresh and encode completion through their exact production ports', async () => {
        await exerciseCanonicalOperations(
            selectCanonicalOperations('recording.resetTimer', 'encodeEvent.emitFinishEncode'),
        );
    });

    it('[PM-1.8] preserves the owner decision without adding a business schema or changing its result', async () => {
        const { domains, server } = makeServer();
        const child = makeChild();
        const option = { ownerSpecificValue: 'accepted-by-owner' };
        domains.reservation.add.mockResolvedValue(901);
        server.register(child);

        child.emit('message', { args: { option }, func: 'add', id: 221, model: 'reserveation' });
        await flushImmediate();
        expect(domains.reservation.add).toHaveBeenCalledExactlyOnceWith(option);
        expect(child.send).toHaveBeenNthCalledWith(1, { id: 221, result: 901 });

        const failure = new Error('owner-specific-rejection');
        domains.reservation.add.mockRejectedValueOnce(failure);
        child.emit('message', { args: { option }, func: 'add', id: 222, model: 'reserveation' });
        await flushImmediate();
        expect(domains.reservation.add).toHaveBeenCalledTimes(2);
        expect(child.send).toHaveBeenNthCalledWith(2, { error: failure.message, id: 222 });
        expect(server.functions.reserveation).not.toHaveProperty('clean');
        expectPeerReleased(server, child);
    });
});

describe('SPEC-UPLOAD-ADOPTION parent carrier', () => {
    const incomingPath = 'incoming/synthetic-token/payload';
    const adoptedPath = 'adopted/synthetic-token/payload';
    const uploadOption = {
        fileName: 'synthetic.ts',
        filePath: incomingPath,
        fileType: 'ts',
        parentDirectoryName: 'synthetic-storage',
        recordedId: 701,
        viewName: 'Synthetic upload',
    };

    it('exposes one adopted disposition while retaining the existing registration reply as completion', async () => {
        const harness = makeClient();
        try {
            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            await flushNextTick();

            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0]).toEqual({
                args: { option: uploadOption },
                func: 'addUploadedVideoFile',
                id: 1,
                model: 'recorded',
            });

            await harness.receive({ id: 1, type: 'uploadedVideoAdopted' });
            const disposition = await attempt.disposition;
            expect(disposition.kind).toBe('adopted');
            if (disposition.kind !== 'adopted') throw new Error('ExpectedAdoptedDisposition');

            let completionSettled = false;
            void disposition.completion.then(() => {
                completionSettled = true;
            });
            await Promise.resolve();
            expect(completionSettled).toBe(false);

            await harness.receive({ id: 1, result: undefined });
            await expect(disposition.completion).resolves.toBeUndefined();
            expect(harness.send).toHaveBeenCalledOnce();
        } finally {
            harness.cleanup();
        }
    });

    it('reports confirmed-not-sent only when the child transport is unavailable', async () => {
        vi.useFakeTimers();
        const messageListenerBaseline = process.listenerCount('message');
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient();
        try {
            delete process.send;
            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            await flushNextTick();

            await expect(attempt.disposition).resolves.toMatchObject({
                error: { message: 'process.send is undefined' },
                kind: 'confirmed-not-sent',
            });
            expect(harness.send).not.toHaveBeenCalled();
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
            expect(process.listenerCount('message')).toBe(messageListenerBaseline);
        }
    });

    it('rejects the port disposition and releases its request when the parent replies with an error before adoption', async () => {
        vi.useFakeTimers();
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient();
        try {
            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            await flushNextTick();

            await harness.receive({ error: 'synthetic parent rejection', id: 1 });

            await expect(attempt.disposition).rejects.toThrow('synthetic parent rejection');
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.client.pending.size).toBe(0);
            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
        }
    });

    it('keeps an ordinary correlated error independent of the upload registration disposition', async () => {
        vi.useFakeTimers();
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient();
        try {
            const pending = harness.client.recorded.delete(701);
            let rejection: Error | undefined;
            void pending.catch((error: Error) => {
                rejection = error;
            });
            await flushNextTick();

            await harness.receive({ error: 'synthetic ordinary rejection', id: 1 });

            await Promise.resolve();
            expect(rejection?.message).toBe('synthetic ordinary rejection');
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
        }
    });

    it('resumes one allocation-waiting registration once and clears its waiter, pending request, and timer after acknowledgement and reply', async () => {
        vi.useFakeTimers();
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient({ max: 1, successor: () => 1 });
        try {
            const occupied = harness.client.recorded.delete(701);
            await flushNextTick();
            expect(harness.client.pending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);
            harness.send.mockClear();

            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            expect(harness.client.allocationWaiters).toHaveLength(1);

            await harness.receive({ id: 1, result: undefined });
            await expect(occupied).resolves.toBeUndefined();
            await flushNextTick();

            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.send.mock.calls[0][0]).toMatchObject({
                func: 'addUploadedVideoFile',
                id: 1,
                model: 'recorded',
            });
            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(harness.client.pending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);

            await harness.receive({ id: 1, type: 'uploadedVideoAdopted' });
            const disposition = await attempt.disposition;
            expect(disposition.kind).toBe('adopted');
            if (disposition.kind !== 'adopted') throw new Error('ExpectedAdoptedDisposition');
            expect(harness.client.pending.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);

            await harness.receive({ id: 1, result: undefined });
            await expect(disposition.completion).resolves.toBeUndefined();
            expect(harness.send).toHaveBeenCalledOnce();
            expect(harness.client.allocationWaiters).toHaveLength(0);
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            harness.cleanup();
        }
    });

    it('treats the normal registration reply as adopted when the internal acknowledgement is lost', async () => {
        const harness = makeClient();
        try {
            const attempt = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            await flushNextTick();
            await harness.receive({ id: 1, result: undefined });

            const disposition = await attempt.disposition;
            expect(disposition.kind).toBe('adopted');
            if (disposition.kind !== 'adopted') throw new Error('ExpectedAdoptedDisposition');
            await expect(disposition.completion).resolves.toBeUndefined();
            expect(harness.send).toHaveBeenCalledOnce();
        } finally {
            harness.cleanup();
        }
    });

    it('calls the existing domain once only after the parent adoption adapter returns its owned path', async () => {
        const adoptionResult = deferred<string>();
        const adoption = { adopt: vi.fn(() => adoptionResult.promise) };
        const { domains, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = makeChild();
        server.register(requester);

        requester.emit('message', {
            args: { option: uploadOption },
            func: 'addUploadedVideoFile',
            id: 701,
            model: 'recorded',
        });
        await flushImmediate();

        expect(adoption.adopt).toHaveBeenCalledOnce();
        expect(adoption.adopt).toHaveBeenCalledWith(incomingPath);
        for (const handler of domainHandlerSpies(domains)) expect(handler).not.toHaveBeenCalled();
        expect(requester.send).not.toHaveBeenCalled();

        adoptionResult.resolve(adoptedPath);
        await flushImmediate();

        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({
            ...uploadOption,
            filePath: adoptedPath,
        });
        expect(requester.send).toHaveBeenCalledWith({ id: 701, result: undefined });
    });

    it('sends one internal adoption acknowledgement after the parent adoption completes but before the domain reply', async () => {
        const adoptionResult = deferred<string>();
        const domain = deferred<void>();
        const adoption = { adopt: vi.fn(() => adoptionResult.promise) };
        const { domains, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = makeChild();
        const client = makeClient();
        try {
            domains.recorded.addUploadedVideoFile.mockImplementation(() => domain.promise);
            requester.send.mockImplementation(message => void client.receive(message));
            client.send.mockImplementation(message => requester.emit('message', message));
            server.register(requester);

            const pending = client.client.recorded.addUploadedVideoFile(uploadOption);
            await flushNextTick();
            await flushImmediate();

            expect(adoption.adopt).toHaveBeenCalledWith(incomingPath);
            expect(requester.send).not.toHaveBeenCalled();
            expect(domains.recorded.addUploadedVideoFile).not.toHaveBeenCalled();

            adoptionResult.resolve(adoptedPath);
            await flushImmediate();

            expect(requester.send.mock.calls.map(([message]) => message)).toEqual([
                { id: 1, type: 'uploadedVideoAdopted' },
            ]);
            expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({
                ...uploadOption,
                filePath: adoptedPath,
            });
            let settled = false;
            void pending.then(
                () => (settled = true),
                () => (settled = true),
            );
            await Promise.resolve();
            expect(settled).toBe(false);

            domain.resolve();
            await expect(pending).resolves.toBeUndefined();
            expect(requester.send.mock.calls.map(([message]) => message)).toEqual([
                { id: 1, type: 'uploadedVideoAdopted' },
                { id: 1, result: undefined },
            ]);
        } finally {
            client.cleanup();
        }
    });

    it('returns the adoption error with the same id without starting a domain handler', async () => {
        const adoptionFailure = new Error('synthetic adoption failure');
        const adoption = { adopt: vi.fn().mockRejectedValue(adoptionFailure) };
        const { domains, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = makeChild();
        server.register(requester);

        requester.emit('message', {
            args: { option: uploadOption },
            func: 'addUploadedVideoFile',
            id: 702,
            model: 'recorded',
        });
        await flushImmediate();

        expect(adoption.adopt).toHaveBeenCalledOnce();
        expect(adoption.adopt).toHaveBeenCalledWith(incomingPath);
        for (const handler of domainHandlerSpies(domains)) expect(handler).not.toHaveBeenCalled();
        expect(requester.send.mock.calls).toEqual([[{ error: adoptionFailure.message, id: 702 }]]);
    });

    it('returns the adopted domain error with the same id after one domain call', async () => {
        const domainFailure = new Error('synthetic adopted domain failure');
        const adoption = { adopt: vi.fn(async () => adoptedPath) };
        const { domains, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = makeChild();
        domains.recorded.addUploadedVideoFile.mockRejectedValue(domainFailure);
        server.register(requester);

        requester.emit('message', {
            args: { option: uploadOption },
            func: 'addUploadedVideoFile',
            id: 703,
            model: 'recorded',
        });
        await flushImmediate();

        expect(adoption.adopt).toHaveBeenCalledOnce();
        expect(adoption.adopt).toHaveBeenCalledWith(incomingPath);
        expectOnlyHandlerCalled(domains, domains.recorded.addUploadedVideoFile);
        expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({
            ...uploadOption,
            filePath: adoptedPath,
        });
        expect(requester.send.mock.calls).toEqual([
            [{ id: 703, type: 'uploadedVideoAdopted' }],
            [{ error: domainFailure.message, id: 703 }],
        ]);
    });

    it('keeps the adopted handler running after the caller times out and sends its late reply only to the original requester', async () => {
        vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
        const domain = deferred<void>();
        const adoption = { adopt: vi.fn(async () => adoptedPath) };
        const { domains, server } = makeServer({ recordedUploadAdoption: adoption });
        const requester = makeChild();
        const replacement = makeChild();
        const messageListenerBaseline = process.listenerCount('message');
        const client = makeClient();
        const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
        const timerCleanupBaseline = clearTimeout.mock.calls.length;
        const timerBaseline = vi.getTimerCount();
        try {
            domains.recorded.addUploadedVideoFile.mockImplementation(() => domain.promise);
            requester.send.mockImplementation(message => void client.receive(message));
            client.send.mockImplementation(message => requester.emit('message', message));
            server.register(requester);

            const attempt = client.client.uploadedVideoRegistrationPort.dispatch(uploadOption);
            await flushNextTick();
            await flushImmediate();

            expect(adoption.adopt).toHaveBeenCalledWith(incomingPath);
            expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledWith({
                ...uploadOption,
                filePath: adoptedPath,
            });
            expect(requester.send.mock.calls[0][0]).toEqual({ id: 1, type: 'uploadedVideoAdopted' });
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);
            const disposition = await attempt.disposition;
            expect(disposition.kind).toBe('adopted');
            if (disposition.kind !== 'adopted') throw new Error('ExpectedAdoptedDisposition');

            server.register(replacement);
            expect(requester.listenerCount('message')).toBe(0);
            expect(replacement.listenerCount('message')).toBe(1);
            const timeout = expect(disposition.completion).rejects.toThrow('IPCTimeout');
            await vi.advanceTimersByTimeAsync(600_000);
            await timeout;
            expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(clearTimeout.mock.calls).toHaveLength(timerCleanupBaseline + 1);
            expect(vi.getTimerCount()).toBe(timerBaseline);

            domain.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(requester.send).toHaveBeenCalledWith({ id: 1, result: undefined });
            expect(replacement.send).not.toHaveBeenCalled();
            expect(domains.recorded.addUploadedVideoFile).toHaveBeenCalledOnce();
            expect(clearTimeout.mock.calls).toHaveLength(timerCleanupBaseline + 1);
            expect(vi.getTimerCount()).toBe(timerBaseline);
        } finally {
            client.cleanup();
            expect(process.listenerCount('message')).toBe(messageListenerBaseline);
        }
    });

    it('keeps a timed-out upload id retired when same-id and stale internal acknowledgements arrive before reuse', async () => {
        vi.useFakeTimers();
        const messageListenerBaseline = process.listenerCount('message');
        const timerBaseline = vi.getTimerCount();
        const harness = makeClient({ max: 2, successor: current => current + 1 });
        try {
            let timedOutSettlements = 0;
            const timedOut = harness.client.uploadedVideoRegistrationPort.dispatch(uploadOption).disposition.then(
                value => {
                    timedOutSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    timedOutSettlements += 1;
                    return { error };
                },
            );
            await flushNextTick();
            expect(harness.send.mock.calls[0][0].id).toBe(1);

            await vi.advanceTimersByTimeAsync(600_000);
            await expect(timedOut).resolves.toMatchObject({ error: { message: 'IPCTimeout' } });
            expect(timedOutSettlements).toBe(1);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline);

            await harness.receive({ id: 1, type: 'uploadedVideoAdopted' });
            await flushNextTick();
            expect(timedOutSettlements).toBe(1);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline);
            expect(process.listenerCount('message')).toBe(messageListenerBaseline + 1);

            let otherSettlements = 0;
            const otherPending = harness.client.recorded.delete(704).then(
                value => {
                    otherSettlements += 1;
                    return { value };
                },
                (error: Error) => {
                    otherSettlements += 1;
                    return { error };
                },
            );
            await flushNextTick();
            expect(harness.send.mock.calls[1][0].id).toBe(2);
            expect(harness.client.pending.has(2)).toBe(true);
            expect(otherSettlements).toBe(0);
            const timerCountWithOtherPending = vi.getTimerCount();
            const messageListenerCount = process.listenerCount('message');

            await harness.receive({ id: 1, type: 'uploadedVideoAdopted' });
            await flushNextTick();
            expect(timedOutSettlements).toBe(1);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(otherSettlements).toBe(0);
            expect(harness.client.pending.has(2)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerCountWithOtherPending);
            expect(process.listenerCount('message')).toBe(messageListenerCount);

            await harness.receive({ id: 2, result: 'other-result' });
            await expect(otherPending).resolves.toEqual({ value: 'other-result' });
            expect(otherSettlements).toBe(1);
            expect(harness.client.retired.has(1)).toBe(true);
            expect(vi.getTimerCount()).toBe(timerBaseline);
            expect(process.listenerCount('message')).toBe(messageListenerBaseline + 1);
        } finally {
            harness.cleanup();
            expect(process.listenerCount('message')).toBe(messageListenerBaseline);
        }
    });
});

describe('SPEC-PORT encode completion consumer port', () => {
    const info = { mode: 'synthetic-mode', recordedId: 41, videoFileId: 42 };

    it('routes the exact info once through the registered sink and preserves the reply envelope', async () => {
        const { domains, server } = makeServer({ registerEncodeSink: true });
        const child = makeChild();
        server.register(child);

        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 211,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(domains.encode.emitFinishEncode).toHaveBeenCalledOnce();
        expect(domains.encode.emitFinishEncode).toHaveBeenCalledWith(info);
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ id: 211, result: undefined });
    });

    it('returns an explicit same-id diagnostic when no encode completion sink is registered', async () => {
        const { domains, server } = makeServer({ registerEncodeSink: false });
        const child = makeChild();
        server.register(child);

        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 212,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(domains.encode.emitFinishEncode).not.toHaveBeenCalled();
        expect(child.send).toHaveBeenCalledOnce();
        expect(child.send).toHaveBeenCalledWith({ error: 'EncodeCompletionSinkNotRegistered', id: 212 });
    });

    it('exposes sink registration through an adapter distinct from the child register API', () => {
        const { server } = makeServer({ registerEncodeSink: false });

        expect(server.encodeCompletionSinkRegistrationPort).toMatchObject({ register: expect.any(Function) });
        expect(server.encodeCompletionSinkRegistrationPort).not.toBe(server);
        expect(server.encodeCompletionSinkRegistrationPort.register).not.toBe(server.register);
    });

    it.each(['child-before-sink', 'sink-before-child'] as const)(
        'keeps child and sink registration independent for %s order',
        async order => {
            const { registerSink, server } = makeServer({ registerEncodeSink: false });
            const child = makeChild();
            const accept = vi.fn();
            if (order === 'child-before-sink') {
                server.register(child);
                registerSink({ accept });
            } else {
                registerSink({ accept });
                server.register(child);
            }

            child.emit('message', {
                args: { info },
                func: 'emitFinishEncode',
                id: 213,
                model: 'encodeEvent',
            });
            await flushImmediate();

            expect(accept.mock.calls).toEqual([[info]]);
            expect(child.send.mock.calls).toEqual([[{ id: 213, result: undefined }]]);
        },
    );

    it('keeps a legal child with an accept method on the unchanged child register path', async () => {
        const { server } = makeServer({ registerEncodeSink: false });
        const child = Object.assign(makeChild(), { accept: vi.fn() });

        server.register(child);
        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 214,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(child.accept).not.toHaveBeenCalled();
        expect(child.send.mock.calls).toEqual([[{ error: 'EncodeCompletionSinkNotRegistered', id: 214 }]]);
    });

    it('waits for deferred sink settlement before sending one same-id success and preserves null exactly', async () => {
        const gate = deferred<void>();
        const accept = vi.fn(() => gate.promise);
        const nullInfo = { ...info, videoFileId: null };
        const { registerSink, server } = makeServer({ registerEncodeSink: false });
        const child = makeChild();
        registerSink({ accept });
        server.register(child);

        child.emit('message', {
            args: { info: nullInfo },
            func: 'emitFinishEncode',
            id: 215,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(accept).toHaveBeenCalledOnce();
        expect(accept.mock.calls[0][0]).toBe(nullInfo);
        expect(child.send).not.toHaveBeenCalled();

        gate.resolve();
        await flushImmediate();

        expect(accept).toHaveBeenCalledOnce();
        expect(child.send.mock.calls).toEqual([[{ id: 215, result: undefined }]]);
    });

    it('turns an asynchronous sink rejection into one same-id error without an unhandled rejection', async () => {
        const failure = new Error('synthetic asynchronous sink rejection');
        const unhandled = vi.fn();
        const { registerSink, server } = makeServer({ registerEncodeSink: false });
        const child = makeChild();
        registerSink({ accept: vi.fn().mockRejectedValue(failure) });
        server.register(child);
        process.on('unhandledRejection', unhandled);
        try {
            child.emit('message', {
                args: { info },
                func: 'emitFinishEncode',
                id: 216,
                model: 'encodeEvent',
            });
            await flushImmediate();

            expect(child.send.mock.calls).toEqual([[{ error: failure.message, id: 216 }]]);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});

describe('SPEC-CORR response correlation', () => {
    it('settles two client requests by numeric id when replies complete out of order', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        try {
            vi.setSystemTime(3_001);
            const first = harness.client.reserveation.getBroadcastStatus();
            await flushNextTick();
            vi.setSystemTime(3_002);
            const second = harness.client.recorded.createNewRecorded({ name: 'synthetic-recorded' });
            await flushNextTick();
            const [firstMessage, secondMessage] = harness.send.mock.calls.map(([message]) => message);
            await harness.receive({ id: secondMessage.id, result: 302 });
            await harness.receive({ id: firstMessage.id, result: { isBroadcasting: false } });
            await expect(second).resolves.toBe(302);
            await expect(first).resolves.toEqual({ isBroadcasting: false });
        } finally {
            harness.cleanup();
        }
    });

    it('rejects only the same-id client request with the exact reply error message', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(3_003);
        const harness = makeClient();
        try {
            const pending = harness.client.recorded.delete(21);
            await flushNextTick();
            const message = harness.send.mock.calls[0][0];
            await harness.receive({ error: 'synthetic-domain-error', id: message.id });
            await expect(pending).rejects.toThrow('synthetic-domain-error');
        } finally {
            harness.cleanup();
        }
    });
});

describe('SPEC-RECORDED-USE internal recorded-use carrier', () => {
    it.each([
        ['granted', 'resolves'],
        ['blocked', 'rejects'],
        ['unknown', 'rejects'],
    ] as const)('routes an exact %s acquire result through the requester-scoped registry', async (status, outcome) => {
        vi.useFakeTimers();
        const harness = makeClient();
        const { server } = makeServer();
        const child = makeChild();
        const registry = {
            acquire: vi.fn(() => ({ status })),
            release: vi.fn(() => 'released'),
        };
        try {
            server.recordedResourceUseRegistryRegistrationPort.register(registry);
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));

            const acquire = harness.client.recordedResourceUseClient.acquire(401, 'encoding');
            await flushNextTick();
            await Promise.resolve();

            expect(registry.acquire).toHaveBeenCalledOnce();
            expect(registry.acquire).toHaveBeenCalledWith({
                kind: 'encoding',
                recordedId: 401,
                requestId: 1,
                senderPeer: child,
            });
            if (outcome === 'resolves') {
                await expect(acquire).resolves.toMatchObject({ token: expect.any(Object) });
                expect(harness.client.leased.has(1)).toBe(true);
            } else {
                await expect(acquire).rejects.toThrow(
                    status === 'blocked' ? 'RecordedResourceUseBlocked' : 'RecordedResourceUseUnknown',
                );
                expect(harness.client.leased.has(1)).toBe(false);
            }
        } finally {
            harness.cleanup();
        }
    });

    it('requests one current-generation snapshot and transports a known numeric array without domain routing', async () => {
        vi.useFakeTimers();
        const harness = makeClient();
        const { domains, server } = makeServer();
        const child = makeChild();
        const recordedIds = [411, 412];
        try {
            harness.client.recordedUseSnapshotHandlerRegistrationPort.register({
                getSnapshot: () => ({ recordedIds, status: 'known' }),
            });
            server.register(child);
            harness.send.mockImplementation(message => child.emit('message', message));
            child.send.mockImplementation(message => void harness.receive(message));

            const snapshot = server.recordedUseSnapshotClient.requestSnapshot();
            await flushNextTick();
            await Promise.resolve();

            await expect(snapshot).resolves.toEqual({ recordedIds, status: 'known' });
            expect(child.send).toHaveBeenCalledWith({ id: 1, type: 'recordedUseSnapshotRequest' });
            for (const handler of domainHandlerSpies(domains)) expect(handler).not.toHaveBeenCalled();
            expect(harness.client.pending.size).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            harness.cleanup();
        }
    });
});
