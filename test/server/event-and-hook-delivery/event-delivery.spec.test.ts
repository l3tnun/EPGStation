import { describe, expect, it, vi } from 'vitest';
import {
    deferred,
    EncodeEvent,
    EPGUpdateEvent,
    flushImmediate,
    makeLogger,
    makeRecorded,
    makeReserve,
    OperatorEncodeEvent,
    RecordedEvent,
    RecordedTagEvent,
    RecordingEvent,
    ReserveEvent,
    RuleEvent,
    ThumbnailEvent,
} from './_harness';

type EventCase = readonly [
    label: string,
    Constructor: new (...args: any[]) => any,
    setter: string,
    emitter: string,
    makeArguments: () => unknown[],
];

const diff = () => ({ insert: [makeReserve()], isSuppressLog: false });
const wrapperOperations: EventCase[] = [
    ['EPG updated', EPGUpdateEvent, 'setUpdated', 'emitUpdated', () => []],
    ['rule added', RuleEvent, 'setAdded', 'emitAdded', () => [1]],
    ['rule updated', RuleEvent, 'setUpdated', 'emitUpdated', () => [2]],
    ['rule enabled', RuleEvent, 'setEnabled', 'emitEnabled', () => [3]],
    ['rule disabled', RuleEvent, 'setDisabled', 'emitDisabled', () => [4]],
    ['rule deleted', RuleEvent, 'setDeleted', 'emitDeleted', () => [5]],
    ['reservation updated', ReserveEvent, 'setUpdated', 'emitUpdated', () => [diff()]],
    [
        'recording preparation started',
        RecordingEvent,
        'setStartPrepRecording',
        'emitStartPrepRecording',
        () => [makeReserve()],
    ],
    [
        'recording preparation cancelled',
        RecordingEvent,
        'setCancelPrepRecording',
        'emitCancelPrepRecording',
        () => [makeReserve()],
    ],
    [
        'recording preparation failed',
        RecordingEvent,
        'setPrepRecordingFailed',
        'emitPrepRecordingFailed',
        () => [makeReserve()],
    ],
    [
        'recording started',
        RecordingEvent,
        'setStartRecording',
        'emitStartRecording',
        () => [makeReserve(), makeRecorded()],
    ],
    [
        'recording failed',
        RecordingEvent,
        'setRecordingFailed',
        'emitRecordingFailed',
        () => [makeReserve(), makeRecorded(), undefined],
    ],
    [
        'recording retry exhausted',
        RecordingEvent,
        'setRecordingRetryOver',
        'emitRecordingRetryOver',
        () => [makeReserve()],
    ],
    [
        'recording finished',
        RecordingEvent,
        'setFinishRecording',
        'emitFinishRecording',
        () => [makeReserve(), makeRecorded(), true],
    ],
    [
        'recording relay requested',
        RecordingEvent,
        'setEventRelay',
        'emitEventRelay',
        () => [[{ programId: 202, parentReserve: makeReserve() }]],
    ],
    ['recorded deleted', RecordedEvent, 'setDeleteRecorded', 'emitDeleteRecorded', () => [makeRecorded()]],
    ['recorded video size updated', RecordedEvent, 'setUpdateVideoFileSize', 'emitUpdateVideoFileSize', () => [301]],
    ['recorded created', RecordedEvent, 'setCreateNewRecorded', 'emitCreateNewRecorded', () => [302]],
    ['recorded video added', RecordedEvent, 'setAddVideoFile', 'emitAddVideoFile', () => [303]],
    ['recorded upload added', RecordedEvent, 'setAddUploadedVideoFile', 'emitAddUploadedVideoFile', () => [304, true]],
    ['recorded video deleted', RecordedEvent, 'setDeleteVideoFile', 'emitDeleteVideoFile', () => [305]],
    ['recorded protection changed', RecordedEvent, 'setChangeProtect', 'emitChangeProtect', () => [306, false]],
    ['recorded tag created', RecordedTagEvent, 'setCreated', 'emitCreated', () => [{ id: 401, name: 'synthetic-tag' }]],
    ['recorded tag updated', RecordedTagEvent, 'setUpdated', 'emitUpdated', () => [402]],
    ['recorded tag related', RecordedTagEvent, 'setRelated', 'emitRelated', () => [403, 31]],
    ['recorded tag deleted', RecordedTagEvent, 'setDeleted', 'emitDeleted', () => [404]],
    ['recorded tag relation deleted', RecordedTagEvent, 'setDeletedRelation', 'emitDeletedRelation', () => [405, 31]],
    ['thumbnail added', ThumbnailEvent, 'setAdded', 'emitAdded', () => [501, 31]],
    ['thumbnail deleted', ThumbnailEvent, 'setDeleted', 'emitDeleted', () => []],
    ['encode added', EncodeEvent, 'setAddEncode', 'emitAddEncode', () => [601]],
    ['encode cancelled', EncodeEvent, 'setCancelEncode', 'emitCancelEncode', () => [602]],
    ['encode finished', EncodeEvent, 'setFinishEncode', 'emitFinishEncode', () => [{ id: 603, recordedId: 31 }]],
    ['encode failed', EncodeEvent, 'setErrorEncode', 'emitErrorEncode', () => []],
    ['encode list updated', EncodeEvent, 'setUpdateEncode', 'emitupdateEncode', () => []],
    ['encode progress updated', EncodeEvent, 'setUpdateEncodeProgress', 'emitUpdateEncodeProgress', () => []],
    [
        'operator encode finished',
        OperatorEncodeEvent,
        'setFinishEncode',
        'emitFinishEncode',
        () => [{ id: 701, recordedId: 31 }],
    ],
    ['recorded drop-log changed', RecordedEvent, 'setDropLogFileChanged', 'emitDropLogFileChanged', () => [307]],
];

