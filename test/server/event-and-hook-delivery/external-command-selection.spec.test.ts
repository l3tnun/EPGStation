import { describe, expect, it, vi } from 'vitest';
import { makeChild, makeServer } from '../process-messaging/_harness';
import {
    ExternalCommandManageModel,
    flushImmediate,
    makeLogger,
    makeRecorded,
    makeReserve,
    makeSetter,
    OperatorEncodeEvent,
    OperatorEncodeEventBinding,
} from './_harness';

const externalHooks = [
    'addRecordingPrepStartCmd',
    'addRecordingPrepRecFailedCmd',
    'addRecordingStartCmd',
    'addRecordingFailedCmd',
    'addRecordingFinishCmd',
    'addEncodingFinishCmd',
] as const;

const makeEncodingOracle = (config: Record<string, unknown>, logger = makeLogger()) => {
    const queue = { add: vi.fn() };
    const channelDB = { findId: vi.fn() };
    const recordedDB = { findId: vi.fn() };
    const videoUtil = { getFullFilePathFromId: vi.fn() };
    const runtimeConfig = { hookCommandMaxPending: 64, hookCommandTimeoutMs: 300_000, ...config };
    const model = new ExternalCommandManageModel(
        { getLogger: () => logger },
        { getConfig: () => runtimeConfig },
        queue,
        channelDB,
        recordedDB,
        videoUtil,
    );
    const selection = vi.spyOn(model, 'addFinishEncode');
    const executor = vi.fn();
    model.createFinishEncodeCmd = executor;
    const observation = () => ({
        databaseReads: channelDB.findId.mock.calls.length + recordedDB.findId.mock.calls.length,
        enqueues: queue.add.mock.calls.length,
        executorStarts: executor.mock.calls.length,
        pathReads: videoUtil.getFullFilePathFromId.mock.calls.length,
        selections: selection.mock.calls,
    });
    return { executor, logger, model, observation, queue };
};

const observeDirectEncoding = (config: Record<string, unknown>, infos: readonly Record<string, unknown>[]) => {
    const logger = makeLogger();
    const oracle = makeEncodingOracle(config, logger);
    const harness = makeSetter({ externalCommandManage: oracle.model, logger });
    harness.setter.set();
    const results = infos.map(info => harness.callbacks.encode.setFinishEncode(info));
    return { harness, oracle, results };
};

const observeProviderEncoding = async (config: Record<string, unknown>, infos: readonly Record<string, unknown>[]) => {
    const logger = makeLogger();
    const oracle = makeEncodingOracle(config, logger);
    const provider = new OperatorEncodeEvent({ getLogger: () => logger });
    const { domains, server } = makeServer({ registerEncodeSink: false });
    const notifyClient = vi.spyOn(server, 'notifyClient');
    const binding = new OperatorEncodeEventBinding(server.encodeCompletionSinkRegistrationPort, provider);
    const harness = makeSetter({ encodeEvent: provider, externalCommandManage: oracle.model, ipc: server, logger });
    harness.setter.set();
    binding.setup();
    const child = makeChild();
    server.register(child);
    infos.forEach((info, index) => {
        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 701 + index,
            model: 'encodeEvent',
        });
    });
    await flushImmediate();
    return { child, domains, harness, logger, notifyClient, oracle };
};

