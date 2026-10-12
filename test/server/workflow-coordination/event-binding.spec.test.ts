import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { makeSetter } from '../event-and-hook-delivery/_harness';
import {
    logger as recordingLogger,
    makeManager,
    makeReserve as makeStartupReserve,
    Recorded as StartupRecorded,
} from '../recording-execution/_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

type EventAdapter = Record<string, (...args: any[]) => void>;
type EventAdapterConstructor = new (logger: unknown) => EventAdapter;

interface EventCase {
    readonly emit: string;
    readonly family: string;
    readonly module: string;
    readonly payload: readonly unknown[];
    readonly subscribe: string;
}

const load = (module: string): EventAdapterConstructor =>
    (require(join(snapshot, 'model', 'event', `${module}.js`)) as { default: EventAdapterConstructor }).default;

const reserveUpdate = {
    delete: [],
    insert: [],
    isSuppressLog: false,
    update: [],
};
const encodeFinish = {
    mode: 'synthetic-mode',
    recordedId: 17,
    videoFileId: null,
};

const eventCases: readonly EventCase[] = [
    { emit: 'emitUpdated', family: 'EPG update', module: 'EPGUpdateEvent', payload: [], subscribe: 'setUpdated' },
    { emit: 'emitAdded', family: 'rule', module: 'RuleEvent', payload: [11], subscribe: 'setAdded' },
    {
        emit: 'emitUpdated',
        family: 'reservation',
        module: 'ReserveEvent',
        payload: [reserveUpdate],
        subscribe: 'setUpdated',
    },
    {
        emit: 'emitStartPrepRecording',
        family: 'recording',
        module: 'RecordingEvent',
        payload: [{ id: 12 }],
        subscribe: 'setStartPrepRecording',
    },
    {
        emit: 'emitCreateNewRecorded',
        family: 'recorded content',
        module: 'RecordedEvent',
        payload: [13],
        subscribe: 'setCreateNewRecorded',
    },
    {
        emit: 'emitUpdated',
        family: 'recorded tag',
        module: 'RecordedTagEvent',
        payload: [14],
        subscribe: 'setUpdated',
    },
    {
        emit: 'emitAdded',
        family: 'thumbnail',
        module: 'ThumbnailEvent',
        payload: [15, 16],
        subscribe: 'setAdded',
    },
    {
        emit: 'emitFinishEncode',
        family: 'operator encode',
        module: 'OperatorEncodeEvent',
        payload: [encodeFinish],
        subscribe: 'setFinishEncode',
    },
];

const makeDeferred = () => {
    let reject!: (error: Error) => void;
    let resolve!: () => void;
    const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, reject, resolve };
};

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const makeAdapter = (module = 'EPGUpdateEvent') => {
    const error = vi.fn();
    const Adapter = load(module);
    const adapter = new Adapter({ getLogger: () => ({ system: { error } }) });
    return { adapter, error };
};

const subscribe = (adapter: EventAdapter, method: string, callback: (...args: any[]) => unknown): void => {
    adapter[method].call(adapter, callback);
};

const emit = (adapter: EventAdapter, method: string, payload: readonly unknown[]): void => {
    adapter[method].call(adapter, ...payload);
};