const familyCases: EventCase[] = [
    wrapperOperations[0],
    wrapperOperations[1],
    wrapperOperations[6],
    wrapperOperations[7],
    wrapperOperations[11],
    wrapperOperations[15],
    wrapperOperations[22],
    wrapperOperations[28],
    wrapperOperations[32],
    wrapperOperations[35],
    wrapperOperations[36],
];

/**
 * Residual set* operations outside familyCases whose listener-failure catch
 * (sync throw + async rejection + later-listener continuation) was not reached
 * by the familyCases it.each. Exact 20 setters from the R2 residual inventory.
 */
const residualListenerFailureCases: EventCase[] = [
    // EncodeEvent
    wrapperOperations[29], // setAddEncode
    wrapperOperations[30], // setCancelEncode
    wrapperOperations[31], // setFinishEncode
    wrapperOperations[33], // setUpdateEncode
    wrapperOperations[34], // setUpdateEncodeProgress
    // RecordedEvent
    wrapperOperations[16], // setUpdateVideoFileSize
    wrapperOperations[19], // setAddUploadedVideoFile
    wrapperOperations[20], // setDeleteVideoFile
    wrapperOperations[21], // setChangeProtect
    // RecordingEvent
    wrapperOperations[9], // setPrepRecordingFailed
    wrapperOperations[10], // setStartRecording
    wrapperOperations[12], // setRecordingRetryOver
    wrapperOperations[14], // setEventRelay
    // RuleEvent
    wrapperOperations[2], // setUpdated
    wrapperOperations[3], // setEnabled
    wrapperOperations[4], // setDisabled
    wrapperOperations[5], // setDeleted
    // RecordedTagEvent
    wrapperOperations[24], // setRelated
    wrapperOperations[25], // setDeleted
    wrapperOperations[26], // setDeletedRelation
];

const listenerFailureCases: EventCase[] = [...familyCases, ...residualListenerFailureCases];

const construct = (Constructor: new (...args: any[]) => any) => {
    const logger = makeLogger();
    return { event: new Constructor({ getLogger: () => logger }), logger };
};

