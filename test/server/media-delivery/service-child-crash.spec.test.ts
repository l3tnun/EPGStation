import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger } from './_media-harness';

/**
 * 配信の外部プロセスの開始の知らせ（Requirement 5.14、6.4）と、Web・API 側処理が異常終了したときに管理側が
 * 行う配信の停止と HLS 成果物の削除（Requirement 5.15、6.5）。
 */

const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const RecordedStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;
const HLSFileDeleterModel = compiled<any>('model', 'service', 'stream', 'util', 'HLSFileDeleterModel.js').default;
const ServiceChildTerminationCleanup = compiled<any>('model', 'ServiceChildTerminationCleanup.js').default;

const dirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const processManager = () => {
    const child = fakeChild();
    return {
        child,
        manager: {
            createHlsWriter: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'hls-writer' }) })),
            createManaged: vi.fn(async () => ({ child, handle: Object.freeze({ kind: 'managed' }) })),
            requestStop: vi.fn(async () => ({ sentSignals: ['SIGINT'], status: 'requested' })),
            stopHls: vi.fn(async () => ({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true })),
        },
    };
};

const recordedVideo = (model: any, dir: string): void => {
    model.setVideFileInfo = vi.fn(async () => {
        model.videoFilePath = join(dir, 'source.ts');
        model.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        model.videoFileType = 'encoded';
        model.isRecording = false;
    });
};

/** 管理側の後始末を、偽の process 表と実際の HLS 成果物の削除で組み立てる。 */
const cleanupFor = (entries: readonly Record<string, unknown>[], alive: Map<number, { exitOn: 'SIGINT' | 'SIGKILL' }>) => {
    const dir = mkdtempSync(join(tmpdir(), 'epg-crash-cleanup-'));
    dirs.push(dir);
    const ledger: string[] = [];
    const exited = new Set<number>();
    const checks = new Map<number, number>();
    const system = {
        identify: (pid: number) => {
            const count = (checks.get(pid) ?? 0) + 1;
            checks.set(pid, count);
            // A process that ignores the signal it can receive still ends by itself on its sixth check.
            if (count >= 6) exited.add(pid);
            return exited.has(pid) || !alive.has(pid)
                ? { status: 'absent' }
                : { startTime: `start-${pid}`, status: 'running' };
        },
        isAlive: () => true,
        hasLiveGroupMember: (pgid: number) => !exited.has(pgid),
        isGroupAlive: (pgid: number) => !exited.has(pgid),
        signal: (pid: number, signal: string) => {
            ledger.push(`signal ${pid} ${signal}`);
            if (alive.get(pid)?.exitOn === signal) exited.add(pid);
        },
        signalGroup: (pgid: number, signal: string) => {
            ledger.push(`signal-group ${pgid} ${signal}`);
            if (alive.get(pgid)?.exitOn === signal) exited.add(pgid);
        },
        wait: async () => undefined,
        removeFile: async () => undefined,
    };
    const cleanup = new ServiceChildTerminationCleanup({
        encodeQueue: { list: async () => [] },
        isSameFile: async () => false,
        resolveRecordedFiles: () => ({ recordedDB: { findId: async () => null }, videoUtil: {} }),
        hlsArtifacts: new HLSFileDeleterModel({ getLogger: logger }),
        logger: { error: vi.fn(), info: vi.fn() },
        processes: { takeEntries: async () => entries },
        recordedUse: { releasePeer: () => ledger.push('release-leases') },
        removeInterruptedOutput: true,
        streamFilePath: dir,
        system,
    });
    return { cleanup, dir, ledger };
};