describe('workflow event binding contract', () => {
    it.each(eventCases)('$family wrapper starts synchronously and forwards the exact payload', async item => {
        const { adapter, error } = makeAdapter(item.module);
        const deferred = makeDeferred();
        const ledger: string[] = [];
        const callback = vi.fn((...payload: unknown[]) => {
            ledger.push('callback:start');
            expect(payload).toEqual(item.payload);
            return deferred.promise;
        });
        subscribe(adapter, item.subscribe, callback);

        ledger.push('producer:before');
        emit(adapter, item.emit, item.payload);
        ledger.push('producer:after');

        expect(ledger).toEqual(['producer:before', 'callback:start', 'producer:after']);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();

        deferred.resolve();
        await flush();
        expect(error).not.toHaveBeenCalled();
    });

    it.each(eventCases)('$family wrapper contains a synchronous throw and starts the next listener', item => {
        const { adapter, error } = makeAdapter(item.module);
        const failure = new Error(`synthetic ${item.family} synchronous failure`);
        const next = vi.fn();
        subscribe(adapter, item.subscribe, () => {
            throw failure;
        });
        subscribe(adapter, item.subscribe, next);

        expect(() => emit(adapter, item.emit, item.payload)).not.toThrow();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(...item.payload);
        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(failure);
    });

    it.each(eventCases)('$family wrapper records a returned rejection and starts the next listener', async item => {
        const { adapter, error } = makeAdapter(item.module);
        const failure = new Error(`synthetic ${item.family} returned rejection`);
        const next = vi.fn();
        subscribe(adapter, item.subscribe, () => Promise.reject(failure));
        subscribe(adapter, item.subscribe, next);

        expect(() => emit(adapter, item.emit, item.payload)).not.toThrow();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(...item.payload);
        await flush();

        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(failure);
    });

    it('returns from emit while the callback Promise is still pending', async () => {
        const { adapter, error } = makeAdapter();
        const deferred = makeDeferred();
        let settled = false;
        subscribe(adapter, 'setUpdated', async () => {
            await deferred.promise;
            settled = true;
        });

        expect(adapter.emitUpdated()).toBeUndefined();
        expect(settled).toBe(false);

        deferred.resolve();
        await flush();
        expect(settled).toBe(true);
        expect(error).not.toHaveBeenCalled();
    });

    it('leaves a detached rejection with the callback-local handler', async () => {
        const { adapter, error } = makeAdapter();
        const deferred = makeDeferred();
        const locallyObserved: Error[] = [];
        subscribe(adapter, 'setUpdated', () => {
            void deferred.promise.catch((failure: Error) => locallyObserved.push(failure));
        });
        const failure = new Error('synthetic detached rejection');

        emit(adapter, 'emitUpdated', []);
        deferred.reject(failure);
        await flush();

        expect(locallyObserved).toEqual([failure]);
        expect(error).not.toHaveBeenCalled();
    });

    it('leaves a detached resolution with the callback-local settlement handler', async () => {
        const { adapter, error } = makeAdapter();
        const deferred = makeDeferred();
        const locallyObserved: string[] = [];
        subscribe(adapter, 'setUpdated', () => {
            void deferred.promise.then(() => locallyObserved.push('resolved'));
        });

        emit(adapter, 'emitUpdated', []);
        expect(locallyObserved).toEqual([]);
        deferred.resolve();
        await flush();

        expect(locallyObserved).toEqual(['resolved']);
        expect(error).not.toHaveBeenCalled();
    });

    it('starts a new callback for the same event while an earlier callback is pending', async () => {
        const { adapter, error } = makeAdapter();
        const first = makeDeferred();
        const second = makeDeferred();
        const callbacks = [first, second];
        const callback = vi.fn(() => callbacks.shift()?.promise);
        subscribe(adapter, 'setUpdated', callback);

        emit(adapter, 'emitUpdated', []);
        emit(adapter, 'emitUpdated', []);

        expect(callback).toHaveBeenCalledTimes(2);
        first.resolve();
        second.resolve();
        await flush();
        expect(error).not.toHaveBeenCalled();
    });

    it('runs the explicit one-shot registration only for the first event', async () => {
        const { adapter, error } = makeAdapter();
        const callback = vi.fn();
        subscribe(adapter, 'setUpdatedOnce', callback);

        emit(adapter, 'emitUpdated', []);
        emit(adapter, 'emitUpdated', []);
        await flush();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();
    });

    it('starts registered callbacks in order without waiting for the first callback', async () => {
        const { adapter, error } = makeAdapter();
        const first = makeDeferred();
        const ledger: string[] = [];
        subscribe(adapter, 'setUpdated', () => {
            ledger.push('first:start');
            return first.promise;
        });
        subscribe(adapter, 'setUpdated', () => {
            ledger.push('second:start');
        });

        emit(adapter, 'emitUpdated', []);

        expect(ledger).toEqual(['first:start', 'second:start']);
        first.resolve();
        await flush();
        expect(error).not.toHaveBeenCalled();
    });
});