describe('all process-local event wrapper operations', () => {
    it.each(wrapperOperations)(
        '[supporting event delivery] accepts %s with zero listeners and forwards one exact tuple',
        async (_label, Constructor, setter, emitter, makeArguments) => {
            const { event, logger } = construct(Constructor);
            expect(event[emitter](...makeArguments())).toBeUndefined();
            const listener = vi.fn();
            event[setter](listener);
            const args = makeArguments();
            expect(event[emitter](...args)).toBeUndefined();
            await flushImmediate();
            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith(...args);
            expect(logger.system.error).not.toHaveBeenCalled();
        },
    );

    it('[supporting event delivery] keeps duplicate EPG one-shot registrations on only the first delivery', async () => {
        const { event } = construct(EPGUpdateEvent);
        const listener = vi.fn();
        event.setUpdatedOnce(listener);
        event.setUpdatedOnce(listener);
        event.emitUpdated();
        event.emitUpdated();
        await flushImmediate();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('[supporting event delivery] records a synchronous EPG one-shot listener failure', async () => {
        const { event, logger } = construct(EPGUpdateEvent);
        const failure = new Error('synthetic one-shot listener failure');
        event.setUpdatedOnce(() => {
            throw failure;
        });

        expect(event.emitUpdated()).toBeUndefined();
        await flushImmediate();

        expect(logger.system.error).toHaveBeenCalledWith(failure);
    });

    it.each(familyCases)(
        '[supporting event delivery] invokes the same callback twice when registered twice for %s',
        async (_label, Constructor, setter, emitter, makeArguments) => {
            const { event } = construct(Constructor);
            const listener = vi.fn();
            event[setter](listener);
            event[setter](listener);
            event[emitter](...makeArguments());
            await flushImmediate();
            expect(listener).toHaveBeenCalledTimes(2);
        },
    );

    it.each(familyCases)(
        '[supporting event delivery] preserves registration order, non-waiting delivery, and duplicates for %s',
        async (_label, Constructor, setter, emitter, makeArguments) => {
            const { event } = construct(Constructor);
            const gate = deferred<void>();
            const ledger: string[] = [];
            event[setter](async () => {
                ledger.push('first:start');
                await gate.promise;
                ledger.push('first:end');
            });
            event[setter](() => ledger.push('second:start'));
            expect(event[emitter](...makeArguments())).toBeUndefined();
            expect(event[emitter](...makeArguments())).toBeUndefined();
            expect(ledger).toEqual(['first:start', 'second:start', 'first:start', 'second:start']);
            gate.resolve();
            await flushImmediate();
            expect(ledger).toEqual([
                'first:start',
                'second:start',
                'first:start',
                'second:start',
                'first:end',
                'first:end',
            ]);
        },
    );

    it.each(listenerFailureCases)(
        '[supporting event delivery] contains synchronous throw and asynchronous rejection before a later %s listener',
        async (_label, Constructor, setter, emitter, makeArguments) => {
            const { event, logger } = construct(Constructor);
            const synchronous = new Error('synthetic synchronous listener failure');
            const asynchronous = new Error('synthetic asynchronous listener failure');
            const later = vi.fn();
            event[setter](() => {
                throw synchronous;
            });
            event[setter](async () => {
                throw asynchronous;
            });
            event[setter](later);
            expect(event[emitter](...makeArguments())).toBeUndefined();
            expect(later).toHaveBeenCalledOnce();
            await flushImmediate();
            expect(logger.system.error.mock.calls).toEqual([[synchronous], [asynchronous]]);
        },
    );
});

describe('event canonical execution ledger', () => {
    it('[EH-1.1] delivers every registered wrapper operation to one listener with its exact tuple', async () => {
        for (const [_label, Constructor, setter, emitter, makeArguments] of wrapperOperations) {
            const { event } = construct(Constructor);
            const listener = vi.fn();
            event[setter](listener);
            const args = makeArguments();
            expect(event[emitter](...args)).toBeUndefined();
            await flushImmediate();
            expect(listener).toHaveBeenCalledExactlyOnceWith(...args);
        }
    });

    it('[EH-1.2] starts listeners in registration order', () => {
        const { event } = construct(ReserveEvent);
        const ledger: string[] = [];
        event.setUpdated(() => ledger.push('first'));
        event.setUpdated(() => ledger.push('second'));

        event.emitUpdated(diff());

        expect(ledger).toEqual(['first', 'second']);
    });

    it('[EH-1.3] returns from emit before a deferred listener settles', async () => {
        const { event } = construct(ReserveEvent);
        const gate = deferred<void>();
        event.setUpdated(async () => gate.promise);

        expect(event.emitUpdated(diff())).toBeUndefined();
        gate.resolve();
        await flushImmediate();
    });

    it('[EH-1.4] invokes a duplicated listener once for each registration', async () => {
        const { event } = construct(ReserveEvent);
        const listener = vi.fn();
        event.setUpdated(listener);
        event.setUpdated(listener);

        event.emitUpdated(diff());
        await flushImmediate();

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('[EH-1.5] accepts an emit with no listener', () => {
        const { event, logger } = construct(ReserveEvent);

        expect(event.emitUpdated(diff())).toBeUndefined();
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[EH-1.6] records synchronous and asynchronous listener failures', async () => {
        const { event, logger } = construct(ReserveEvent);
        const synchronous = new Error('synthetic synchronous failure');
        const asynchronous = new Error('synthetic asynchronous failure');
        event.setUpdated(() => {
            throw synchronous;
        });
        event.setUpdated(async () => {
            throw asynchronous;
        });

        event.emitUpdated(diff());
        await flushImmediate();

        expect(logger.system.error).toHaveBeenCalledWith(synchronous);
        expect(logger.system.error).toHaveBeenCalledWith(asynchronous);
    });

    it('[EH-1.7] leaves the accepted event payload unchanged after listener failure', async () => {
        const { event } = construct(ReserveEvent);
        const value = diff();
        const snapshot = structuredClone(value);
        event.setUpdated(() => {
            throw new Error('synthetic listener failure');
        });

        event.emitUpdated(value);
        await flushImmediate();

        expect(value).toEqual(snapshot);
    });
});
