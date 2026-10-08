import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecorder, makeRecordingSessionBinding, makeReserve } from '../../recording-execution/_harness';
import { ExternalCommandManageModel, makeLogger, makeSetter, PromiseQueue, RecordingEvent } from '../_harness';

/*
 * hook の test は録画の event を `RecordingEvent.emit*` で直接起こす。ここでは本物の RecorderModel（DB と tuner の
 * 流れは偽物）が録画の準備・開始・終了・失敗・取消を進め、本物の RecordingEvent → EventSetter →
 * ExternalCommandManageModel を通って、実の子 process（hook command）が何回、どの引数（環境変数）で動くかを確かめる。
 */

const temporaryRoots: string[] = [];

afterEach(async () => {
    for (const root of temporaryRoots.splice(0)) await rm(root, { force: true, recursive: true });
});

const setupChain = async () => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recorder-hook-chain-'));
    temporaryRoots.push(root);
    const script = join(root, 'append-label.cjs');
    const log = join(root, 'hook-calls.log');
    await writeFile(
        script,
        "require('node:fs').appendFileSync(process.argv[2], `${process.argv[3]}:${process.env.RESERVEID ?? ''}:${process.env.RECORDEDID ?? ''}\\n`);\n",
    );
    const command = (label: string) => `%NODE% ${script} ${log} ${label}`;
    const logger = makeLogger();
    const model = new ExternalCommandManageModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                dropLog: 'synthetic-drop-root',
                hookCommandMaxPending: 64,
                hookCommandTimeoutMs: 10_000,
                recordingFailedCommand: command('failed'),
                recordingFinishCommand: command('finish'),
                recordingPrepRecFailedCommand: command('prep-failed'),
                recordingPreStartCommand: command('prep-start'),
                recordingStartCommand: command('start'),
            }),
        },
        new PromiseQueue(),
        { findId: vi.fn(async () => ({ halfWidthName: 'synthetic-half-channel', name: 'synthetic-channel' })) },
        { findId: vi.fn() },
        { getFullFilePathFromId: vi.fn() },
    );
    const recordingEvent = new RecordingEvent({ getLogger: () => logger });
    makeSetter({ externalCommandManage: model, logger, recordingEvent }).setter.set();
    // 期待の行数が揃うまで待ち、余分な起動が無いことを見るために少し置いてから全行を返す。
    const lines = async (expected: number): Promise<string[]> => {
        await vi.waitFor(
            async () =>
                expect((await readFile(log, 'utf8').catch(() => '')).trim().split('\n').length).toBeGreaterThanOrEqual(
                    expected,
                ),
            { interval: 50, timeout: 15_000 },
        );
        await new Promise(resolve => setTimeout(resolve, 500));
        return (await readFile(log, 'utf8')).trim().split('\n');
    };
    return { lines, logger, recordingEvent, root };
};

const bindRecorder = (recorder: any, reserve: any) => {
    const session = makeRecordingSessionBinding(reserve, { generation: 5n, phase: 'Preparing', sessionToken: 5n });
    recorder.reserve = reserve;
    recorder.bindScheduleSession(session.binding);
    return session;
};

const recorderRecordingPaths = (root: string) => ({
    getRecPath: vi.fn(async () => ({
        fileName: 'synthetic-chain.ts',
        fullPath: join(root, 'synthetic-chain.ts'),
        parendDir: { name: 'synthetic-root', path: root },
        subDir: '',
    })),
    movingFromTmp: vi.fn(async () => join(root, 'synthetic-chain.ts')),
    updateVideoFileSize: vi.fn(async () => undefined),
});

describe('real recorder to recording hook commands', () => {
    it('[EH-HOOK-CHAIN] runs the prepare-start, start, and finish hooks once each, in order, with the reservation and recorded IDs', async () => {
        const { lines, logger, recordingEvent, root } = await setupChain();
        const stream = new PassThrough();
        const { model: recorder } = makeRecorder({
            recordingEvent,
            recordingUtil: recorderRecordingPaths(root),
            streamCreator: { changeEndAt: vi.fn(), create: vi.fn(async () => stream) },
        });
        const reserve = makeReserve({ endAt: Date.now() + 60_000, id: 71, startAt: Date.now() });
        bindRecorder(recorder, reserve);

        const preparation = recorder.startPreparation();
        stream.write('synthetic-chain data');
        await preparation;
        stream.end();
        await recorder.whenNormalRecordingTerminal();

        await expect(lines(3)).resolves.toEqual(['prep-start:71:', 'start::21', 'finish::21']);
        expect(logger.system.error).not.toHaveBeenCalled();
    }, 30_000);

    it('[EH-HOOK-CHAIN] runs the prepare-failed hook once when the preparation is cancelled before any data arrives', async () => {
        const { lines, recordingEvent, root } = await setupChain();
        // 本物の RecordingStreamCreator と同じく、取消（abort）されたら取得を失敗で終える。
        const streamCreator = {
            changeEndAt: vi.fn(),
            create: vi.fn(
                (_reserve: unknown, signal: AbortSignal) =>
                    new Promise<never>((_resolve, reject) =>
                        signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true }),
                    ),
            ),
        };
        const { model: recorder } = makeRecorder({
            recordingEvent,
            recordingUtil: recorderRecordingPaths(root),
            streamCreator,
        });
        const reserve = makeReserve({ endAt: Date.now() + 60_000, id: 72, startAt: Date.now() });
        bindRecorder(recorder, reserve);

        void recorder.startPreparation();
        await vi.waitFor(() => expect(streamCreator.create).toHaveBeenCalledOnce());
        await recorder.cancel(false);

        await expect(lines(2)).resolves.toEqual(['prep-start:72:', 'prep-failed:72:']);
    }, 30_000);

    it('[EH-HOOK-CHAIN] runs the finish hook and then the failed hook once each with the recorded ID when the stream breaks after recording started', async () => {
        const { lines, recordingEvent, root } = await setupChain();
        const stream = new PassThrough();
        const { model: recorder } = makeRecorder({
            recordingEvent,
            recordingUtil: recorderRecordingPaths(root),
            streamCreator: { changeEndAt: vi.fn(), create: vi.fn(async () => stream) },
        });
        const reserve = makeReserve({ endAt: Date.now() + 60_000, id: 73, startAt: Date.now() });
        bindRecorder(recorder, reserve);

        const preparation = recorder.startPreparation();
        stream.write('synthetic-chain data');
        await preparation;
        stream.destroy(new Error('synthetic stream break'));

        // 録画の途中で stream が壊れると、そこまでの録画の終了処理（finish hook）の後に失敗の通知（failed hook）が続く（v2 と同じ）。
        await expect(lines(4)).resolves.toEqual(['prep-start:73:', 'start::21', 'finish::21', 'failed::21']);
    }, 30_000);
});