describe('startup reconciliation finish characterization', () => {
    it('[PRIMARY WC-7.8][WC-7.8] keeps a startup file failure within Recording, then sends only the final successful row through the normal finish handoff', async () => {
        recordingLogger.system.fatal.mockClear();
        const workflow = makeSetter();
        workflow.setter.set();
        const reserve = makeStartupReserve({ id: 61 });
        const interrupted = Object.assign(new StartupRecorded(), {
            id: 71,
            reserveId: reserve.id,
            videoFiles: [{ id: 81, parentDirectoryName: 'tmp' }],
        });
        const finalRecorded = Object.assign(new StartupRecorded(), {
            id: interrupted.id,
            reserveId: reserve.id,
            videoFiles: [],
        });
        const fileFailure = new Error('synthetic startup move failure');
        const recording = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => [[interrupted], 1]),
                findId: vi.fn(async () => finalRecorded),
                findReserveId: vi.fn(),
                removeRecording: vi.fn(async () => undefined),
            },
            recordingUtil: {
                movingFromTmp: vi.fn(async () => Promise.reject(fileFailure)),
                updateVideoFileSize: vi.fn(async () => undefined),
            },
            reserveDB: { findId: vi.fn(async () => reserve) },
        });
        const rebuild = vi.spyOn(recording.model, 'rebuildCandidatesAndStart');
        recording.recordingEvent.emitFinishRecording.mockImplementation((...args: any[]) =>
            workflow.callbacks.recording.setFinishRecording(...args),
        );

        await expect(recording.model.cleanup()).resolves.toBeUndefined();
        await flush();

        expect(recordingLogger.system.fatal.mock.calls).toEqual([['movingFromTmp error: 81'], [fileFailure]]);
        expect(recording.recordingUtil.updateVideoFileSize).toHaveBeenCalledWith(81);
        expect(recording.recordingEvent.emitFinishRecording).toHaveBeenCalledWith(reserve, finalRecorded, true);
        expect(rebuild).not.toHaveBeenCalled();
        expect(workflow.reservationManage.cancel.mock.calls).toEqual([[reserve.id]]);
        expect(workflow.externalCommandManage.addRecordingFinishCmd.mock.calls).toEqual([[finalRecorded]]);
        expect(workflow.ipc.notifyClient).toHaveBeenCalledOnce();
        expect(workflow.externalCommandManage.addRecordingFailedCmd).not.toHaveBeenCalled();
    });

    it('[WC-7.9] returns initial reconciliation failure without publishing a finish or starting Recording candidates', async () => {
        const failure = new Error('synthetic startup list failure');
        const recording = makeManager({
            recordedDB: {
                findAll: vi.fn(async () => Promise.reject(failure)),
                findId: vi.fn(),
                findReserveId: vi.fn(),
                removeRecording: vi.fn(),
            },
        });
        const rebuild = vi.spyOn(recording.model, 'rebuildCandidatesAndStart');

        await expect(recording.model.cleanup()).rejects.toBe(failure);

        expect(recording.recordedDB.findAll).toHaveBeenCalledOnce();
        expect(recording.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
        expect(rebuild).not.toHaveBeenCalled();
    });
});