describe('EventSetter reservation and recording hook routing', () => {
    it.each([
        ['reservation insert', 'insert'],
        ['reservation update', 'update'],
        ['reservation delete', 'delete'],
    ])('[supporting selector] forwards one exact %s diff without waiting', (_label, collection) => {
        const harness = makeSetter();
        harness.setter.set();
        const values = [makeReserve({ id: 11 }), makeReserve({ id: 12 })];
        const diff = { [collection]: values, isSuppressLog: false };

        expect(harness.callbacks.reserve.setUpdated(diff)).toBeUndefined();

        expect(harness.externalCommandManage.addUpdateReseves.mock.calls).toEqual([[diff]]);
        expect(harness.recordingManage.acceptMutation).toHaveBeenCalledWith(diff);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
        for (const hook of externalHooks) expect(harness.externalCommandManage[hook]).not.toHaveBeenCalled();
    });

    it.each([
        ['preparation start', 'setStartPrepRecording', 'addRecordingPrepStartCmd', 'reserve'],
        ['preparation cancel', 'setCancelPrepRecording', 'addRecordingPrepRecFailedCmd', 'reserve'],
        ['preparation failure', 'setPrepRecordingFailed', 'addRecordingPrepRecFailedCmd', 'reserve'],
        ['recording start', 'setStartRecording', 'addRecordingStartCmd', 'recorded'],
        ['recording failure', 'setRecordingFailed', 'addRecordingFailedCmd', 'recorded'],
        ['recording finish', 'setFinishRecording', 'addRecordingFinishCmd', 'recorded'],
    ] as const)(
        '[supporting selector] selects only the %s hook with its exact payload',
        async (_label, callbackName, expectedHook, payloadKind) => {
            const harness = makeSetter();
            harness.setter.set();
            const reserve = makeReserve();
            const recorded = makeRecorded();
            const args =
                callbackName === 'setStartRecording' || callbackName === 'setRecordingFailed'
                    ? [reserve, recorded]
                    : callbackName === 'setFinishRecording'
                      ? [reserve, recorded, false]
                      : [reserve];

            const result = harness.callbacks.recording[callbackName](...args);
            if (callbackName === 'setStartRecording' || callbackName === 'setFinishRecording') {
                expect(result).toBeInstanceOf(Promise);
            } else {
                expect(result).toBeUndefined();
            }

            const expectedPayload = payloadKind === 'reserve' ? reserve : recorded;
            expect(harness.externalCommandManage[expectedHook].mock.calls).toEqual([[expectedPayload]]);
            for (const hook of externalHooks) {
                if (hook !== expectedHook) expect(harness.externalCommandManage[hook]).not.toHaveBeenCalled();
            }
            await result;
        },
    );

    it('[EH-3.9] selects only the encoding-finished hook with its exact info payload', () => {
        const harness = makeSetter();
        harness.setter.set();
        const info = { recordedId: 31, videoFileId: 41, mode: 'synthetic-mode' };

        expect(harness.callbacks.encode.setFinishEncode(info)).toBeUndefined();

        expect(harness.externalCommandManage.addEncodingFinishCmd.mock.calls).toEqual([[info]]);
        for (const hook of externalHooks) {
            if (hook !== 'addEncodingFinishCmd') expect(harness.externalCommandManage[hook]).not.toHaveBeenCalled();
        }
    });

    it.each([
        ['configured', { encodingFinishCommand: 'synthetic-encoding-command' }, 1, 1],
        ['missing', {}, 1, 0],
        ['configured duplicate', { encodingFinishCommand: 'synthetic-encoding-command' }, 2, 2],
    ] as const)(
        '[supporting selector] gives direct fixture and PM provider the same %s encode-hook result',
        async (_label, config, eventCount, expectedEnqueues) => {
            const info = { mode: 'synthetic-mode', recordedId: 31, videoFileId: 41 };
            const originalInfo = { ...info };
            const infos = Array.from({ length: eventCount }, () => info);

            const direct = observeDirectEncoding(config, infos);
            const provider = await observeProviderEncoding(config, infos);

            expect(direct.oracle.observation()).toEqual(provider.oracle.observation());
            expect(direct.oracle.observation()).toEqual({
                databaseReads: 0,
                enqueues: expectedEnqueues,
                executorStarts: 0,
                pathReads: 0,
                selections:
                    expectedEnqueues === 0
                        ? []
                        : Array.from({ length: eventCount }, () => ['synthetic-encoding-command', info]),
            });
            expect(direct.results).toEqual(Array.from({ length: eventCount }, () => undefined));
            expect(provider.child.send.mock.calls).toEqual(
                Array.from({ length: eventCount }, (_, index) => [{ id: 701 + index, result: undefined }]),
            );
            for (const call of direct.oracle.observation().selections) expect(call[1]).toBe(info);
            for (const call of provider.oracle.observation().selections) expect(call[1]).toBe(info);
            expect(info).toEqual(originalInfo);
            expect(direct.harness.ipc.notifyClient).not.toHaveBeenCalled();
            expect(provider.notifyClient).not.toHaveBeenCalled();
            for (const domain of Object.values(provider.domains)) {
                for (const operation of Object.values(domain)) expect(operation).not.toHaveBeenCalled();
            }
            expect(direct.oracle.logger.system.error).not.toHaveBeenCalled();
            expect(provider.logger.system.error).not.toHaveBeenCalled();
        },
    );

    it.each(['resolved', 'rejected'] as const)(
        '[supporting selector] keeps PM acceptance and domain state unchanged when configured encode work is %s',
        async outcome => {
            const info = { mode: 'synthetic-mode', recordedId: 31, videoFileId: 41 };
            const originalInfo = { ...info };
            const failure = new Error('synthetic configured encode work rejection');
            const provider = await observeProviderEncoding({ encodingFinishCommand: 'synthetic-encoding-command' }, [
                info,
            ]);
            const replyBeforeWork = provider.child.send.mock.calls.map(call => [...call]);
            const work = provider.oracle.queue.add.mock.calls[0][0];
            const settlements: string[] = [];
            if (outcome === 'rejected') provider.oracle.executor.mockRejectedValueOnce(failure);
            else provider.oracle.executor.mockResolvedValueOnce(undefined);

            await work().then(() => settlements.push('resolved'));
            await flushImmediate();

            expect(settlements).toEqual(['resolved']);
            expect(provider.oracle.executor.mock.calls).toEqual([['synthetic-encoding-command', info]]);
            expect(provider.oracle.queue.add).toHaveBeenCalledOnce();
            expect(provider.child.send.mock.calls).toEqual(replyBeforeWork);
            expect(provider.child.send.mock.calls).toEqual([[{ id: 701, result: undefined }]]);
            expect(info).toEqual(originalInfo);
            expect(provider.notifyClient).not.toHaveBeenCalled();
            for (const domain of Object.values(provider.domains)) {
                for (const operation of Object.values(domain)) expect(operation).not.toHaveBeenCalled();
            }
            expect(provider.logger.system.error.mock.calls).toEqual(
                outcome === 'rejected' ? [['execute cmd error: synthetic-encoding-command'], [failure]] : [],
            );
        },
    );

    it('[supporting selector] does not select the recording-failure hook for a missing recorded entity', () => {
        const harness = makeSetter();
        harness.setter.set();
        harness.callbacks.recording.setRecordingFailed(makeReserve(), null);
        expect(harness.externalCommandManage.addRecordingFailedCmd).not.toHaveBeenCalled();
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
    });

    it('[supporting selector] forwards duplicate hook events independently in observed order', () => {
        const harness = makeSetter();
        harness.setter.set();
        const first = makeReserve({ id: 21 });
        const second = makeReserve({ id: 22 });
        harness.callbacks.recording.setStartPrepRecording(first);
        harness.callbacks.recording.setStartPrepRecording(second);
        harness.callbacks.recording.setStartPrepRecording(first);
        expect(harness.externalCommandManage.addRecordingPrepStartCmd.mock.calls).toEqual([[first], [second], [first]]);
    });
});

