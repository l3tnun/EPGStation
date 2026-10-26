import { once } from 'node:events';
import { promises as fsPromises, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { get as httpGet, IncomingMessage } from 'node:http';
import { AddressInfo, createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
    deferred,
    flushImmediate,
    load,
    logger,
    makeRecorder,
    makeRecorded,
    makeRecordingSessionBinding,
    makeReserve,
    ProgramDB,
    Recorded,
    RecorderModel,
    RecordingUtilModel,
} from './_harness';

type StorageSyncResult = 'synced' | 'failed' | 'timed-out' | 'unsupported' | 'missing';
const RecordingStorageSync = load<{
    syncFile(filePath: string): Promise<void>;
    syncDirectory(directoryPath: string): Promise<void>;
    sync(
        target: string,
        operation: () => Promise<void>,
        log: { warn(...args: unknown[]): void },
    ): Promise<StorageSyncResult>;
}>('model', 'operator', 'recording', 'RecordingStorageSync.js');

// Stores a program through ProgramDB with a fake database runner and returns the row it persisted.
const storeProgram = async (name: string, needToReplaceEnclosingCharacters: boolean) => {
    const manager = {
        delete: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue(undefined),
    };
    const runner = {
        startTransaction: vi.fn().mockResolvedValue(undefined),
        commitTransaction: vi.fn().mockResolvedValue(undefined),
        rollbackTransaction: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockResolvedValue(undefined),
        manager,
    };
    const db = new ProgramDB(
        { getLogger: () => ({ system: { debug: vi.fn(), error: vi.fn(), info: vi.fn() } }) },
        { getConfig: () => ({ needToReplaceEnclosingCharacters }) },
        { getConnection: async () => ({ createQueryRunner: () => runner }) },
        { run: (operation: () => unknown) => operation() },
    );
    await db.insert(
        { 10: { 101: { id: 1, type: 'GR', channel: '27' } } },
        [{ id: 201, eventId: 201, serviceId: 101, networkId: 10, startAt: 0, duration: 60_000, isFree: true, name }],
        [1],
    );
    return manager.insert.mock.calls[0][1] as { halfWidthName: string; shortName: string };
};

// tuner server の代わりに loopback の TCP server を立て、実物の `IncomingMessage` の放送 stream を 1 本開く。
const openReceiverStream = async (): Promise<{ stream: IncomingMessage; sender: Socket; close: () => void }> => {
    const accepted = deferred<Socket>();
    const server = createServer(socket => {
        socket.on('error', () => undefined);
        socket.once('data', () => {
            socket.write('HTTP/1.1 200 OK\r\nContent-Type: video/MP2T\r\nConnection: close\r\n\r\n');
            accepted.resolve(socket);
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const response = deferred<IncomingMessage>();
    const request = httpGet({ host: '127.0.0.1', port, path: '/synthetic-stream' }, response.resolve);
    request.on('error', response.reject);
    const stream = await response.promise;
    const sender = await accepted.promise;
    return {
        stream,
        sender,
        close: () => {
            stream.destroy();
            sender.destroy();
            server.close();
        },
    };
};

// 先頭の 1 byte を sync byte にした TS packet を `count` 個並べる。
const makeTsPackets = (count: number, fill: number): Buffer => {
    const packets = Buffer.alloc(188 * count, fill);
    for (let index = 0; index < count; index++) packets[188 * index] = 0x47;
    return packets;
};

// 実物の `IncomingMessage` の放送 stream で番組指定の録画を始め、先頭の 100 packet が録画 file へ書き終わった
// 状態を作る。
const startRecordingOverReceiver = async (reserveOverrides: Record<string, any>) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-receiver-'));
    const fullPath = join(root, 'synthetic.ts');
    const receiver = await openReceiverStream();
    const harness = makeRecorder({
        recordedDB: {
            insertOnce: vi.fn(async () => 21),
            removeRecording: vi.fn(async () => undefined),
            findId: vi.fn(async () => makeRecorded({ id: 21 })),
            updateOnce: vi.fn(async () => undefined),
        },
        recordingUtil: {
            getRecPath: vi.fn(async () => ({
                parendDir: { name: 'synthetic-root', path: root },
                subDir: '',
                fileName: 'synthetic.ts',
                fullPath,
            })),
            movingFromTmp: vi.fn(),
            updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
        },
    });
    const reserve = makeReserve({ isTimeSpecified: false, ...reserveOverrides });
    harness.model.reserve = reserve;
    harness.model.bindScheduleSession(makeRecordingSessionBinding(reserve, { phase: 'Recording' }).binding);
    harness.model.stream = receiver.stream;
    const send = (chunk: Buffer): Promise<void> =>
        new Promise((resolve, reject) => receiver.sender.write(chunk, error => (error ? reject(error) : resolve())));
    const head = makeTsPackets(100, 0x11);
    const started = harness.model.doRecord();
    await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
    const writerClosed = once(harness.model.recFile, 'close');
    await send(head);
    await started;
    await vi.waitFor(async () => expect((await stat(fullPath)).size).toBe(head.length));
    const cleanup = async (): Promise<void> => {
        harness.model.isCanceledCallingFinished = true;
        harness.model.destroyStream();
        receiver.close();
        await rm(root, { recursive: true, force: true });
    };
    return { cleanup, fullPath, harness, head, receiver, send, writerClosed };
};

describe('recording finalization', () => {
    it('[RE-5.3][RE-5.6][Task 6.1] clears recording before move, size, and drop finalizers', async () => {
        const ledger: string[] = [];
        const recorded = Object.assign(new Recorded(), { id: 21, halfWidthName: 'synthetic-program' });
        const harness = makeRecorder({
            config: { recordedTmp: '/synthetic-tmp' },
            recordedDB: {
                insertOnce: vi.fn(),
                removeRecording: vi.fn(async () => ledger.push('clear')),
                findId: vi.fn(async () => (ledger.push('query'), recorded)),
            },
            recordingUtil: {
                getRecPath: vi.fn(),
                movingFromTmp: vi.fn(async () => (ledger.push('move'), '/synthetic-root/synthetic.ts')),
                updateVideoFileSize: vi.fn(async () => ledger.push('size')),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-tmp/synthetic.ts';
        harness.model.updateDropFileLog = vi.fn(async () => ledger.push('drop'));
        await harness.model.recEnd();
        expect(ledger.slice(0, 5)).toEqual(['clear', 'move', 'size', 'drop', 'query']);
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledWith(harness.model.reserve, recorded, true);
    });

    it('[RE-5.2][Task 6.1] stops later finalizers when clearing the recording flag rejects', async () => {
        const harness = makeRecorder({
            config: { recordedTmp: '/synthetic-tmp' },
            recordedDB: {
                removeRecording: vi.fn(async () => Promise.reject(new Error('synthetic clear failure'))),
                findId: vi.fn(),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        await expect(harness.model.recEnd()).rejects.toThrow('synthetic clear failure');
        expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
        expect(harness.recordedDB.findId).not.toHaveBeenCalled();
    });

    it('[RE-5.8][RE-5.9][Task 6.2] stops after a recorded requery rejection and skips history/event for null', async () => {
        const rejected = makeRecorder({
            recordedDB: {
                removeRecording: vi.fn(),
                findId: vi.fn(async () => Promise.reject(new Error('synthetic query failure'))),
            },
        });
        rejected.model.reserve = makeReserve({ ruleId: 9 });
        rejected.model.recordedId = 21;
        await expect(rejected.model.recEnd()).rejects.toThrow('synthetic query failure');
        expect(rejected.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();

        const missing = makeRecorder({ recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => null) } });
        missing.model.reserve = makeReserve({ ruleId: 9 });
        missing.model.recordedId = 21;
        await missing.model.recEnd();
        expect(missing.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(missing.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it.each([
        ['move', { move: true, size: false, drop: false }],
        ['size', { move: false, size: true, drop: false }],
        ['drop', { move: false, size: false, drop: true }],
    ])('[RE-5.7][Task 6.1] records a %s fault and continues to requery and completion', async (_label, fault) => {
        const recorded = makeRecorded();
        const harness = makeRecorder({
            config: { recordedTmp: '/synthetic-tmp' },
            recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => recorded) },
            recordingUtil: {
                movingFromTmp: fault.move
                    ? vi.fn(async () => Promise.reject(new Error('synthetic move failure')))
                    : vi.fn(async () => '/synthetic-root/synthetic.ts'),
                updateVideoFileSize: fault.size
                    ? vi.fn(async () => Promise.reject(new Error('synthetic size failure')))
                    : vi.fn(async () => undefined),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-tmp/synthetic.ts';
        harness.model.updateDropFileLog = fault.drop
            ? vi.fn(async () => Promise.reject(new Error('synthetic drop failure')))
            : vi.fn(async () => undefined);
        await expect(harness.model.recEnd()).resolves.toBeUndefined();
        expect(harness.recordedDB.findId).toHaveBeenCalledWith(21);
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
    });

    it('[RE-5.4][Task 6.1] starts size update without awaiting it before drop, requery, and finish', async () => {
        const size = deferred<void>();
        const ledger: string[] = [];
        const harness = makeRecorder({
            recordedDB: {
                removeRecording: vi.fn(async () => ledger.push('clear')),
                findId: vi.fn(async () => (ledger.push('query'), makeRecorded())),
            },
            recordingUtil: {
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(() => {
                    ledger.push('size-start');
                    return size.promise;
                }),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';
        harness.model.updateDropFileLog = vi.fn(async () => ledger.push('drop'));
        await harness.model.recEnd();
        expect(ledger).toEqual(['clear', 'size-start', 'drop', 'query']);
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
        size.resolve();
    });

    it('[RE-5.10][Task 6.4] waits for the recFile writer to close before clearing the recording flag and starting the size update', async () => {
        const ledger: string[] = [];
        const recorded = makeRecorded();
        let closeListener: (() => void) | undefined;
        // 'close' は test が `closeListener` を呼んだときだけ届く。書き込みの終わりが timer や I/O の遅れと競合しない。
        const writer = {
            closed: false,
            end: vi.fn(),
            removeAllListeners: vi.fn(),
            once: vi.fn((event: string, listener: () => void) => {
                if (event === 'close') closeListener = listener;
            }),
        };
        const harness = makeRecorder({
            recordedDB: {
                removeRecording: vi.fn(async () => ledger.push('clear')),
                findId: vi.fn(async () => (ledger.push('query'), recorded)),
            },
            recordingUtil: {
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn(async () => {
                    ledger.push('size-start');
                }),
            },
        });
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';
        harness.model.recFile = writer;
        harness.model.updateDropFileLog = vi.fn(async () => ledger.push('drop'));
        const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile').mockImplementation(async () => {
            ledger.push('sync-file');
        });
        const syncDirectory = vi.spyOn(RecordingStorageSync, 'syncDirectory').mockImplementation(async () => {
            ledger.push('sync-directory');
        });
        try {
            const finalization = harness.model.recEnd();
            await vi.waitFor(() => expect(closeListener).toBeTypeOf('function'));
            await flushImmediate();
            expect(ledger).toEqual([]);
            expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();

            closeListener!();
            await finalization;
            await flushImmediate();

            // size の更新は待たずに始まるので、drop・再取得との前後は決めない。
            expect(ledger.slice(0, 3)).toEqual(['sync-file', 'sync-directory', 'clear']);
            expect([...ledger.slice(3)].sort()).toEqual(['drop', 'query', 'size-start']);
            expect(harness.recordingUtil.updateVideoFileSize).toHaveBeenCalledWith(31);
            expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
        } finally {
            syncFile.mockRestore();
            syncDirectory.mockRestore();
        }
    });

    it('[Task 6.1] stops planned-delete after stream/writer/drop shutdown and skips result finalizers', async () => {
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.isPlanToDelete = true;
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.dropLogFileId = 41;
        await harness.model.recEnd();
        expect(harness.dropChecker.stop).toHaveBeenCalled();
        expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
        expect(harness.recordingUtil.movingFromTmp).not.toHaveBeenCalled();
        expect(harness.recordingUtil.updateVideoFileSize).not.toHaveBeenCalled();
        expect(harness.recordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.recordingEvent.emitFinishRecording).not.toHaveBeenCalled();
    });

    it.each([
        ['time specified', { isTimeSpecified: true, ruleId: 9, isEventRelay: false }, true, 0],
        ['manual', { isTimeSpecified: false, ruleId: null, isEventRelay: false }, true, 0],
        ['relay', { isTimeSpecified: false, ruleId: 9, isEventRelay: true }, true, 0],
        ['failed recording', { isTimeSpecified: false, ruleId: 9, isEventRelay: false }, false, 0],
        ['automatic success', { isTimeSpecified: false, ruleId: 9, isEventRelay: false }, true, 1],
    ])(
        '[RE-5.5][Task 6.2] adds history only for %s according to all predicates',
        async (_case, reserve, needsDelete, count) => {
            const harness = makeRecorder({
                recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => makeRecorded()) },
            });
            harness.model.reserve = makeReserve(reserve);
            harness.model.recordedId = 21;
            harness.model.isNeedDeleteReservation = needsDelete;
            await harness.model.recEnd();
            expect(harness.recordedHistoryDB.insertOnce).toHaveBeenCalledTimes(count);
            expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['at the same time', 'same'],
        ['with the second end arriving after the reservation recalculation', 'staggered'],
    ] as const)(
        '[RE-5.5][Task 6.2] adds history for every recording of the same rule whose broadcasts end %s',
        async (_label, timing) => {
            // 同じ自動予約ルールの 2 本の録画を、実物の TCP socket で受けた放送 stream で録る。2 本の stream は同じ
            // 時刻に終わる（tuner server が同じ turn で両方の接続を閉じる）か、2 本目の終わりが、1 本目の完了による
            // 予約の再計算より後に届く。データベースの fake は同期の driver と同じく microtask だけで解決し、録画完了の
            // consumer は既存の契約どおり、予約削除が必要な正常終了を受けると同じルールの予約を再計算し、番組が
            // 終わった予約を削除して録画中の録画を取り消す。
            const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-simultaneous-end-'));
            const packets = Buffer.alloc(188 * 100, 0x11);
            for (let index = 0; index < 100; index++) packets[188 * index] = 0x47;

            type Recording = {
                harness: ReturnType<typeof makeRecorder>;
                reserve: Record<string, any>;
                sender: Socket;
                stream: IncomingMessage;
                close: () => void;
                fullPath: string;
            };
            const recordings: Recording[] = [];
            const active = new Set<Recording>();
            // 録画完了の consumer: 予約削除が必要な自動予約の正常終了で同じルールの予約を再計算し、番組の終わった
            // 予約を削除する。削除された予約がまだ録画中なら、予約の取消として録画を止める。
            const recalculateRule = async (ruleId: number): Promise<void> => {
                await Promise.resolve();
                const now = Date.now();
                for (const recording of [...active]) {
                    if (recording.reserve.ruleId !== ruleId || recording.reserve.endAt > now) continue;
                    active.delete(recording);
                    await recording.harness.model.cancel(false);
                }
            };
            try {
                for (const id of [1, 2]) {
                    const fullPath = join(root, `synthetic-${id}.ts`);
                    const reserve = makeReserve({ id, ruleId: 9, programId: 100 + id, isTimeSpecified: false });
                    const harness = makeRecorder({
                        recordedDB: {
                            insertOnce: vi.fn(async () => 20 + id),
                            removeRecording: vi.fn(async () => undefined),
                            findId: vi.fn(async () => makeRecorded({ id: 20 + id, reserveId: id, ruleId: 9 })),
                            updateOnce: vi.fn(async () => undefined),
                        },
                        recordingUtil: {
                            getRecPath: vi.fn(async () => ({
                                parendDir: { name: 'synthetic-root', path: root },
                                subDir: '',
                                fileName: `synthetic-${id}.ts`,
                                fullPath,
                            })),
                            movingFromTmp: vi.fn(),
                            updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
                        },
                    });
                    const recording: Recording = { harness, reserve, fullPath, ...(await openReceiverStream()) };
                    harness.recordingEvent.emitFinishRecording.mockImplementation(
                        (finished: Record<string, any>, _recorded: unknown, isNeedDeleteReservation: boolean) => {
                            active.delete(recording);
                            if (isNeedDeleteReservation && finished.ruleId !== null)
                                void recalculateRule(finished.ruleId);
                        },
                    );
                    harness.model.reserve = reserve;
                    harness.model.bindScheduleSession(
                        makeRecordingSessionBinding(reserve, { phase: 'Recording' }).binding,
                    );
                    harness.model.stream = recording.stream;
                    recordings.push(recording);
                }

                for (const recording of recordings) {
                    const started = recording.harness.model.doRecord();
                    await vi.waitFor(() => expect(recording.harness.model.recFile).not.toBeNull());
                    recording.sender.write(packets);
                    await started;
                    active.add(recording);
                    await vi.waitFor(async () => expect((await stat(recording.fullPath)).size).toBe(packets.length));
                }

                // 番組が終わり、tuner server が 2 本の stream を閉じる。
                const endAt = Date.now();
                for (const recording of recordings) recording.reserve.endAt = endAt;
                if (timing === 'same') {
                    for (const recording of recordings) recording.sender.end();
                } else {
                    const secondCancel = vi.spyOn(recordings[1].harness.model, 'cancel');
                    recordings[0].sender.end();
                    await vi.waitFor(() => expect(secondCancel).toHaveBeenCalled());
                    recordings[1].sender.end();
                }

                for (const recording of recordings) {
                    await vi.waitFor(() =>
                        expect(recording.harness.recordingEvent.emitFinishRecording).toHaveBeenCalled(),
                    );
                }
                for (const recording of recordings) {
                    expect(recording.harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
                    expect(recording.harness.recordingEvent.emitFinishRecording.mock.calls[0][2]).toBe(true);
                    expect(recording.harness.recordedHistoryDB.insertOnce).toHaveBeenCalledOnce();
                }
            } finally {
                for (const recording of recordings) {
                    recording.harness.model.isCanceledCallingFinished = true;
                    recording.harness.model.destroyStream();
                    recording.close();
                }
                await rm(root, { recursive: true, force: true });
            }
        },
    );

    it.each([
        ['an automatic reservation cancelled just before its end time', { ruleId: 9, isEventRelay: false }, 1, false],
        ['an automatic reservation cancelled at its end time', { ruleId: 9, isEventRelay: false }, 0, true],
        ['an automatic reservation cancelled after its end time', { ruleId: 9, isEventRelay: false }, -1, true],
        ['a manual reservation cancelled after its end time', { ruleId: null, isEventRelay: false }, -1, false],
        ['a relay reservation cancelled after its end time', { ruleId: 9, isEventRelay: true }, -1, false],
    ] as const)(
        '[RE-5.5][Task 6.2] finishes %s as needing the reservation removed only when it is an automatic one past its end',
        async (_label, kind, endAtFromNow, needsRemoval) => {
            // 取消で止める stream は、実物の `IncomingMessage`（破棄しても stream の終了を error にしない）を使う。
            const receiver = await openReceiverStream();
            const stream = receiver.stream;
            const now = 1_800_000_000_000;
            const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
            try {
                const harness = makeRecorder({
                    recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => makeRecorded()) },
                });
                harness.model.reserve = makeReserve({ ...kind, isTimeSpecified: false, endAt: now + endAtFromNow });
                harness.model.recordedId = 21;
                harness.model.videoFileId = 31;
                harness.model.stream = stream;
                harness.model.recFile = new PassThrough();
                harness.model.isRecording = true;
                await harness.model.setEndProcess(stream);

                await harness.model.cancel(false);
                await vi.waitFor(() => expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalled());

                expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
                expect(harness.recordingEvent.emitFinishRecording.mock.calls[0][2]).toBe(needsRemoval);
                expect(harness.recordedHistoryDB.insertOnce).toHaveBeenCalledTimes(needsRemoval ? 1 : 0);
                expect(harness.recordingEvent.emitRecordingFailed).not.toHaveBeenCalled();
            } finally {
                clock.mockRestore();
                receiver.close();
            }
        },
    );

    it('[RE-5.7][Task 6.2] logs history insertion failure and still publishes completion', async () => {
        const harness = makeRecorder({
            recordedDB: { removeRecording: vi.fn(), findId: vi.fn(async () => makeRecorded()) },
            recordedHistoryDB: {
                insertOnce: vi.fn(async () => Promise.reject(new Error('synthetic history failure'))),
            },
        });
        harness.model.reserve = makeReserve({ ruleId: 9, isTimeSpecified: false, isEventRelay: false });
        harness.model.recordedId = 21;
        await expect(harness.model.recEnd()).resolves.toBeUndefined();
        expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
    });

    it.each([
        ['the stream ending', 'end'],
        ['the stream failing', 'error'],
        ['the time-specified end', 'time'],
        ['the reservation being cancelled while recording', 'cancel'],
    ] as const)(
        '[RE-5.1][Task 6.1] ends the broadcast stream and the file writer once on %s',
        async (_label, trigger) => {
            const stream = new PassThrough();
            const writer = new PassThrough();
            const writerEnd = vi.spyOn(writer, 'end');
            const harness = makeRecorder();
            harness.model.reserve = makeReserve();
            harness.model.recordedId = 21;
            harness.model.videoFileId = 31;
            harness.model.stream = stream;
            harness.model.recFile = writer;
            harness.model.isRecording = true;
            await harness.model.setEndProcess(stream);

            if (trigger === 'end') {
                stream.resume();
                stream.end();
            } else if (trigger === 'error') {
                stream.destroy(new Error('synthetic stream failure'));
            } else if (trigger === 'time') {
                await harness.model.finishAtTimeSpecifiedEnd();
            } else {
                await harness.model.cancel(false);
            }
            await vi.waitFor(() => expect(writerEnd).toHaveBeenCalled());
            await vi.waitFor(() => expect(harness.recordedDB.removeRecording).toHaveBeenCalled());

            expect(stream.destroyed).toBe(true);
            expect(harness.model.stream).toBeNull();
            expect(writerEnd).toHaveBeenCalledOnce();
            expect(harness.model.recFile).toBeNull();
            expect(harness.recordedDB.removeRecording).toHaveBeenCalledOnce();
            expect(harness.recordedDB.removeRecording).toHaveBeenCalledWith(21);
        },
    );

    it('[RE-5.1][Task 6.1] ends the broadcast stream and the file writer once when writing the file fails', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-write-failure-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        const harness = makeRecorder({
            recordingUtil: {
                getRecPath: vi.fn(async () => ({
                    parendDir: { name: 'synthetic-root', path: root },
                    subDir: '',
                    fileName: 'synthetic.ts',
                    fullPath,
                })),
                movingFromTmp: vi.fn(),
                updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
            },
        });
        const reserve = makeReserve();
        const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
        harness.model.reserve = reserve;
        harness.model.bindScheduleSession(session.binding);
        harness.model.stream = stream;
        try {
            const started = harness.model.doRecord();
            await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
            const writer = harness.model.recFile;
            const writerEnd = vi.spyOn(writer, 'end');
            stream.write('synthetic-data');
            await started;

            writer.emit('error', new Error('synthetic writer failure'));
            await vi.waitFor(() => expect(writerEnd).toHaveBeenCalled());

            expect(writerEnd).toHaveBeenCalledOnce();
            expect(stream.destroyed).toBe(true);
            expect(harness.model.stream).toBeNull();
            expect(harness.model.recFile).toBeNull();
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['writes all of it into the file on a cancel without the drop check', false, 'cancel', null],
        ['writes all of it into the file on a cancel with the drop check', true, 'cancel', null],
        ['writes all of it into the file on the time-specified end without the drop check', false, 'time', null],
        ['writes all of it into the file on the time-specified end with the drop check', true, 'time', null],
        ['stops without reading it once the read-out limit has passed', false, 'cancel', 0],
    ] as const)(
        '[RE-5.1][Task 6.1] broadcast data that reached the receiver before the end: %s',
        async (_label, isEnabledDropCheck, trigger, drainLimitMs) => {
            // 実物の TCP socket で放送 stream を受ける。取消・時刻指定終了の直前に tuner server 側が送った data は、
            // 録画側の event loop がまだ読んでいない（受信 socket に届いただけの）状態で終了を迎える。
            // 予約の取消を処理する同期の DB 処理や、同じ時刻に終わる別の録画の終了処理などで event loop が
            // 塞がれていた場合と同じ状態である。
            const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-cancel-tail-'));
            const fullPath = join(root, 'synthetic.ts');
            const makePackets = (count: number, fill: number): Buffer => {
                const packets = Buffer.alloc(188 * count, fill);
                for (let index = 0; index < count; index++) packets[188 * index] = 0x47;
                return packets;
            };
            const head = [makePackets(100, 0x11), makePackets(100, 0x22)];
            const tail = makePackets(300, 0x33);

            const receiver = await openReceiverStream();
            const { stream, sender } = receiver;
            const send = (chunk: Buffer): Promise<void> =>
                new Promise((resolve, reject) => sender.write(chunk, error => (error ? reject(error) : resolve())));

            const harness = makeRecorder({
                config: { isEnabledDropCheck, dropLog: root },
                recordingUtil: {
                    getRecPath: vi.fn(async () => ({
                        parendDir: { name: 'synthetic-root', path: root },
                        subDir: '',
                        fileName: 'synthetic.ts',
                        fullPath,
                    })),
                    movingFromTmp: vi.fn(),
                    updateVideoFileSize: vi.fn().mockResolvedValue(undefined),
                },
            });
            const reserve =
                trigger === 'time' ? makeReserve({ isTimeSpecified: true, programId: null }) : makeReserve();
            const session = makeRecordingSessionBinding(reserve, { phase: 'Recording' });
            harness.model.reserve = reserve;
            harness.model.bindScheduleSession(session.binding);
            harness.model.stream = stream;
            const recorderClass = RecorderModel as unknown as { CANCEL_DRAIN_LIMIT_MS: number };
            const defaultDrainLimitMs = recorderClass.CANCEL_DRAIN_LIMIT_MS;
            if (drainLimitMs !== null) recorderClass.CANCEL_DRAIN_LIMIT_MS = drainLimitMs;
            try {
                const started = harness.model.doRecord();
                await vi.waitFor(() => expect(harness.model.recFile).not.toBeNull());
                const writer = harness.model.recFile;
                const writerClosed = once(writer, 'close');
                await send(head[0]);
                await started;
                await send(head[1]);
                // 取消より前の data が録画 file へ書き終わるまで待つ。
                const headLength = head[0].length + head[1].length;
                await vi.waitFor(async () => expect((await stat(fullPath)).size).toBe(headLength));

                // 末尾の data を送り終えた直後（event loop が受信 socket を読む前）に予約を取り消す、または時刻指定の
                // 終了時刻を迎える。
                await send(tail);
                if (trigger === 'cancel') await harness.model.cancel(false);
                else await harness.model.finishAtTimeSpecifiedEnd();
                await writerClosed;

                // 読み切りの上限を過ぎていれば、届いていた data を待たずに止める（上限は 1 秒。ここでは 0 にして確かめる）。
                const expected = drainLimitMs === 0 ? Buffer.concat(head) : Buffer.concat([...head, tail]);
                const recorded = await readFile(fullPath);
                expect(recorded.length).toBe(expected.length);
                expect(recorded.equals(expected)).toBe(true);
            } finally {
                recorderClass.CANCEL_DRAIN_LIMIT_MS = defaultDrainLimitMs;
                harness.model.isCanceledCallingFinished = true;
                harness.model.destroyStream();
                receiver.close();
                await rm(root, { recursive: true, force: true });
            }
        },
    );

    it('[RE-5.1][Task 6.1] keeps reading the arrived broadcast data while the file writer holds the stream back', async () => {
        // 録画 file の writer が詰まると pipe が stream を止め、受信量が増えない間も stream の buffer に data が残る。
        // 取消の時点で受信 socket に大きな data が届いていても、buffer が空になるまで読み切ってから止める。
        const recording = await startRecordingOverReceiver({});
        try {
            const tail = makeTsPackets(20_000, 0x33);
            await recording.send(tail);
            await recording.harness.model.cancel(false);
            await recording.writerClosed;

            const recorded = await readFile(recording.fullPath);
            expect(recorded.length).toBe(recording.head.length + tail.length);
            expect(recorded.equals(Buffer.concat([recording.head, tail]))).toBe(true);
        } finally {
            await recording.cleanup();
        }
    });

    it('[RE-5.1][Task 6.1] does not wait for a broadcast stream that is not piped into the file yet', async () => {
        // 録画 file への pipe の前（録画先の選択中など）の stream には、読み切って書く data が無い。止まった stream の
        // buffer が埋まったまま上限まで待たないよう、読み切りに入らずに止める。
        const receiver = await openReceiverStream();
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.stream = receiver.stream;
        harness.model.isRecording = true;
        const readOut = vi.spyOn(harness.model, 'readArrivedStreamData');
        try {
            await new Promise<void>((resolve, reject) =>
                receiver.sender.write(makeTsPackets(100, 0x11), error => (error ? reject(error) : resolve())),
            );
            await harness.model.cancel(false);

            expect(readOut).not.toHaveBeenCalled();
            expect(receiver.stream.destroyed).toBe(true);
        } finally {
            receiver.close();
        }
    });

    it('[RE-5.5][Task 6.2] keeps a cancel of a manual reservation as a cancel when its stream ends during the read-out', async () => {
        // 取消か正常終了かは読み切りの前に決める。終了時刻を過ぎた手動予約を取り消す直前に stream が終わると、
        // 読み切りの間に stream の終了処理が始まるが、完了通知は取消（予約削除要否 false）のままである。
        const recording = await startRecordingOverReceiver({ ruleId: null, endAt: Date.now() - 1_000 });
        try {
            recording.receiver.sender.end();
            await recording.harness.model.cancel(false);
            await vi.waitFor(() => expect(recording.harness.recordingEvent.emitFinishRecording).toHaveBeenCalled());

            expect(recording.harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
            expect(recording.harness.recordingEvent.emitFinishRecording.mock.calls[0][2]).toBe(false);
        } finally {
            await recording.cleanup();
        }
    });

    describe('the duplicate-recording comparison key', () => {
        // The duplicate check joins program.shortName with recorded_history.name. This pushes the same
        // title through both writers and compares what each one stores.
        const historyNameFor = async (halfWidthName: string) => {
            const harness = makeRecorder({
                recordedDB: {
                    removeRecording: vi.fn(),
                    findId: vi.fn(async () => makeRecorded({ halfWidthName })),
                },
            });
            harness.model.reserve = makeReserve({ ruleId: 9, isTimeSpecified: false, isEventRelay: false });
            harness.model.recordedId = 21;
            harness.model.isNeedDeleteReservation = true;
            await harness.model.recEnd();
            expect(harness.recordedHistoryDB.insertOnce).toHaveBeenCalledOnce();
            return (harness.recordedHistoryDB.insertOnce.mock.calls as any[][])[0][0].name as string;
        };

        it.each([
            ['enclosed-character glyphs', false],
            ['replaced bracket notation', true],
        ])(
            '[RE-5.5][Task 6.2] stores the same key for a program and its recorded history, keeping the first and second halves apart (%s)',
            async (_label, replace) => {
                const keys: Record<string, string> = {};
                for (const [label, name] of [
                    ['first', '\u{1f21c}AAAA\u{1f211}'],
                    ['firstMoved', 'AAAA\u{1f21c}'],
                    ['second', 'AAAA\u{1f21d}'],
                    ['rerun', 'AAAA\u{1f21e}'],
                    ['plain', 'AAAA'],
                ]) {
                    const row = await storeProgram(name, replace);
                    expect(await historyNameFor(row.halfWidthName)).toBe(row.shortName);
                    keys[label] = row.shortName;
                }

                expect(keys).toEqual({
                    first: 'AAAA[前]',
                    firstMoved: 'AAAA[前]',
                    second: 'AAAA[後]',
                    rerun: 'AAAA',
                    plain: 'AAAA',
                });
            },
        );
    });
});

describe('recording file storage sync', () => {
    const errorWithCode = (code: string): Error => Object.assign(new Error(`synthetic-${code}`), { code });

    it.each(['end', 'cancel', 'failure'] as const)(
        '[RE-5.10][Task 6.4] writes the recording file and its directory out before clearing the recording flag and publishing the finish (%s)',
        async trigger => {
            const recording = await startRecordingOverReceiver({});
            const { fullPath, harness, head, receiver, send } = recording;
            const tail = makeTsPackets(300, 0x33);
            const ledger: string[] = [];
            // 書き出しを呼んだ時点で、録画 file に何 byte 書かれているかを記録する。
            const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile').mockImplementation(async (filePath: string) => {
                ledger.push(`file:${filePath}:${statSync(filePath).size}`);
            });
            const syncDirectory = vi
                .spyOn(RecordingStorageSync, 'syncDirectory')
                .mockImplementation(async (directoryPath: string) => {
                    ledger.push(`directory:${directoryPath}`);
                });
            harness.recordedDB.removeRecording.mockImplementation(async () => {
                ledger.push('clear');
            });
            harness.recordingEvent.emitFinishRecording.mockImplementation(() => {
                ledger.push('finish');
            });
            try {
                await send(tail);
                if (trigger === 'end') {
                    receiver.sender.end();
                } else if (trigger === 'cancel') {
                    await harness.model.cancel(false);
                } else {
                    await vi.waitFor(async () => expect((await stat(fullPath)).size).toBe(head.length + tail.length));
                    receiver.stream.destroy(new Error('synthetic stream failure'));
                }
                await vi.waitFor(() => expect(ledger).toContain('finish'));

                expect(ledger).toEqual([
                    `file:${fullPath}:${head.length + tail.length}`,
                    `directory:${dirname(fullPath)}`,
                    'clear',
                    'finish',
                ]);
            } finally {
                syncFile.mockRestore();
                syncDirectory.mockRestore();
                await recording.cleanup();
            }
        },
    );

    it('[RE-5.10][Task 6.4] does not write out a recording that is stopped for its deletion', async () => {
        const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile');
        const syncDirectory = vi.spyOn(RecordingStorageSync, 'syncDirectory');
        try {
            const harness = makeRecorder();
            harness.model.reserve = makeReserve();
            harness.model.isPlanToDelete = true;
            harness.model.recordedId = 21;
            harness.model.videoFileId = 31;
            harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';
            await harness.model.recEnd();

            expect(syncFile).not.toHaveBeenCalled();
            expect(syncDirectory).not.toHaveBeenCalled();
        } finally {
            syncFile.mockRestore();
            syncDirectory.mockRestore();
        }
    });

    it('[RE-5.10][Task 6.4] writes a real recording file out to storage through the file and directory handles', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-recording-storage-sync-'));
        const filePath = join(root, 'synthetic.ts');
        try {
            await writeFile(filePath, 'synthetic-payload');
            await expect(RecordingStorageSync.syncFile(filePath)).resolves.toBeUndefined();
            await expect(RecordingStorageSync.syncDirectory(root)).resolves.toBeUndefined();
            expect(await readFile(filePath, 'utf8')).toBe('synthetic-payload');
            await expect(RecordingStorageSync.syncFile(join(root, 'missing.ts'))).rejects.toMatchObject({
                code: 'ENOENT',
            });
            await expect(RecordingStorageSync.syncDirectory(join(root, 'missing'))).rejects.toMatchObject({
                code: 'ENOENT',
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('[RE-5.10][Task 6.4] does not open a directory to write it out on Windows', async () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        try {
            await expect(
                RecordingStorageSync.syncDirectory(join(tmpdir(), 'synthetic-missing-directory')),
            ).resolves.toBeUndefined();
        } finally {
            Object.defineProperty(process, 'platform', platform);
        }
    });

    it('[RE-5.11][Task 6.4] retries a failed write-out a second apart up to three attempts and warns once', async () => {
        vi.useFakeTimers();
        const log = { warn: vi.fn() };
        const operation = vi.fn(async () => Promise.reject(errorWithCode('EIO')));
        try {
            const result = RecordingStorageSync.sync('synthetic-target', operation, log);
            await vi.advanceTimersByTimeAsync(0);
            expect(operation).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(999);
            expect(operation).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(operation).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(operation).toHaveBeenCalledTimes(3);
            await expect(result).resolves.toBe('failed');
            await vi.advanceTimersByTimeAsync(10_000);
            expect(operation).toHaveBeenCalledTimes(3);
            expect(log.warn).toHaveBeenCalledOnce();
            expect(log.warn.mock.calls[0].join(' ')).toContain('synthetic-target');
            expect(log.warn.mock.calls[0].join(' ')).toContain('synthetic-EIO');
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([1, 2, 3])(
        '[RE-5.11][Task 6.4] reports a write-out that succeeds on attempt %i as synced without a warning',
        async succeedingAttempt => {
            vi.useFakeTimers();
            const log = { warn: vi.fn() };
            let attempts = 0;
            const operation = vi.fn(async () => {
                attempts += 1;
                if (attempts < succeedingAttempt) throw errorWithCode('EIO');
            });
            try {
                const result = RecordingStorageSync.sync('synthetic-target', operation, log);
                await vi.advanceTimersByTimeAsync(2_000);
                await expect(result).resolves.toBe('synced');
                expect(operation).toHaveBeenCalledTimes(succeedingAttempt);
                expect(log.warn).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it.each([
        ['EINVAL', 'unsupported'],
        ['ENOTSUP', 'unsupported'],
        ['EOPNOTSUPP', 'unsupported'],
        ['ENOENT', 'missing'],
    ] as const)(
        '[RE-5.11][Task 6.4] does not retry a write-out that fails with %s and reports it as %s',
        async (code, expected) => {
            vi.useFakeTimers();
            const log = { warn: vi.fn() };
            const operation = vi.fn(async () => Promise.reject(errorWithCode(code)));
            try {
                const result = RecordingStorageSync.sync('synthetic-target', operation, log);
                await vi.advanceTimersByTimeAsync(10_000);
                await expect(result).resolves.toBe(expected);
                expect(operation).toHaveBeenCalledOnce();
                expect(log.warn).toHaveBeenCalledOnce();
                expect(log.warn.mock.calls[0].join(' ')).toContain('synthetic-target');
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('[RE-5.12][Task 6.4] gives up a write-out that has not finished in 60 seconds without retrying it', async () => {
        vi.useFakeTimers();
        const log = { warn: vi.fn() };
        const pending = deferred<void>();
        const operation = vi.fn(() => pending.promise);
        try {
            let settled: StorageSyncResult | undefined;
            void RecordingStorageSync.sync('synthetic-target', operation, log).then(result => {
                settled = result;
            });
            await vi.advanceTimersByTimeAsync(59_999);
            expect(settled).toBeUndefined();
            expect(log.warn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe('timed-out');
            expect(log.warn).toHaveBeenCalledOnce();
            expect(log.warn.mock.calls[0].join(' ')).toContain('synthetic-target');

            // 時間切れの後に元の書き出しが失敗しても、試み直さず、未処理の reject も残さない。
            pending.reject(errorWithCode('EIO'));
            await vi.advanceTimersByTimeAsync(10_000);
            expect(operation).toHaveBeenCalledOnce();
            expect(log.warn).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('[RE-5.12][Task 6.4] warns and goes on without writing out when the recording file writer does not close in 60 seconds', async () => {
        vi.useFakeTimers();
        const writer = { closed: false, end: vi.fn(), removeAllListeners: vi.fn(), once: vi.fn() };
        const harness = makeRecorder();
        harness.model.reserve = makeReserve();
        harness.model.recordedId = 21;
        harness.model.videoFileId = 31;
        harness.model.videoFileFulPath = '/synthetic-root/synthetic.ts';
        harness.model.recFile = writer;
        harness.model.updateDropFileLog = vi.fn(async () => undefined);
        const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile');
        const syncDirectory = vi.spyOn(RecordingStorageSync, 'syncDirectory');
        logger.system.warn.mockClear();
        try {
            const finalization = harness.model.recEnd();
            await vi.advanceTimersByTimeAsync(59_999);
            expect(harness.recordedDB.removeRecording).not.toHaveBeenCalled();
            expect(logger.system.warn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await finalization;

            expect(logger.system.warn).toHaveBeenCalledOnce();
            expect(logger.system.warn.mock.calls[0].join(' ')).toContain('/synthetic-root/synthetic.ts');
            expect(syncFile).not.toHaveBeenCalled();
            expect(syncDirectory).not.toHaveBeenCalled();
            expect(harness.recordedDB.removeRecording).toHaveBeenCalledWith(21);
            expect(harness.recordingEvent.emitFinishRecording).toHaveBeenCalledOnce();
        } finally {
            syncFile.mockRestore();
            syncDirectory.mockRestore();
            vi.useRealTimers();
        }
    });

    // 録画の保存先、一時録画先、移す前の録画 file。case ごとに `buildMove` が作り直す。
    let recordedRoot: string;
    let temporaryRoot: string;
    let oldPath: string;
    let mover: { movingFromTmp(reserve: unknown, videoFileId: number): Promise<string> };
    const destination = (): string => join(recordedRoot, 'synthetic.ts');
    const buildMove = async () => {
        recordedRoot = await mkdtemp(join(tmpdir(), 'epgstation-recording-move-recorded-'));
        temporaryRoot = await mkdtemp(join(tmpdir(), 'epgstation-recording-move-tmp-'));
        oldPath = join(temporaryRoot, '1.ts');
        const ledger: string[] = [];
        const pathUpdate = vi.fn(async () => {
            ledger.push('path');
        });
        mover = new RecordingUtilModel(
            { getLogger: () => logger },
            {
                getConfig: () => ({
                    recorded: [{ name: 'synthetic-root', path: recordedRoot }],
                    recordedFileExtension: '.ts',
                    recordedFormat: 'synthetic',
                    recordedTmp: temporaryRoot,
                }),
            },
            { getExecution: vi.fn(async () => 5), unLockExecution: vi.fn() },
            { findId: vi.fn(async () => null) },
            { findChannelIdAndTime: vi.fn(async () => null) },
            { updateFilePath: pathUpdate },
            { getFullFilePathFromId: vi.fn(async () => oldPath) },
        );
        await writeFile(oldPath, 'synthetic-payload');
        const cleanup = async (): Promise<void> => {
            await rm(recordedRoot, { recursive: true, force: true });
            await rm(temporaryRoot, { recursive: true, force: true });
        };
        return { cleanup, ledger, pathUpdate };
    };

    it('[RE-5.13][Task 6.4] writes out the destination and source directories of a renamed recording before recording its new path', async () => {
        const move = await buildMove();
        const sync = vi.spyOn(RecordingStorageSync, 'sync');
        const syncDirectory = vi
            .spyOn(RecordingStorageSync, 'syncDirectory')
            .mockImplementation(async (directoryPath: string) => {
                move.ledger.push(`directory:${directoryPath}`);
            });
        const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile');
        try {
            await expect(mover.movingFromTmp(makeReserve({ id: 1 }), 71)).resolves.toBe(destination());

            expect(move.ledger).toEqual([`directory:${recordedRoot}`, `directory:${temporaryRoot}`, 'path']);
            expect(syncFile).not.toHaveBeenCalled();
            expect(sync.mock.calls.map(call => call[0])).toEqual([recordedRoot, temporaryRoot]);
        } finally {
            sync.mockRestore();
            syncDirectory.mockRestore();
            syncFile.mockRestore();
            await move.cleanup();
        }
    });

    it('[RE-5.13][Task 6.4] writes out a copied recording and its directory before recording its new path and removing the temporary file', async () => {
        const move = await buildMove();
        const rename = vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(errorWithCode('EXDEV'));
        const syncFile = vi.spyOn(RecordingStorageSync, 'syncFile').mockImplementation(async (filePath: string) => {
            move.ledger.push(`file:${filePath}:${statSync(filePath).size}:${statSync(oldPath).size}`);
        });
        const syncDirectory = vi
            .spyOn(RecordingStorageSync, 'syncDirectory')
            .mockImplementation(async (directoryPath: string) => {
                move.ledger.push(`directory:${directoryPath}`);
            });
        try {
            await expect(mover.movingFromTmp(makeReserve({ id: 1 }), 71)).resolves.toBe(destination());

            const size = 'synthetic-payload'.length;
            expect(move.ledger).toEqual([`file:${destination()}:${size}:${size}`, `directory:${recordedRoot}`, 'path']);
            await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            rename.mockRestore();
            syncFile.mockRestore();
            syncDirectory.mockRestore();
            await move.cleanup();
        }
    });

    it.each(['failed', 'timed-out', 'missing'] as const)(
        '[RE-5.13][Task 6.4] keeps the temporary recording and removes the copy when the copy is %s to write out',
        async result => {
            const move = await buildMove();
            const rename = vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(errorWithCode('EXDEV'));
            const sync = vi
                .spyOn(RecordingStorageSync, 'sync')
                .mockImplementation(async (target: string) => (target === destination() ? result : 'synced'));
            try {
                await expect(mover.movingFromTmp(makeReserve({ id: 1 }), 71)).rejects.toThrow(
                    `RecordingFileSync: ${result}`,
                );

                expect(move.pathUpdate).not.toHaveBeenCalled();
                expect(await readFile(oldPath, 'utf8')).toBe('synthetic-payload');
                await expect(stat(destination())).rejects.toMatchObject({ code: 'ENOENT' });
            } finally {
                rename.mockRestore();
                sync.mockRestore();
                await move.cleanup();
            }
        },
    );

    it.each(['unsupported', 'synced'] as const)(
        '[RE-5.13][Task 6.4] completes a copy move whose copy is %s to write out',
        async result => {
            const move = await buildMove();
            const rename = vi.spyOn(fsPromises, 'rename').mockRejectedValueOnce(errorWithCode('EXDEV'));
            const sync = vi
                .spyOn(RecordingStorageSync, 'sync')
                .mockImplementation(async (target: string) => (target === destination() ? result : 'failed'));
            try {
                await expect(mover.movingFromTmp(makeReserve({ id: 1 }), 71)).resolves.toBe(destination());

                expect(move.pathUpdate).toHaveBeenCalledOnce();
                expect(await readFile(destination(), 'utf8')).toBe('synthetic-payload');
                await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
                expect(sync.mock.calls.map(call => call[0])).toEqual([destination(), recordedRoot]);
            } finally {
                rename.mockRestore();
                sync.mockRestore();
                await move.cleanup();
            }
        },
    );

    it('[RE-5.13][Task 6.4] completes a rename move even when its directories cannot be written out', async () => {
        const move = await buildMove();
        const sync = vi.spyOn(RecordingStorageSync, 'sync').mockImplementation(async () => 'failed');
        try {
            await expect(mover.movingFromTmp(makeReserve({ id: 1 }), 71)).resolves.toBe(destination());

            expect(move.pathUpdate).toHaveBeenCalledOnce();
            expect(await readFile(destination(), 'utf8')).toBe('synthetic-payload');
        } finally {
            sync.mockRestore();
            await move.cleanup();
        }
    });
});