describe('workflow action registration contract', () => {
    it('[WC-6.1] registers every supported workflow trigger exactly once', () => {
        const harness = makeSetter();

        harness.setter.set();

        expect(
            [
                harness.epgUpdateEvent.setUpdated,
                harness.encodeEvent.setFinishEncode,
                harness.ruleEvent.setAdded,
                harness.ruleEvent.setUpdated,
                harness.ruleEvent.setEnabled,
                harness.ruleEvent.setDisabled,
                harness.ruleEvent.setDeleted,
                harness.reserveEvent.setUpdated,
                harness.recordingEvent.setStartPrepRecording,
                harness.recordingEvent.setCancelPrepRecording,
                harness.recordingEvent.setPrepRecordingFailed,
                harness.recordingEvent.setStartRecording,
                harness.recordingEvent.setRecordingFailed,
                harness.recordingEvent.setRecordingRetryOver,
                harness.recordingEvent.setFinishRecording,
                harness.recordingEvent.setEventRelay,
                harness.thumbnailEvent.setAdded,
                harness.thumbnailEvent.setDeleted,
                harness.recordedEvent.setDeleteRecorded,
                harness.recordedEvent.setUpdateVideoFileSize,
                harness.recordedEvent.setAddVideoFile,
                harness.recordedEvent.setCreateNewRecorded,
                harness.recordedEvent.setAddUploadedVideoFile,
                harness.recordedEvent.setDeleteVideoFile,
                harness.recordedEvent.setDropLogFileChanged,
                harness.recordedEvent.setChangeProtect,
                harness.recordedTagEvent.setCreated,
                harness.recordedTagEvent.setUpdated,
                harness.recordedTagEvent.setRelated,
                harness.recordedTagEvent.setDeleted,
                harness.recordedTagEvent.setDeletedRelation,
            ].map(register => register.mock.calls),
        ).toEqual(Array.from({ length: 31 }, () => [[expect.any(Function)]]));
    });
});

// WC-6.1 governs the screen-refetch handoff only. Per design.md:916, screen notification is a
// single kind, no-payload `notifyClient()`; "selecting the notification type" is really a binary
// selection of whether to call it. `ipc.setEncode()` is a different concern (Requirement 3 AC4 —
// requesting the encode work itself, design.md's "Encode 受付" row, design.md:581/908) and is
// already covered by recording-finish.spec.test.ts's `[PRIMARY WC-3.3][PRIMARY WC-3.4]` test
// ("starts Thumbnail and at most the three existing Encode slots for %s", line 70), so it is out
// of scope for this describe block and is not asserted here.
type ScreenRefetchDestination = 'none' | 'notify';

interface DestinationCase {
    readonly destination: ScreenRefetchDestination;
    readonly invoke: (harness: ReturnType<typeof makeSetter>) => unknown;
    readonly key: string;
}

type MockLike = { mock: { calls: unknown[][] } };

// The 8 callback ports `makeSetter()` builds via its internal `callbackPort(methods)` helper (see
// `_harness.ts`) -- one per domain event dependency `EventSetter` receives. Each port's own
// enumerable keys, at runtime, are exactly the method names that dependency currently exposes, so
// listing the 8 port names here (a fixed, small set tied to `EventSetter`'s constructor shape) is
// enough: no per-trigger method name is hand-copied anywhere below. This is what closes the gap a
// hand-copied 31-entry list could not: adding a new method to both an existing port (e.g.
// `ruleEvent`) and the corresponding `EventSetter.set()` registration surfaces immediately as a
// new `${family}.${method}` key coming out of `Object.entries`, which the table below does not
// name and so the set-equality check catches, without anyone updating a parallel hand-written list.
const registrationFamilies: readonly { readonly family: string; readonly port: (harness: ReturnType<typeof makeSetter>) => Record<string, MockLike> }[] = [
    { family: 'epgUpdateEvent', port: h => h.epgUpdateEvent },
    { family: 'encodeEvent', port: h => h.encodeEvent },
    { family: 'ruleEvent', port: h => h.ruleEvent },
    { family: 'reserveEvent', port: h => h.reserveEvent },
    { family: 'recordingEvent', port: h => h.recordingEvent },
    { family: 'recordedTagEvent', port: h => h.recordedTagEvent },
    { family: 'recordedEvent', port: h => h.recordedEvent },
    { family: 'thumbnailEvent', port: h => h.thumbnailEvent },
];

// Every `${family}.${method}` key that was actually called exactly once on `harness`, discovered
// by enumerating each port's own keys at runtime rather than from a fixed method-name list.
const actuallyRegisteredKeys = (harness: ReturnType<typeof makeSetter>): string[] =>
    registrationFamilies.flatMap(({ family, port }) =>
        Object.entries(port(harness))
            .filter(([, mock]) => mock.mock.calls.length === 1)
            .map(([method]) => `${family}.${method}`),
    );

