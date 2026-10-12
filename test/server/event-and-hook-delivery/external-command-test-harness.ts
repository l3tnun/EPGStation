import { EventEmitter } from 'node:events';
import { isAbsolute, join } from 'node:path';
import { vi } from 'vitest';
import { flushImmediate, makeLogger, makeRecorded, makeReserve, ProcessUtil, PromiseQueue } from './_harness';

/**
 * The compiled dist is ES modules (`import { spawn } from 'child_process'`), a static binding that a
 * plain `require('child_process').spawn = stub` mutation never reaches: ESM import resolution for this
 * suite runs through the test runner's own module graph, not Node's CommonJS loader, so a CJS-side
 * mutation of the shared builtin object is invisible to it. `vi.doMock` + `vi.resetModules` + a dynamic
 * `import()` of the compiled model is the mechanism that actually lands a replacement `spawn` in the
 * model's binding (mirrors `application-runtime/_runtime-harness.ts#evaluateCompiledRuntime`).
 *
 * `ProcessUtil.js` is mocked too -- not to change its behavior, but to force the compiled model's
 * internal `import ProcessUtil from '../../../util/ProcessUtil.js'` to resolve to the exact same object
 * this suite's tests already hold (via `_harness.ts`'s plain `require`), so `vi.spyOn(ProcessUtil, ...)`
 * keeps affecting the model's real calls.
 */
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined || !isAbsolute(snapshot)) throw new Error('The compiled server snapshot is required');
const modelPath = join(snapshot, 'model', 'operator', 'externalCommand', 'ExternalCommandManageModel.js');
const processUtilPath = join(snapshot, 'util', 'ProcessUtil.js');

let ExternalCommandManageModelCtor: (new (...args: any[]) => any) | undefined;
const children = new Set<DeferredCommandChild>();

export const processStubs = { spawn: vi.fn() };

export class DeferredCommandChild extends EventEmitter {
    public exitCode: number | null = null;
    public readonly kill = vi.fn();
    public readonly pid: number;
    private didReachTerminal = false;
    private readonly terminal: () => void;

    constructor(pid: number, terminal: () => void = () => undefined) {
        super();
        this.pid = pid;
        this.terminal = terminal;
        children.add(this);
    }

    /**
     * `error` event を出す。`spawnFailure` は起動に失敗した子を表し、本物の ChildProcess と同じく
     * `exitCode` が負の errno（ENOENT なら -2）になり、`exit` event は出ない。
     */
    public emitError(error: Error, option: { spawnFailure?: boolean } = {}): void {
        if (option.spawnFailure === true) this.exitCode = -2;
        this.reachTerminal();
        this.emit('error', error);
    }

    public emitExit(exitCode: number): void {
        this.exitCode = exitCode;
        this.reachTerminal();
        this.emit('exit', exitCode, null);
    }

    private reachTerminal(): void {
        if (this.didReachTerminal) return;
        this.didReachTerminal = true;
        this.terminal();
    }
}

interface HookFamily {
    readonly configKey: string;
    readonly label: string;
    readonly makePayload: () => any;
    readonly invoke: (model: any, payload: any) => unknown;
}

export const hookFamilies: readonly HookFamily[] = [
    {
        configKey: 'reserveNewAddtionCommand',
        invoke: (model, payload) => model.addUpdateReseves(payload),
        label: 'reservation-insert',
        makePayload: () => ({ insert: [makeReserve({ id: 111 })], isSuppressLog: false }),
    },
    {
        configKey: 'reserveUpdateCommand',
        invoke: (model, payload) => model.addUpdateReseves(payload),
        label: 'reservation-update',
        makePayload: () => ({ update: [makeReserve({ id: 112 })], isSuppressLog: false }),
    },
    {
        configKey: 'reservedeletedCommand',
        invoke: (model, payload) => model.addUpdateReseves(payload),
        label: 'reservation-delete',
        makePayload: () => ({ delete: [makeReserve({ id: 113 })], isSuppressLog: false }),
    },
    {
        configKey: 'recordingPreStartCommand',
        invoke: (model, payload) => model.addRecordingPrepStartCmd(payload),
        label: 'recording-preparation-start',
        makePayload: () => makeReserve({ id: 114 }),
    },
    {
        configKey: 'recordingPrepRecFailedCommand',
        invoke: (model, payload) => model.addRecordingPrepRecFailedCmd(payload),
        label: 'recording-preparation-failed',
        makePayload: () => makeReserve({ id: 115 }),
    },
    {
        configKey: 'recordingStartCommand',
        invoke: (model, payload) => model.addRecordingStartCmd(payload),
        label: 'recording-start',
        makePayload: () => makeRecorded({ id: 116, videoFiles: [{ id: 216 }] }),
    },
    {
        configKey: 'recordingFailedCommand',
        invoke: (model, payload) => model.addRecordingFailedCmd(payload),
        label: 'recording-failed',
        makePayload: () => makeRecorded({ id: 117, videoFiles: [{ id: 217 }] }),
    },
    {
        configKey: 'recordingFinishCommand',
        invoke: (model, payload) => model.addRecordingFinishCmd(payload),
        label: 'recording-finish',
        makePayload: () => makeRecorded({ id: 118, videoFiles: [{ id: 218 }] }),
    },
    {
        configKey: 'encodingFinishCommand',
        invoke: (model, payload) => model.addEncodingFinishCmd(payload),
        label: 'encoding-finish',
        makePayload: () => ({ mode: 'synthetic-mode', recordedId: 119, videoFileId: 219 }),
    },
];

