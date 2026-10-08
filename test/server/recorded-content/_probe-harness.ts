import 'reflect-metadata';

import type { ChildProcess, ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { vi, type Mock } from 'vitest';

interface VideoInfo {
    readonly bitRate: number;
    readonly duration: number;
    readonly size: number;
}

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

export type ExecFileFunction = (file: string, args: readonly string[], callback: ExecFileCallback) => ChildProcess;

interface VideoUtilRuntime {
    getFullFilePathFromId(videoFileId: number): Promise<string | null>;
    getFullFilePathFromVideoFile(videoFile: Record<string, unknown>): string | null;
    getInfo(filePath: string): Promise<VideoInfo>;
    getParentDirPath(name: string): string | null;
}

interface VideoUtilConstructor {
    new (
        configuration: { getConfig(): Record<string, unknown> },
        videoFileDB: { findId(videoFileId: number): Promise<Record<string, unknown> | null> },
        loggerModel?: { getLogger(): ProbeLogger },
    ): VideoUtilRuntime;
}

interface VideoApiRuntime {
    getDuration(videoFileId: number): Promise<number>;
}

interface VideoApiConstructor {
    new (
        configuration: unknown,
        videoFileDB: unknown,
        recordedDB: unknown,
        apiUtil: unknown,
        videoUtil: VideoUtilRuntime,
        ipc: unknown,
    ): VideoApiRuntime;
}

export interface ProbeLogger {
    readonly system: {
        readonly error: Mock;
    };
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const videoUtilPath = join(compiledSnapshot, 'model', 'api', 'video', 'VideoUtil.js');
const VideoApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'video', 'VideoApiModel.js')) as {
        default: VideoApiConstructor;
    }
).default;

/**
 * The compiled `VideoUtil.js` is ES modules (`import { execFile } from 'child_process'`), a static
 * binding that patching `Module._load` (a CommonJS-loader hook) never reaches -- this suite's ESM import
 * resolves through the test runner's own module graph, not the CommonJS loader `Module._load` patches.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` is the mechanism that actually lands a
 * replacement `execFile` in the model's binding (mirrors
 * `event-and-hook-delivery/external-command-test-harness.ts#installSpawnStub`). Unlike the other
 * migrated harnesses in this codebase, this one reloads `VideoUtil.js` fresh on *every* call (mirroring
 * the original `Module._load`-patch-per-call design) rather than once up front: some tests
 * (`[RC-7.6] keeps a concurrent successful request independent from a timed-out request`) run two
 * `createVideoProbe()` probes concurrently, each needing its own permanently-bound `execFile`, which a
 * single shared dispatch stub cannot provide since a later call's `mockImplementation` would silently
 * redirect the earlier probe's calls too.
 */
const realExecFile = (require('node:child_process') as typeof import('node:child_process')).execFile;

const loadVideoUtil = async (execFile?: ExecFileFunction): Promise<VideoUtilConstructor> => {
    const boundExecFile = execFile ?? ((...args: Parameters<ExecFileFunction>) => (realExecFile as any)(...args));
    const childProcessMock = { execFile: boundExecFile };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    try {
        vi.resetModules();
        const imported = (await import(videoUtilPath)) as { default: VideoUtilConstructor };
        return imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
    }
};

export const createProbeLogger = (): ProbeLogger => ({
    system: {
        error: vi.fn(),
    },
});

export const syntheticProbeChild = (): ChildProcess =>
    Object.assign(new EventEmitter(), {
        connected: false,
        exitCode: null,
        kill: vi.fn(() => true),
        killed: false,
        pid: 4242,
        signalCode: null,
        spawnargs: [],
        spawnfile: 'synthetic-probe-child',
        stderr: null,
        stdin: null,
        stdio: [null, null, null, null, null],
        stdout: null,
    }) as unknown as ChildProcess;

export const controlledExecFile = () => {
    const child = syntheticProbeChild();
    let callback: ExecFileCallback | undefined;
    const execFile = vi.fn<ExecFileFunction>((_file, _args, next) => {
        callback = next;
        return child;
    });
    return {
        callback: () => {
            if (callback === undefined) {
                throw new Error('The probe callback has not been installed');
            }
            return callback;
        },
        child,
        execFile,
    };
};

export const createVideoProbe = async (options?: {
    readonly execFile?: ExecFileFunction;
    readonly ffprobe?: string;
    readonly logger?: ProbeLogger;
    readonly provideLogger?: boolean;
    readonly recordedPath?: string;
    readonly recordedTmp?: string;
    readonly rows?: ReadonlyMap<number, Record<string, unknown>>;
}) => {
    const logger = options?.logger ?? createProbeLogger();
    const rows = options?.rows ?? new Map<number, Record<string, unknown>>();
    const configuration = {
        getConfig: () => ({
            ffprobe: options?.ffprobe ?? 'synthetic-ffprobe',
            recorded: [{ name: 'synthetic-storage', path: options?.recordedPath ?? 'synthetic-root' }],
            recordedTmp: options?.recordedTmp,
        }),
    };
    const videoFileDB = {
        findId: vi.fn(async (videoFileId: number) => rows.get(videoFileId) ?? null),
    };
    const VideoUtil = await loadVideoUtil(options?.execFile);
    const loggerModel = options?.provideLogger === false ? undefined : { getLogger: () => logger };
    const videoUtil = new VideoUtil(configuration, videoFileDB, loggerModel);
    const videoApi = new VideoApiModel(configuration, videoFileDB, {}, {}, videoUtil, {});
    return { configuration, logger, videoApi, videoFileDB, videoUtil };
};