// Reserve/Recorded fixtures kept minimal so each trigger below runs exactly one code path.
const destinationReserve = {
    encodeDirectory1: null,
    encodeDirectory2: null,
    encodeDirectory3: null,
    encodeMode1: null,
    encodeMode2: null,
    encodeMode3: null,
    encodeParentDirectoryName1: null,
    encodeParentDirectoryName2: null,
    encodeParentDirectoryName3: null,
    id: 201,
    isDeleteOriginalAfterEncode: false,
    isEventRelay: false,
    ruleId: null,
    tags: null,
};

// [WC-6.1] One row per registered workflow trigger, keyed by the same `${family}.${method}`
// identity `actuallyRegisteredKeys` derives from the harness ports. `destination` is whether
// `ipc.notifyClient()` is the selected screen-refetch handoff for this confirmed change:
//   - 'notify' : matched against the most specific Acceptance Criteria available (Requirement 2
//                AC4/AC5/AC9/AC10, Requirement 3 AC8, Requirement 4 AC6) or, where noted per-row
//                below, an interpretation of a narrower AC or a characterization of current
//                behavior with no AC naming this exact trigger.
//   - 'none'   : no AC calls for a screen refetch from this trigger. Where noted per-row below,
//                this only characterizes current behavior (the absence of a screen refetch is not
//                itself mandated by an AC) rather than citing an AC that forbids it.
const destinationCases: readonly DestinationCase[] = [
    {
        destination: 'none',
        invoke: harness => {
            // Characterization of current behavior: Requirement 1 AC1-AC5 describe the follow-up
            // actions for this EPG-update trigger itself (history cleanup, reservation update);
            // AC6-AC9 are separate triggers (Rule add/change/enable/disable/delete). None of
            // AC1-AC5 mandates a screen refetch for the raw EPG-update trigger; the screen refetch
            // obligation for its downstream effects is carried by the rule/reservation rows below.
            // Default harness historyCleanup() returns undefined; EventSetter chains `.catch()`
            // onto it, so this trigger needs a Promise-returning mock to run at all.
            harness.recordedManage.historyCleanup.mockImplementation(() => Promise.resolve());
            return harness.callbacks.epg.setUpdated();
        },
        key: 'epgUpdateEvent.setUpdated',
    },
    {
        // Interpretation: Requirement 1 AC10 names only "変更" (updated) for the screen refetch;
        // added/enabled/disabled/deleted are not individually named there. Grouped here under the
        // same 'notify' destination as an interpretation of AC10 that treats "変更" as covering
        // all rule state changes, consistent with WC-6.1's general "確定した状態変化" clause.
        destination: 'notify',
        invoke: harness => harness.callbacks.rule.setAdded(41),
        key: 'ruleEvent.setAdded',
    },
    {
        // Direct match: Requirement 1 AC10 names this case ("変更されたとき") explicitly.
        destination: 'notify',
        invoke: harness => harness.callbacks.rule.setUpdated(42),
        key: 'ruleEvent.setUpdated',
    },
    {
        // Interpretation of Requirement 1 AC10's "変更" — see setAdded above.
        destination: 'notify',
        invoke: harness => harness.callbacks.rule.setEnabled(43),
        key: 'ruleEvent.setEnabled',
    },
    {
        // Interpretation of Requirement 1 AC10's "変更" — see setAdded above.
        destination: 'notify',
        invoke: harness => harness.callbacks.rule.setDisabled(44),
        key: 'ruleEvent.setDisabled',
    },
    {
        // Interpretation of Requirement 1 AC10's "変更" — see setAdded above.
        destination: 'notify',
        invoke: harness => harness.callbacks.rule.setDeleted(45),
        key: 'ruleEvent.setDeleted',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.reserve.setUpdated({ delete: [], insert: [], isSuppressLog: false, update: [] }),
        key: 'reserveEvent.setUpdated',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recording.setStartPrepRecording({ ...destinationReserve, id: 51 }),
        key: 'recordingEvent.setStartPrepRecording',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recording.setCancelPrepRecording({ ...destinationReserve, id: 52 }),
        key: 'recordingEvent.setCancelPrepRecording',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recording.setPrepRecordingFailed({ ...destinationReserve, id: 53 }),
        key: 'recordingEvent.setPrepRecordingFailed',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setStartRecording({ ...destinationReserve, id: 54 }, { id: 341, videoFiles: [] }),
        key: 'recordingEvent.setStartRecording',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setRecordingFailed({ ...destinationReserve, id: 55 }, { id: 342 }),
        key: 'recordingEvent.setRecordingFailed',
    },
    {
        // Characterization of current behavior: Requirement 2 AC6 mandates only a reservation
        // cancellation for retry-over; unlike AC5 (prep start/cancel/fail), it names no screen
        // refetch for this trigger. Not asserting that AC6 forbids one.
        destination: 'none',
        invoke: harness => harness.callbacks.recording.setRecordingRetryOver({ ...destinationReserve, id: 56 }),
        key: 'recordingEvent.setRecordingRetryOver',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setFinishRecording(
                { ...destinationReserve, id: 57 },
                { id: 343, videoFiles: [] },
                false,
            ),
        key: 'recordingEvent.setFinishRecording',
    },
    {
        // Characterization of current behavior: Requirement 4 AC1-AC3 describe relay-candidate
        // processing (reservation add per candidate, continue past a per-candidate failure) but
        // name no screen refetch for this trigger itself. Not asserting the ACs forbid one. See
        // the "not gated by an unrelated branch" describe below: this destination is also proven
        // with a non-empty candidate list, since a fixture of `[]` alone cannot distinguish
        // "never notifies" from "only notifies when there is a candidate".
        destination: 'none',
        invoke: harness => harness.callbacks.recording.setEventRelay([]),
        key: 'recordingEvent.setEventRelay',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.thumbnail.setAdded(61, 62),
        key: 'thumbnailEvent.setAdded',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.thumbnail.setDeleted(),
        key: 'thumbnailEvent.setDeleted',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recordedEvent.setDeleteRecorded({ id: 344, isRecording: false, reserveId: null }),
        key: 'recordedEvent.setDeleteRecorded',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setUpdateVideoFileSize(),
        key: 'recordedEvent.setUpdateVideoFileSize',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setAddVideoFile(),
        key: 'recordedEvent.setAddVideoFile',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setCreateNewRecorded(),
        key: 'recordedEvent.setCreateNewRecorded',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setAddUploadedVideoFile(63, false),
        key: 'recordedEvent.setAddUploadedVideoFile',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setDeleteVideoFile(),
        key: 'recordedEvent.setDeleteVideoFile',
    },
    {
        // Characterization of current behavior: Requirement 4 AC6 enumerates 録画済み番組/録画
        // ファイル/保護状態/タグ/ルール関連付け/サムネイル; drop-log is not named in that list. Not
        // asserting an AC requires this notification, only recording that it currently happens.
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setDropLogFileChanged(),
        key: 'recordedEvent.setDropLogFileChanged',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setChangeProtect(64, true),
        key: 'recordedEvent.setChangeProtect',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedTag.setCreated({ id: 71 }),
        key: 'recordedTagEvent.setCreated',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedTag.setUpdated(72),
        key: 'recordedTagEvent.setUpdated',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedTag.setRelated(73, 74),
        key: 'recordedTagEvent.setRelated',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedTag.setDeleted(75),
        key: 'recordedTagEvent.setDeleted',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedTag.setDeletedRelation(76, 77),
        key: 'recordedTagEvent.setDeletedRelation',
    },
    {
        // Requirement 4 AC7 names only "エンコード完了の設定済み外部コマンドを選択する" for this
        // trigger (no screen refetch). design.md:908's trigger table and design.md:581 both list
        // only "Encode 完了 Hook" for OperatorEncodeEvent, and the existing
        // `[PRIMARY WC-6.2][PRIMARY WC-6.4]` test in recorded-change.spec.test.ts ("records a
        // rejected encode-completion Hook without selecting a refresh handoff", line 102) already
        // asserts no refresh handoff is selected here.
        destination: 'none',
        invoke: harness =>
            harness.callbacks.encode.setFinishEncode({ mode: 'synthetic-mode', recordedId: 81, videoFileId: null }),
        key: 'encodeEvent.setFinishEncode',
    },
];

