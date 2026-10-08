import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, load, logger, makeRecorder, makeReserve } from './_harness';

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');

const makeTsChunk = (fill: number): Buffer => {
    const packets = Buffer.alloc(188 * 2, fill);
    packets[0] = 0x47;
    packets[188] = 0x47;
    return packets;
};

describe('drop checker attach order', () => {
    it.each([
        {
            title: '[first-chunk-parity][Task 3.6][RE-3.10] drop checker receives the same first chunk as the recording writer',
            // 録画 file への pipe の直後、fs の完了より前に先頭の chunk が届く。
            chunkDuringPrepare: false,
            flowingBeforeRecording: false,
        },
        {
            title: '[Task 3.6][RE-3.10] keeps a chunk that arrives while preparing on an already flowing stream',
            // 時刻指定予約の stream は、開始時刻まで読み捨てた後も flowing のまま渡される。
            // 準備の await 中に届いた chunk が、録画 file と drop checker の両方に先頭から届く。
            chunkDuringPrepare: true,
            flowingBeforeRecording: true,
        },
    ])('$title', async ({ chunkDuringPrepare, flowingBeforeRecording }) => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-dropcheck-attach-'));
        const fullPath = join(root, 'synthetic.ts');
        const stream = new PassThrough();
        if (flowingBeforeRecording) {
            // listener を外しても、stream は paused に戻らず flowing のままになる。
            const drain = (): void => undefined;
            stream.on('data', drain);
            stream.removeListener('data', drain);
        }
        const firstChunk = makeTsChunk(0x11);
        const laterChunks: Buffer[] = [];
        let firstChunkWritten = false;

        // 実物の DropCheckerModel を使う。prepare() は実際の fs 処理（ログ先の確認、空 file の生成）を await する。
        const dropChecker = new DropCheckerModel({ getLogger: () => logger });
        const harness = makeRecorder({
            config: { isEnabledDropCheck: true, dropLog: root },
            dropChecker,
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
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        if (chunkDuringPrepare) {
            // 準備の fs 処理を待っている間に、先頭の chunk を流す。
            const prepare = dropChecker.prepare.bind(dropChecker);
            vi.spyOn(dropChecker, 'prepare').mockImplementation((async (...args: unknown[]) => {
                const pending = prepare(...args);
                stream.write(firstChunk);
                firstChunkWritten = true;
                await pending;
            }) as any);
        }

        // 録画 file への pipe の直後に先頭の chunk を流す。この時点から drop checker が stream に繋がるまでに
        // 流れた chunk が、drop checker に届くかを見る。drop checker 側の受信は、録画 file 以外へ pipe された
        // 先の data を記録して調べる。
        const received: Buffer[] = [];
        const originalPipe = stream.pipe.bind(stream);
        let recordingPipeSeen = false;
        vi.spyOn(stream, 'pipe').mockImplementation(((destination: any, options?: any) => {
            const result = originalPipe(destination, options);
            if (destination === harness.model.recFile) {
                recordingPipeSeen = true;
                if (!chunkDuringPrepare) {
                    // 呼び出し元の同期処理が終わった直後（fs の完了より前）に届く chunk として流す。
                    process.nextTick(() => {
                        stream.write(firstChunk);
                        firstChunkWritten = true;
                    });
                }
            } else if (destination instanceof Writable) {
                (destination as any).on('data', (chunk: Buffer) => received.push(Buffer.from(chunk)));
            }
            return result;
        }) as any);

        try {
            // 開始の完了は、準備の後に付く最初の data の listener が chunk を受けることで決まる。
            // 完了するまで、内容の異なる chunk を 1 つずつ流し続ける。
            let settled = false;
            const started = harness.model.doRecord().finally(() => {
                settled = true;
            });
            while (!settled) {
                if (!recordingPipeSeen || firstChunkWritten === false) {
                    await flushImmediate();
                    continue;
                }
                const chunk = makeTsChunk(0x22 + laterChunks.length);
                laterChunks.push(chunk);
                stream.write(chunk);
                await flushImmediate();
            }
            await started;
            expect(recordingPipeSeen).toBe(true);
            await flushImmediate();

            const writer = harness.model.recFile;
            const finished = once(writer, 'finish');
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await finished;
            await flushImmediate();

            const recorded = await readFile(fullPath);
            expect(recorded.equals(Buffer.concat([firstChunk, ...laterChunks]))).toBe(true);
            const checked = Buffer.concat(received);
            expect(checked.length).toBe(recorded.length);
            expect(checked.equals(recorded)).toBe(true);
        } finally {
            harness.model.isCanceledCallingFinished = true;
            harness.model.destroyStream();
            await dropChecker.stop();
            await rm(root, { recursive: true, force: true });
        }
    });
});
