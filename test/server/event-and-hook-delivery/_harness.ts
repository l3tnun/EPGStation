import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;

export const Reserve = load<new () => Record<string, any>>('db', 'entities', 'Reserve.js');
export const Recorded = load<new () => Record<string, any>>('db', 'entities', 'Recorded.js');
export const EPGUpdateEvent = load<new (...args: any[]) => any>('model', 'event', 'EPGUpdateEvent.js');
export const EncodeEvent = load<new (...args: any[]) => any>('model', 'event', 'EncodeEvent.js');
export const OperatorEncodeEvent = load<new (...args: any[]) => any>('model', 'event', 'OperatorEncodeEvent.js');
export const OperatorEncodeEventBinding = load<new (...args: any[]) => any>(
    'model',
    'event',
    'OperatorEncodeEventBinding.js',
);
export const RecordedEvent = load<new (...args: any[]) => any>('model', 'event', 'RecordedEvent.js');
export const RecordedTagEvent = load<new (...args: any[]) => any>('model', 'event', 'RecordedTagEvent.js');
export const ReserveEvent = load<new (...args: any[]) => any>('model', 'event', 'ReserveEvent.js');
export const RecordingEvent = load<new (...args: any[]) => any>('model', 'event', 'RecordingEvent.js');
export const RuleEvent = load<new (...args: any[]) => any>('model', 'event', 'RuleEvent.js');
export const ThumbnailEvent = load<new (...args: any[]) => any>('model', 'event', 'ThumbnailEvent.js');
export const EventSetter = load<new (...args: any[]) => any>('model', 'event', 'EventSetter.js');
export const ExternalCommandManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'externalCommand',
    'ExternalCommandManageModel.js',
);
export const ProcessUtil = load<Record<string, any>>('util', 'ProcessUtil.js');
export const PromiseQueue = load<new () => { add<T>(job: () => Promise<T>): Promise<T> }>('model', 'PromiseQueue.js');

export const makeLogger = () => ({
    system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    stream: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

export const makeReserve = (overrides: Record<string, unknown> = {}) =>
    Object.assign(new Reserve(), {
        id: 11,
        ruleId: null,
        programId: 101,
        channelId: 21,
        channel: 'synthetic-channel',
        channelType: 'GR',
        startAt: 1_000,
        endAt: 2_000,
        name: 'synthetic-program',
        halfWidthName: 'synthetic-program',
        tags: null,
        isEventRelay: false,
        encodeMode1: null,
        encodeMode2: null,
        encodeMode3: null,
        ...overrides,
    });

export const makeRecorded = (overrides: Record<string, unknown> = {}) =>
    Object.assign(new Recorded(), {
        id: 31,
        reserveId: 11,
        programId: 101,
        channelId: 21,
        startAt: 1_000,
        endAt: 2_000,
        name: 'synthetic-program',
        halfWidthName: 'synthetic-program',
        isRecording: false,
        videoFiles: [],
        ...overrides,
    });

export const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

export const flushImmediate = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const callbackPort = (methods: readonly string[]) => {
    const callbacks: Record<string, (...args: any[]) => unknown> = {};
    const port = Object.fromEntries(
        methods.map(method => [
            method,
            vi.fn((callback: (...args: any[]) => unknown) => (callbacks[method] = callback)),
        ]),
    );
    return { callbacks, port };
};

export const makeSetter = (overrides: Record<string, any> = {}) => {
    const logger = overrides.logger ?? makeLogger();
    const epg = callbackPort(['setUpdated']);
    const encode = callbackPort(['setFinishEncode']);
    const rule = callbackPort(['setAdded', 'setUpdated', 'setEnabled', 'setDisabled', 'setDeleted']);
    const reserve = callbackPort(['setUpdated']);
    const recording = callbackPort([
        'setStartPrepRecording',
        'setCancelPrepRecording',
        'setPrepRecordingFailed',
        'setStartRecording',
        'setRecordingFailed',
        'setRecordingRetryOver',
        'setFinishRecording',
        'setEventRelay',
    ]);
    const recordedTag = callbackPort(['setCreated', 'setUpdated', 'setRelated', 'setDeleted', 'setDeletedRelation']);
    const recorded = callbackPort([
        'setDeleteRecorded',
        'setUpdateVideoFileSize',
        'setAddVideoFile',
        'setCreateNewRecorded',
        'setAddUploadedVideoFile',
        'setDeleteVideoFile',
        'setDropLogFileChanged',
        'setChangeProtect',
    ]);
    const thumbnail = callbackPort(['setAdded', 'setDeleted']);
    const reservationManage = {
        updateAll: vi.fn(),
        updateRule: vi.fn(),
        cancel: vi.fn(async () => undefined),
        addEventRelay: vi.fn(),
    };
    const recordingManage = { acceptMutation: vi.fn(), update: vi.fn(), hasReserve: vi.fn(() => false) };
    const externalCommandManage = {
        addUpdateReseves: vi.fn(),
        addRecordingPrepStartCmd: vi.fn(),
        addRecordingPrepRecFailedCmd: vi.fn(),
        addRecordingStartCmd: vi.fn(),
        addRecordingFailedCmd: vi.fn(),
        addRecordingFinishCmd: vi.fn(),
        addEncodingFinishCmd: vi.fn(),
    };
    const ipc = { notifyClient: vi.fn(), setEncode: vi.fn() };
    const dependencies = {
        logger,
        epgUpdateEvent: epg.port,
        encodeEvent: encode.port,
        ruleEvent: rule.port,
        reserveEvent: reserve.port,
        recordingEvent: recording.port,
        recordedTagEvent: recordedTag.port,
        recordedEvent: recorded.port,
        thumbnailEvent: thumbnail.port,
        reservationManage,
        recordingManage,
        recordedManage: { historyCleanup: vi.fn(), removeRuleId: vi.fn() },
        recordedTagManage: { setRelation: vi.fn() },
        thumbnailManage: { add: vi.fn() },
        externalCommandManage,
        ipc,
        ...overrides,
    };
    const setter = new EventSetter(
        { getLogger: () => logger },
        dependencies.epgUpdateEvent,
        dependencies.encodeEvent,
        dependencies.ruleEvent,
        dependencies.reserveEvent,
        dependencies.recordingEvent,
        dependencies.recordedTagEvent,
        dependencies.recordedEvent,
        dependencies.thumbnailEvent,
        dependencies.reservationManage,
        dependencies.recordingManage,
        dependencies.recordedManage,
        dependencies.recordedTagManage,
        dependencies.thumbnailManage,
        dependencies.externalCommandManage,
        dependencies.ipc,
        { getConfig: () => ({ recorded: [{ name: 'synthetic-root' }] }) },
        { setup: vi.fn() },
    );
    return {
        setter,
        callbacks: {
            epg: epg.callbacks,
            encode: encode.callbacks,
            rule: rule.callbacks,
            reserve: reserve.callbacks,
            recording: recording.callbacks,
            recordedTag: recordedTag.callbacks,
            recordedEvent: recorded.callbacks,
            thumbnail: thumbnail.callbacks,
        },
        ...dependencies,
    };
};