describe('screen refetch destination selection per trigger', () => {
    it('[WC-6.1] matches the triggers EventSetter actually registered, with no duplicates', () => {
        const harness = makeSetter();
        harness.setter.set();

        const registeredKeys = actuallyRegisteredKeys(harness).sort();
        const tableKeys = destinationCases.map(({ key }) => key);

        expect(new Set(tableKeys).size, 'destinationCases must not name the same trigger twice').toBe(
            tableKeys.length,
        );
        expect(tableKeys.slice().sort()).toEqual(registeredKeys);
    });

    it.each(destinationCases)(
        '[PRIMARY WC-6.1][WC-6.1] $key selects destination "$destination"',
        async ({ destination, invoke }) => {
            const harness = makeSetter();
            harness.setter.set();

            await invoke(harness);
            await flush();

            if (destination === 'notify') {
                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            } else {
                expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
            }
        },
    );
});

interface BranchCoverageCase {
    readonly destination: ScreenRefetchDestination;
    readonly invoke: (harness: ReturnType<typeof makeSetter>) => unknown;
    readonly key: string;
    readonly variant: string;
}

// [WC-6.1] EventSetter.ts branches, per trigger, on a field of the callback's own arguments
// before it decides whether to call `ipc.notifyClient()` (or, for setEventRelay, at all). A
// fixture that always takes the same side of one of those branches cannot distinguish "this
// destination holds regardless of the branch" from "this destination only holds because the
// fixture always takes this side" -- e.g. a mutant that moves the notifyClient() call inside one
// of these branches, or that adds a notifyClient() call to setEventRelay gated on the candidate
// list being non-empty, would not be caught by a single-sided fixture. Each row below pairs both
// sides of one such branch for that trigger and asserts the same destination holds for both,
// which is what the current source does (notifyClient is unconditional, or for setEventRelay
// never called, regardless of which side is taken). This is not exhaustive over every branch a
// trigger has: e.g. setFinishRecording also branches on `reserve.ruleId`/`isEventRelay` (which of
// the reservation cleanup calls fires) and independently on each of its three Encode slots (which
// `ipc.setEncode()` calls fire) -- neither is covered here because neither one is anywhere near
// the (unconditional) notifyClient() call this describe block checks, unlike the two branches
// (isNeedDeleteReservation, videoFiles presence) that rows below do exercise for this trigger.
const branchCoverageCases: readonly BranchCoverageCase[] = [
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setStartRecording({ ...destinationReserve, id: 54 }, { id: 341, videoFiles: [] }),
        key: 'recordingEvent.setStartRecording',
        variant: 'reserve.tags is null (no Tag relation requested)',
    },
    {
        destination: 'notify',
        invoke: harness => {
            harness.recordedTagManage.setRelation.mockImplementation(() => Promise.resolve());
            return harness.callbacks.recording.setStartRecording(
                { ...destinationReserve, id: 54, tags: '[5]' },
                { id: 341, videoFiles: [] },
            );
        },
        key: 'recordingEvent.setStartRecording',
        variant: 'reserve.tags names a Tag (Tag relation requested)',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recording.setRecordingFailed({ ...destinationReserve, id: 55 }, null),
        key: 'recordingEvent.setRecordingFailed',
        variant: 'recorded is null (no Hook selected)',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setRecordingFailed({ ...destinationReserve, id: 55 }, { id: 342 }),
        key: 'recordingEvent.setRecordingFailed',
        variant: 'recorded exists (Hook selected)',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setFinishRecording(
                { ...destinationReserve, id: 57 },
                { id: 343, videoFiles: [] },
                false,
            ),
        key: 'recordingEvent.setFinishRecording',
        variant: 'no reservation deletion, no video file (Thumbnail/Encode block skipped)',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recording.setFinishRecording(
                { ...destinationReserve, id: 57 },
                { id: 343, videoFiles: [{ id: 1 }] },
                true,
            ),
        key: 'recordingEvent.setFinishRecording',
        variant: 'reservation deletion requested, video file present (Thumbnail/Encode block entered)',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recordedEvent.setDeleteRecorded({ id: 344, isRecording: false, reserveId: null }),
        key: 'recordedEvent.setDeleteRecorded',
        variant: 'not recording (no reservation cancellation)',
    },
    {
        destination: 'notify',
        invoke: harness =>
            harness.callbacks.recordedEvent.setDeleteRecorded({ id: 344, isRecording: true, reserveId: 901 }),
        key: 'recordedEvent.setDeleteRecorded',
        variant: 'recording with a reserveId (reservation cancellation requested)',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setAddUploadedVideoFile(63, false),
        key: 'recordedEvent.setAddUploadedVideoFile',
        variant: 'thumbnail not requested',
    },
    {
        destination: 'notify',
        invoke: harness => harness.callbacks.recordedEvent.setAddUploadedVideoFile(63, true),
        key: 'recordedEvent.setAddUploadedVideoFile',
        variant: 'thumbnail requested',
    },
    {
        destination: 'none',
        invoke: harness => harness.callbacks.recording.setEventRelay([]),
        key: 'recordingEvent.setEventRelay',
        variant: 'no relay candidates',
    },
    {
        destination: 'none',
        invoke: harness =>
            harness.callbacks.recording.setEventRelay([{ parentReserve: { id: 57 }, programId: 502 }]),
        key: 'recordingEvent.setEventRelay',
        variant: 'one relay candidate',
    },
];