describe('media delivery processes of an ended service child', () => {
    it('[MD-5.14] starts a live and a recorded HLS writer with their stream identifiers so that the starts are reported', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'epg-hls-report-'));
        dirs.push(dir);
        const live = processManager();
        const liveModel = new LiveHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            live.manager,
            new HLSFileDeleterModel({ getLogger: logger }),
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: new PassThrough() })) },
            { notifyClient: vi.fn() },
        );
        liveModel.setOption({ channelId: 101, cmd: '%NODE%' }, 0);
        const recorded = processManager();
        const recordedModel = new RecordedHLSStreamModel(
            { getConfig: () => baseConfig({ streamFilePath: dir }) },
            { getLogger: logger },
            recorded.manager,
            new HLSFileDeleterModel({ getLogger: logger }),
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        recordedModel.setOption({ cmd: '%NODE%', playPosition: 0, videoFileId: 1 }, 0);
        recordedVideo(recordedModel, dir);

        await liveModel.start(6);
        await recordedModel.start(7);

        expect(live.manager.createHlsWriter.mock.calls[0][0]).toMatchObject({ report: { kind: 'hls', streamId: 6 } });
        expect(recorded.manager.createHlsWriter.mock.calls[0][0]).toMatchObject({
            report: { kind: 'hls', streamId: 7 },
        });
        await liveModel.stop();
        await recordedModel.stop();
    });

    it('[MD-6.4] starts the live and recorded viewer transforms with the non-HLS kind so that the starts are reported', async () => {
        const live = processManager();
        const liveModel = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            live.manager,
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { openServiceStream: vi.fn(async () => ({ close: vi.fn(), stream: new PassThrough() })) },
            { notifyClient: vi.fn() },
        );
        liveModel.setOption({ channelId: 101, cmd: '%NODE% live-transform' }, 0);
        const dir = mkdtempSync(join(tmpdir(), 'epg-stream-report-'));
        dirs.push(dir);
        const recorded = processManager();
        const recordedModel = new RecordedStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            recorded.manager,
            { deleteAllFiles: vi.fn(), setOption: vi.fn() },
            { notifyClient: vi.fn() },
            { findId: vi.fn() },
            { findId: vi.fn() },
            { getFullFilePathFromId: vi.fn() },
        );
        recordedModel.setOption({ cmd: '%NODE% recorded-transform', playPosition: 0, videoFileId: 1 }, 0);
        recordedVideo(recordedModel, dir);

        await liveModel.start(8);
        await recordedModel.start(9);

        expect(live.manager.createManaged.mock.calls[0][0]).toMatchObject({ report: { kind: 'stream' } });
        expect(recorded.manager.createManaged.mock.calls[0][0]).toMatchObject({ report: { kind: 'stream' } });
        await liveModel.stop();
        await recordedModel.stop();
    });

    it('[MD-5.15] stops the HLS writer group in two stages and deletes every HLS artifact before the restart', async () => {
        const { cleanup, dir, ledger } = cleanupFor(
            [{ kind: 'hls', pgid: 9301, pid: 9301, startTime: 'start-9301', streamId: 0 }],
            new Map([[9301, { exitOn: 'SIGKILL' as const }]]),
        );
        for (const name of ['stream0.m3u8', 'stream0-000000001.ts', 'stream12.m3u8', 'stream12-child_vtt.m3u8']) {
            writeFileSync(join(dir, name), 'synthetic');
        }
        writeFileSync(join(dir, 'stream12'), 'not an artifact');
        writeFileSync(join(dir, 'synthetic-other.txt'), 'not an artifact');

        await cleanup.run({});

        expect(ledger).toEqual(['signal-group 9301 SIGINT', 'signal-group 9301 SIGKILL', 'release-leases']);
        expect(readdirSync(dir).sort()).toEqual(['stream12', 'synthetic-other.txt']);
        expect(existsSync(join(dir, 'stream12.m3u8'))).toBe(false);
    });

    it('[MD-6.5] stops a non-HLS viewer transform of the ended service child with SIGINT only', async () => {
        const { cleanup, ledger } = cleanupFor(
            [{ kind: 'stream', pid: 9302, startTime: 'start-9302' }],
            new Map([[9302, { exitOn: 'SIGKILL' as const }]]),
        );

        await cleanup.run({});

        // The transform ignores SIGINT and ends by itself later; the parent never escalates to SIGKILL.
        expect(ledger).toEqual(['signal 9302 SIGINT', 'release-leases']);
    });
});
