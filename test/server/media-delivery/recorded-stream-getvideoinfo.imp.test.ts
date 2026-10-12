import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiledSnapshot, logger } from './_media-harness';

/**
 * The compiled `RecordedStreamBaseModel.js` (base class of `RecordedStreamModel`) is ES modules, so
 * a static `child_process` binding is not reachable through `vi.spyOn(require('child_process'), ...)`
 * -- this suite's ESM import resolves through the test runner's own module graph, not the CommonJS
 * loader a `require(...)` mutation goes through.
 *
 * `vi.doMock` + `vi.resetModules` + a dynamic `import()` is the mechanism that actually lands a
 * replacement in the model's binding. It is installed here so a stray child process spawned from
 * this file is observable, not because the production path is expected to spawn one.
 */
const execFileDispatch = vi.fn();
const execDispatch = vi.fn();

let RecordedStreamModel: new (...args: any[]) => any;

beforeAll(async () => {
    const childProcessMock = {
        execFile: (...args: unknown[]) => execFileDispatch(...args),
        exec: (...args: unknown[]) => execDispatch(...args),
    };
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('node:child_process', () => childProcessMock);
    try {
        vi.resetModules();
        const imported = (await import(
            join(compiledSnapshot, 'model', 'service', 'stream', 'RecordedStreamModel.js')
        )) as { default: new (...args: any[]) => any };
        RecordedStreamModel = imported.default;
    } finally {
        vi.doUnmock('child_process');
        vi.doUnmock('node:child_process');
    }
});

/**
 * Build a real compiled RecordedStreamModel so private getVideoInfo on the
 * production RecordedStreamBaseModel prototype is reachable without going through
 * the full stream start path.
 */
const createSubject = (videoUtil: Record<string, unknown>) => {
    const log = logger();
    return new RecordedStreamModel(
        { getConfig: () => baseConfig() },
        { getLogger: () => log },
        {
            createHlsWriter: vi.fn(),
            createManaged: vi.fn(),
            requestStop: vi.fn(),
            stopHls: vi.fn(),
        },
        { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
        { notifyClient: vi.fn() },
        { findId: vi.fn(async () => null) },
        { findId: vi.fn(async () => null) },
        { getFullFilePathFromId: vi.fn(async () => null), ...videoUtil },
    );
};

describe('RecordedStreamBaseModel.getVideoInfo private ffprobe path (unittest/imp)', () => {
    afterEach(() => {
        // The dispatchers are plain `vi.fn()`, not `vi.spyOn` spies -- `restoreAllMocks` only
        // restores spies, so `resetAllMocks` is used to avoid leaking a test's override.
        vi.resetAllMocks();
    });

    it('[R2-GETVIDEOINFO] resolves the video info the shared probe returns', async () => {
        const getInfo = vi.fn(async () => ({ bitRate: 8192.25, duration: 12.5, size: 4096 }));
        const model = createSubject({ getInfo });

        await expect(model.getVideoInfo('synthetic/path/video.ts')).resolves.toEqual({
            bitRate: 8192.25,
            duration: 12.5,
            size: 4096,
        });
        expect(getInfo).toHaveBeenCalledWith('synthetic/path/video.ts');
    });

    it('[R2-GETVIDEOINFO-REJECT] rejects with the same error identity the shared probe rejects with', async () => {
        const sentinel = new Error('SYNTHETIC_FFPROBE_FAILURE');
        const getInfo = vi.fn(async () => {
            throw sentinel;
        });
        const model = createSubject({ getInfo });

        await expect(model.getVideoInfo('synthetic/path/missing.ts')).rejects.toBe(sentinel);
    });

    it('[R2-GETVIDEOINFO-DEADLINE] runs no ffprobe of its own, so the shared deadline and SIGKILL apply', async () => {
        // `VideoUtil.getInfo` wraps ffprobe in a 30s deadline that escalates to SIGKILL, and
        // `test/server/recorded-content/probe.spec.test.ts` fixes that contract. A second,
        // unguarded ffprobe invocation here would start a child that never gets killed when the
        // probe hangs, leaving `setOption` awaiting forever. The recorded stream path must reuse
        // the guarded probe rather than spawn its own.
        const getInfo = vi.fn(async () => ({ bitRate: 1, duration: 1, size: 1 }));
        const model = createSubject({ getInfo });

        await model.getVideoInfo('synthetic/path/video.ts');

        expect(execFileDispatch).not.toHaveBeenCalled();
        expect(execDispatch).not.toHaveBeenCalled();
    });

    it('[R2-GETVIDEOINFO-NOSHELL] hands a filePath holding shell metacharacters to the probe untouched', async () => {
        // A recorded file name is built from the EPG program title. `StrUtil.replaceFileName`
        // replaces `"` but not `$` or a backtick, so a title such as `アニメ $(id) 第1話` survives
        // into the path. The path must travel as a plain value, never through a shell command
        // string that would perform command substitution on it.
        const getInfo = vi.fn(async () => ({ bitRate: 1, duration: 1, size: 1 }));
        const model = createSubject({ getInfo });
        const hostileFilePath = 'synthetic/$(id)/`id`/video.ts';

        await model.getVideoInfo(hostileFilePath);

        expect(getInfo).toHaveBeenCalledWith(hostileFilePath);
        expect(execDispatch).not.toHaveBeenCalled();
    });
});
