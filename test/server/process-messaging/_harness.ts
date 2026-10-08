import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const load = <T>(...segments: string[]): T => (require(join(snapshot, ...segments)) as { default: T }).default;

export const IPCServer = load<new (...args: any[]) => any>('model', 'ipc', 'IPCServer.js');
export const IPCClient = load<new (...args: any[]) => any>('model', 'ipc', 'IPCClient.js');

export interface SyntheticChild extends EventEmitter {
    send: ReturnType<typeof vi.fn>;
}

export const makeChild = (): SyntheticChild => {
    const child = new EventEmitter() as SyntheticChild;
    child.send = vi.fn();
    return child;
};

interface MakeServerOptions {
    readonly registerEncodeSink?: boolean;
    readonly recordedUploadAdoption?: {
        adopt(filePath: string): Promise<string>;
    };
}

const unavailableRecordedUploadAdoption = {
    adopt: async (): Promise<string> => {
        throw new Error('UploadAdoptionNotComposed');
    },
};

export const makeServer = ({
    recordedUploadAdoption = unavailableRecordedUploadAdoption,
    registerEncodeSink = true,
}: MakeServerOptions = {}) => {
    const port = (methods: readonly string[]) =>
        Object.fromEntries(methods.map(method => [method, vi.fn(async () => undefined)]));
    const reservation = port([
        'getBroadcastStatus',
        'add',
        'update',
        'updateRule',
        'updateAll',
        'cancel',
        'removeSkip',
        'removeOverlap',
        'edit',
    ]);
    const recorded = port([
        'updateVideoFileSize',
        'addVideoFile',
        'addUploadedVideoFile',
        'createNewRecorded',
        'deleteVideoFile',
        'changeProtect',
        'videoFileCleanup',
        'dropLogFileCleanup',
    ]);
    Object.defineProperties(recorded, {
        deletePrepared: {
            enumerable: false,
            value: vi.fn(async () => undefined),
        },
        prepareUserDeletion: {
            enumerable: false,
            value: vi.fn(async () => {
                const userDeletionToken = {};
                return { isRecording: false, reserveId: null, status: 'prepared', token: userDeletionToken };
            }),
        },
        deletePreparedVideoFile: {
            enumerable: false,
            value: vi.fn(async () => ({ status: 'video-file-deleted' })),
        },
        prepareVideoFileDeletion: {
            enumerable: false,
            value: vi.fn(async () => {
                const videoFileDeletionToken = {};
                return { status: 'prepared', token: videoFileDeletionToken };
            }),
        },
    });
    const recordedTag = port(['create', 'update', 'setRelation', 'delete', 'deleteRelation']);
    const recording = {
        cancelForDeletion: vi.fn(async () => undefined),
        hasReserve: vi.fn(() => false),
        resetTimer: vi.fn(),
    };
    const rule = port(['add', 'update', 'enable', 'disable', 'delete']);
    const thumbnail = { ...port(['regenerate', 'fileCleanup', 'delete']), add: vi.fn() };
    const encode = { emitFinishEncode: vi.fn() };
    const domains = { encode, recorded, recordedTag, recording, reservation, rule, thumbnail };
    const logError = vi.fn();
    const logger = {
        getLogger: () => ({
            access: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
            encode: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
            stream: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
            system: { error: logError, fatal: vi.fn(), info: vi.fn() },
        }),
    };
    const server = new IPCServer(
        domains.reservation,
        domains.recorded,
        domains.recordedTag,
        domains.recording,
        domains.rule,
        domains.thumbnail,
        logger,
        recordedUploadAdoption,
    );
    const registerSink = (sink: { accept(info: unknown): unknown }): void => {
        server.encodeCompletionSinkRegistrationPort.register(sink);
    };
    if (registerEncodeSink) registerSink({ accept: domains.encode.emitFinishEncode });
    return { domains, logError, registerSink, server };
};

export const flushImmediate = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
export const flushNextTick = (): Promise<void> => new Promise(resolve => process.nextTick(resolve));

export interface ClientHarness {
    readonly client: any;
    readonly encodePush: ReturnType<typeof vi.fn>;
    readonly logError: ReturnType<typeof vi.fn>;
    readonly logFatal: ReturnType<typeof vi.fn>;
    readonly logInfo: ReturnType<typeof vi.fn>;
    readonly notifyClient: ReturnType<typeof vi.fn>;
    readonly send: ReturnType<typeof vi.fn>;
    receive(message: unknown): Promise<void>;
    cleanup(): void;
}

export const makeClient = (idAllocationSeams?: unknown): ClientHarness => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'send');
    const listeners = new Set(process.listeners('message'));
    const send = vi.fn();
    Object.defineProperty(process, 'send', { configurable: true, value: send, writable: true });
    const notifyClient = vi.fn();
    const encodePush = vi.fn();
    const logError = vi.fn();
    const logFatal = vi.fn();
    const logInfo = vi.fn();
    const client = new IPCClient(
        { getLogger: () => ({ system: { error: logError, fatal: logFatal, info: logInfo } }) },
        { notifyClient },
        { push: encodePush },
        idAllocationSeams,
    );
    const clientListeners = process.listeners('message').filter(listener => !listeners.has(listener));
    return {
        client,
        encodePush,
        logError,
        logFatal,
        logInfo,
        notifyClient,
        receive: async message => {
            await Promise.all(clientListeners.map(listener => listener(message)));
        },
        send,
        cleanup: () => {
            for (const listener of process.listeners('message')) {
                if (!listeners.has(listener)) process.removeListener('message', listener);
            }
            if (descriptor === undefined) delete process.send;
            else Object.defineProperty(process, 'send', descriptor);
        },
    };
};