describe('screen refetch destination is not gated by an unrelated branch', () => {
    it.each(branchCoverageCases)(
        '[WC-6.1] $key ($variant) still selects destination "$destination"',
        async ({ destination, invoke }) => {
            const harness = makeSetter();
            harness.setter.set();

            await invoke(harness);
            await flush();

            if (destination === 'notify') {
                expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            } else {
                expect(harness.ipc.notifyClient).not.toHaveBeenCalled();
            }
        },
    );
});

describe('screen notification and external command boundary contract', () => {
    it('[PRIMARY WC-6.3][WC-6.3] sends one bare, unaggregated notification per confirmed change and never resends after a rejected send', async () => {
        const harness = makeSetter();
        const failure = new Error('synthetic notification channel failure');
        harness.ipc.notifyClient.mockImplementation(() => Promise.reject(failure));
        harness.setter.set();

        expect(harness.callbacks.recordedEvent.setChangeProtect(8, true)).toBeUndefined();
        expect(harness.callbacks.recordedEvent.setChangeProtect(9, false)).toBeUndefined();
        await flush();

        // Two confirmed protect changes each produce their own bare (zero-argument) notification
        // request instead of being merged into one combined payload (no aggregation), and neither
        // rejection causes a second attempt for the same change (no resend/retry).
        expect(harness.ipc.notifyClient.mock.calls).toEqual([[], []]);
        expect(harness.ipc.setEncode).not.toHaveBeenCalled();
        expect(harness.logger.system.error.mock.calls).toEqual([[failure], [failure]]);
    });

    it('[PRIMARY WC-6.6][WC-6.6] completes the recording-finish handoff and its notification without waiting for the external command to settle', async () => {
        const harness = makeSetter();
        const pending = makeDeferred();
        harness.externalCommandManage.addRecordingFinishCmd.mockImplementation(() => pending.promise);
        harness.setter.set();
        const reserve = {
            encodeMode1: null,
            encodeMode2: null,
            encodeMode3: null,
            id: 91,
            isEventRelay: false,
            ruleId: null,
            tags: null,
        };
        const recorded = { id: 92, videoFiles: [] };

        // The handoff settles even though the external command it fires never does: its own
        // completion (and the reservation cancellation and screen notification beside it) are not
        // gated on the external command's acceptance, start, or end.
        await expect(harness.callbacks.recording.setFinishRecording(reserve, recorded, true)).resolves.toBeUndefined();

        expect(harness.externalCommandManage.addRecordingFinishCmd.mock.calls).toEqual([[recorded]]);
        expect(harness.reservationManage.cancel.mock.calls).toEqual([[91]]);
        expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();

        pending.resolve();
        await flush();
    });
});