export const commandFor = (label: string): string => `${process.execPath} ${label}`;

/**
 * The compiled `ExternalCommandManageModel` reloaded through `installSpawnStub()`'s `vi.doMock` +
 * dynamic `import()`, so its internal `spawn(...)` calls resolve to `processStubs.spawn`. Callers that
 * build their own harness around the model (rather than using `makeCommandQueueHarness`) and still need
 * a real `spawn` call to reach `processStubs.spawn` must construct the model from this constructor, not
 * from `_harness.ts`'s statically `require`d `ExternalCommandManageModel` (whose `spawn` import is bound
 * to the real, unmocked `child_process`).
 */
export const getExternalCommandManageModelCtor = (): new (...args: any[]) => any => {
    if (ExternalCommandManageModelCtor === undefined) {
        throw new Error('installSpawnStub() must resolve before getExternalCommandManageModelCtor() is used');
    }
    return ExternalCommandManageModelCtor;
};

export const makeCommandQueueHarness = (configOverrides: Record<string, unknown> = {}) => {
    const config = {
        ...Object.fromEntries(hookFamilies.map(family => [family.configKey, commandFor(family.label)])),
        dropLog: 'synthetic-drop-root',
        hookCommandMaxPending: 64,
        hookCommandTimeoutMs: 300_000,
        ...configOverrides,
    };
    const getConfig = vi.fn(() => ({ ...config }));
    const logger = makeLogger();
    const queue = new PromiseQueue();
    const queueAdd = vi.spyOn(queue, 'add');
    const channel = {
        channelType: 'BS',
        halfWidthName: 'synthetic-half-channel',
        name: 'synthetic-channel',
    };
    const encodedRecorded = makeRecorded({
        id: 119,
        videoFiles: [{ id: 219 }],
    });
    const channelDB = { findId: vi.fn(async () => channel) };
    const recordedDB = { findId: vi.fn(async () => encodedRecorded) };
    const videoUtil = {
        getFullFilePathFromId: vi.fn(async (id: number) => `synthetic-video-${id}`),
    };
    if (ExternalCommandManageModelCtor === undefined) {
        throw new Error('installSpawnStub() must resolve before makeCommandQueueHarness() is used');
    }
    const model = new ExternalCommandManageModelCtor(
        { getLogger: () => logger },
        { getConfig },
        queue,
        channelDB,
        recordedDB,
        videoUtil,
    );
    return { channelDB, config, encodedRecorded, getConfig, logger, model, queue, queueAdd, recordedDB, videoUtil };
};

export const installSpawnStub = async (): Promise<void> => {
    if (ExternalCommandManageModelCtor !== undefined) throw new Error('Synthetic spawn stub is already installed');
    const childProcessMock = { spawn: processStubs.spawn };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    vi.doMock(processUtilPath, () => ({ default: ProcessUtil }));
    try {
        vi.resetModules();
        const imported = (await import(modelPath)) as { default: new (...args: any[]) => any };
        ExternalCommandManageModelCtor = imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
        vi.doUnmock(processUtilPath);
    }
};

export const resetCommandHarness = (): void => {
    for (const child of children) child.removeAllListeners();
    children.clear();
    processStubs.spawn.mockReset();
    vi.restoreAllMocks();
};

export const restoreSpawnStub = (): void => {
    ExternalCommandManageModelCtor = undefined;
};

export const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await flushImmediate();
    }
    throw new Error(message);
};