describe('hook selector canonical execution ledger', () => {
    it.each([
        ['EH-3.1', 'insert'],
        ['EH-3.2', 'update'],
        ['EH-3.3', 'delete'],
    ] as const)('[%s] selects exactly one configured reservation hook', (_id, collection) => {
        const harness = makeSetter();
        harness.setter.set();
        const value = { [collection]: [makeReserve()], isSuppressLog: false };

        harness.callbacks.reserve.setUpdated(value);

        expect(harness.externalCommandManage.addUpdateReseves).toHaveBeenCalledExactlyOnceWith(value);
        for (const hook of externalHooks) expect(harness.externalCommandManage[hook]).not.toHaveBeenCalled();
    });

    it.each([
        ['EH-3.4', 'setStartPrepRecording', 'addRecordingPrepStartCmd'],
        ['EH-3.6', 'setStartRecording', 'addRecordingStartCmd'],
        ['EH-3.7', 'setRecordingFailed', 'addRecordingFailedCmd'],
        ['EH-3.8', 'setFinishRecording', 'addRecordingFinishCmd'],
    ] as const)('[%s] selects one recording hook and no sibling hook', async (_id, callbackName, selected) => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve();
        const recorded = makeRecorded();
        const args =
            callbackName === 'setStartRecording' || callbackName === 'setRecordingFailed'
                ? [reserve, recorded]
                : callbackName === 'setFinishRecording'
                  ? [reserve, recorded, false]
                  : [reserve];

        await harness.callbacks.recording[callbackName](...args);

        expect(harness.externalCommandManage[selected]).toHaveBeenCalledOnce();
        for (const hook of externalHooks) {
            if (hook !== selected) expect(harness.externalCommandManage[hook]).not.toHaveBeenCalled();
        }
    });

    it('[EH-3.5] routes preparation cancellation and failure to the same configured hook', () => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve();

        harness.callbacks.recording.setCancelPrepRecording(reserve);
        harness.callbacks.recording.setPrepRecordingFailed(reserve);

        expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).toHaveBeenNthCalledWith(1, reserve);
        expect(harness.externalCommandManage.addRecordingPrepRecFailedCmd).toHaveBeenNthCalledWith(2, reserve);
    });

    it('[EH-3.10] does not enqueue an unset encoding command', () => {
        const logger = makeLogger();
        const oracle = makeEncodingOracle({}, logger);
        const harness = makeSetter({ externalCommandManage: oracle.model, logger });
        harness.setter.set();

        harness.callbacks.encode.setFinishEncode({ mode: 'synthetic-mode', recordedId: 31, videoFileId: 41 });

        expect(oracle.observation()).toMatchObject({ enqueues: 0, selections: [] });
    });

    it('[EH-3.11] accepts duplicate hook events as independent requests', () => {
        const harness = makeSetter();
        harness.setter.set();
        const reserve = makeReserve();

        harness.callbacks.recording.setStartPrepRecording(reserve);
        harness.callbacks.recording.setStartPrepRecording(reserve);

        expect(harness.externalCommandManage.addRecordingPrepStartCmd).toHaveBeenCalledTimes(2);
    });

    it('[EH-3.12] keeps hook acceptance outside the caller business result', () => {
        const harness = makeSetter();
        harness.setter.set();

        expect(harness.callbacks.recording.setStartPrepRecording(makeReserve())).toBeUndefined();
        expect(harness.externalCommandManage.addRecordingPrepStartCmd).toHaveBeenCalledOnce();
    });
});
