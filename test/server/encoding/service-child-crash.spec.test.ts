import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Web・API 側処理だけが異常終了したときの変換 process の扱い（Requirement 7.14）。停止と削除の手順は
 * サーバー起動・稼働管理機能の後始末が持ち、ここでは変換 process が取消と同じ `SIGINT` だけで止められ、
 * 出力途中のファイルが Requirement 7.7 と同じ規則で削除されることを確かめる。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const ServiceChildTerminationCleanup = (
    require(join(snapshot, 'model', 'ServiceChildTerminationCleanup.js')) as {
        default: new (dependencies: Record<string, unknown>) => { run(peer: object): Promise<void> };
    }
).default;

const record = (id: number, outputPath: string, parentDir: string) => ({
    createdAt: id,
    id,
    option: { mode: 'synthetic-mode', parentDir, recordedId: 1, removeOriginal: false, sourceVideoFileId: 1 },
    outputPath,
});

describe('conversion processes of an ended service child', () => {
    it('[EN-SPEC-R7-14] stops the running conversion with SIGINT only and removes its output under the restoration rules', async () => {
        const ledger: string[] = [];
        const stillRunning = new Set([9601, 9602]);
        const cleanup = new ServiceChildTerminationCleanup({
            encodeQueue: {
                list: async () => [
                    record(71, 'synthetic-parent-root/out-71.mp4', 'synthetic-parent'),
                    record(72, 'synthetic-elsewhere/out-72.mp4', 'synthetic-parent'),
                ],
            },
            isSameFile: async () => false,
            resolveRecordedFiles: () => ({
                recordedDB: {
                    findId: async () => ({ id: 1, videoFiles: [{ fullPath: 'synthetic-parent-root/source.ts', id: 1 }] }),
                },
                videoUtil: {
                    getFullFilePathFromVideoFile: (videoFile: { fullPath: string }) => videoFile.fullPath,
                    getParentDirPath: (name: string) => (name === 'synthetic-parent' ? 'synthetic-parent-root' : null),
                },
            }),
            hlsArtifacts: { deleteAllArtifacts: async () => new Set<number>() },
            logger: { error: vi.fn(), info: vi.fn() },
            processes: {
                takeEntries: async () => [
                    { encodeId: 71, kind: 'encode', pid: 9601, startTime: 'start-9601' },
                    { encodeId: 72, kind: 'encode', pid: 9602, startTime: 'start-9602' },
                ],
            },
            recordedUse: { releasePeer: () => ledger.push('release-leases') },
            removeInterruptedOutput: true,
            streamFilePath: 'synthetic-stream-root',
            system: {
                identify: (pid: number) =>
                    stillRunning.has(pid) ? { startTime: `start-${pid}`, status: 'running' } : { status: 'absent' },
                isAlive: () => false,
                hasLiveGroupMember: () => false,
                isGroupAlive: () => false,
                removeFile: async (filePath: string) => {
                    ledger.push(`remove ${filePath}`);
                },
                signal: (pid: number, signal: string) => {
                    ledger.push(`signal ${pid} ${signal}`);
                    stillRunning.delete(pid);
                },
                signalGroup: (pgid: number, signal: string) => ledger.push(`signal-group ${pgid} ${signal}`),
                wait: async () => undefined,
            },
        });

        await cleanup.run({});

        expect(ledger.filter(line => line.startsWith('signal')).sort()).toEqual([
            'signal 9601 SIGINT',
            'signal 9602 SIGINT',
        ]);
        expect(ledger.filter(line => line.startsWith('remove'))).toEqual(['remove synthetic-parent-root/out-71.mp4']);
        expect(ledger[ledger.length - 1]).toBe('release-leases');
    });
});
