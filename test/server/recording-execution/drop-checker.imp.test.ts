import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load, logger, makeDropCheckerWriteTracker } from './_harness';

// 準備（await する fs 処理）の後に、同期の attach で stream へ繋ぐ。録画での呼び出し順と同じ。
const startDropChecker = async (
    target: { prepare(dir: string, src: string): Promise<void>; attach(src: string, stream: any): void },
    logDirPath: string,
    srcFilePath: string,
    readableStream: unknown,
): Promise<void> => {
    await target.prepare(logDirPath, srcFilePath);
    target.attach(srcFilePath, readableStream);
};

// packetDrop / packetError / packetScrambling の log 追記は event handler から await されずに
// 発火するため、getResult() の完了時点で書き込みが終わっているとは限らない。内容を読む test は
// 現れるまで待つ。
async function readLogUntilContains(path: string, expected: string): Promise<string> {
    const deadline = Date.now() + 5_000;
    let content = '';
    for (;;) {
        content = await readFile(path, 'utf8');
        if (content.includes(expected)) {
            return content;
        }
        if (Date.now() >= deadline) {
            // Returning the partial content here would report the missing line as a content
            // mismatch. Say that the append never arrived instead.
            throw new Error(`log did not contain ${expected} within the wait budget: ${content}`);
        }
        // Poll interval for the real condition (content.includes(expected)) checked above; not
        // a fixed wait-then-assume delay.
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

const DropCheckerModel = load<new (...args: any[]) => any>('model', 'operator', 'recording', 'DropCheckerModel.js');
const FileUtil = load<{
    access(filePath: string, mode?: number): Promise<void>;
    appendFile(file: string, str: string): Promise<void>;
}>('util', 'FileUtil.js');
const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
const TsCrc32 = requireFromProject('aribts/lib/crc32') as {
    calcToBuffer(buffer: Buffer): Buffer;
};

/**
 * Builds a single synthetic 188-byte MPEG-TS packet for aribts's TsPacketParser/TsPacketAnalyzer.
 * adaptationFieldControl: 0b01 payload-only (default), 0b11 adaptation+payload.
 */
const buildPacket = (options: {
    pid: number;
    continuityCounter: number;
    transportErrorIndicator?: 0 | 1;
    transportScramblingControl?: 0 | 1 | 2 | 3;
    adaptationFieldControl?: 0b01 | 0b11;
    discontinuityIndicator?: 0 | 1;
}): Buffer => {
    const {
        pid,
        continuityCounter,
        transportErrorIndicator = 0,
        transportScramblingControl = 0,
        adaptationFieldControl = 0b01,
        discontinuityIndicator = 0,
    } = options;
    const packet = Buffer.alloc(188, 0x00);
    packet[0] = 0x47;
    packet[1] = (transportErrorIndicator << 7) | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = (transportScramblingControl << 6) | (adaptationFieldControl << 4) | (continuityCounter & 0x0f);

    if (adaptationFieldControl === 0b11) {
        packet[4] = 1; // adaptation_field_length
        packet[5] = discontinuityIndicator << 7;
    }

    return packet;
};

const buildStream = (packets: Buffer[]): PassThrough => {
    const stream = new PassThrough();
    stream.end(Buffer.concat(packets));
    return stream;
};

const withSectionCrc = (sectionWithoutCrc: Buffer): Buffer =>
    Buffer.concat([sectionWithoutCrc, TsCrc32.calcToBuffer(sectionWithoutCrc)]);

/** PSI packet: PUSI=1, pointer_field=0, section payload, 0xFF padding. */
const buildPsiPacket = (pid: number, section: Buffer, continuityCounter = 0): Buffer => {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = (1 << 6) | ((pid >> 8) & 0x1f); // payload_unit_start_indicator
    packet[2] = pid & 0xff;
    packet[3] = (0b01 << 4) | (continuityCounter & 0x0f);
    packet[4] = 0x00; // pointer_field
    section.copy(packet, 5);
    return packet;
};

const buildPatSection = (pmtPid: number): Buffer => {
    const programs = Buffer.alloc(4);
    programs.writeUInt16BE(1, 0); // program_number
    programs.writeUInt16BE(0xe000 | (pmtPid & 0x1fff), 2);
    const mid = Buffer.alloc(5);
    mid.writeUInt16BE(0x0001, 0); // transport_stream_id
    mid[2] = 0xc1; // version 0, current_next 1
    mid[3] = 0;
    mid[4] = 0;
    const afterLength = Buffer.concat([mid, programs]);
    const sectionLength = afterLength.length + 4;
    const header = Buffer.alloc(3);
    header[0] = 0x00;
    header[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
    header[2] = sectionLength & 0xff;
    return withSectionCrc(Buffer.concat([header, afterLength]));
};

const buildPmtSection = (
    streams: Array<{ streamType: number; elementaryPid: number }>,
    pcrPid = 0x1fff,
): Buffer => {
    const streamPart = Buffer.concat(
        streams.map(({ streamType, elementaryPid }) => {
            const entry = Buffer.alloc(5);
            entry[0] = streamType;
            entry.writeUInt16BE(0xe000 | (elementaryPid & 0x1fff), 1);
            entry.writeUInt16BE(0xf000, 3); // ES_info_length 0
            return entry;
        }),
    );
    const mid = Buffer.alloc(9);
    mid.writeUInt16BE(1, 0); // program_number
    mid[2] = 0xc1;
    mid[3] = 0;
    mid[4] = 0;
    mid.writeUInt16BE(0xe000 | (pcrPid & 0x1fff), 5);
    mid.writeUInt16BE(0xf000, 7); // program_info_length 0
    const afterLength = Buffer.concat([mid, streamPart]);
    const sectionLength = afterLength.length + 4;
    const header = Buffer.alloc(3);
    header[0] = 0x02;
    header[1] = 0xb0 | ((sectionLength >> 8) & 0x0f);
    header[2] = sectionLength & 0xff;
    return withSectionCrc(Buffer.concat([header, afterLength]));
};

/** Elementary PIDs and stream_types that exercise every setIndex switch arm + one default. */
const setIndexStreams: Array<{ streamType: number; elementaryPid: number; finishName: string }> = [
    { streamType: 0x00, elementaryPid: 0x0110, finishName: 'ECM' },
    { streamType: 0x02, elementaryPid: 0x0111, finishName: 'MPEG2 VIDEO' },
    { streamType: 0x04, elementaryPid: 0x0112, finishName: 'MPEG2 AUDIO' },
    { streamType: 0x06, elementaryPid: 0x0113, finishName: '字幕' },
    { streamType: 0x0d, elementaryPid: 0x0114, finishName: 'データカルーセル' },
    { streamType: 0x0f, elementaryPid: 0x0115, finishName: 'MPEG2 AAC' },
    { streamType: 0x1b, elementaryPid: 0x0116, finishName: 'MPEG4 VIDEO' },
    { streamType: 0x24, elementaryPid: 0x0117, finishName: 'HEVC VIDEO' },
    // default arm formats the elementary PID, not the stream_type, into the name string
    { streamType: 0x81, elementaryPid: 0x0118, finishName: 'stream_type 0x0118' },
];

describe('[Task 3.6] DropCheckerModel drop/error/scrambling characterization', () => {
    let roots: string[] = [];
    const writes = makeDropCheckerWriteTracker();

    afterEach(async () => {
        // ログの追記が残っているうちに dir を消すと後片付けが競合するので、先に出し切らせる。
        await writes.settle();
        await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
        roots = [];
    });

    const makeRoot = async (): Promise<string> => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-drop-checker-'));
        roots.push(root);
        return root;
    };

    const makeChecker = () => writes.track(new DropCheckerModel({ getLogger: () => logger }));

    it('touches an empty log file named after the source file basename inside logDirPath', async () => {
        const root = await makeRoot();
        const checker = makeChecker();

        expect(checker.getFilePath()).toBeNull();

        await startDropChecker(checker, root, '/synthetic/recorded/synthetic-program.ts', buildStream([]));

        const expectedPath = join(root, 'synthetic-program.ts.log');
        expect(checker.getFilePath()).toBe(expectedPath);
        await expect(readFile(expectedPath, 'utf8')).resolves.toBe('');
    });

    it('creates logDirPath when it does not yet exist', async () => {
        const root = await makeRoot();
        const missingDir = join(root, 'nested', 'log-dir');
        const checker = makeChecker();

        await startDropChecker(checker, missingDir, 'synthetic-program.ts', buildStream([]));

        expect(checker.getFilePath()).toBe(join(missingDir, 'synthetic-program.ts.log'));
    });

    it('appends a numeric suffix when the destination log file already exists', async () => {
        const root = await makeRoot();
        await writeFile(join(root, 'synthetic-program.ts.log'), 'pre-existing');
        const checker = makeChecker();

        await startDropChecker(checker, root, 'synthetic-program.ts', buildStream([]));

        expect(checker.getFilePath()).toBe(join(root, 'synthetic-program.ts(1).log'));
    });

    it('counts zero drop/error/scrambling for a contiguous continuity-counter sequence', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const packets = [0, 1, 2, 3].map(cc => buildPacket({ pid: 0x0100, continuityCounter: cc }));

        await startDropChecker(checker, root, 'synthetic.ts', buildStream(packets));
        const result = await checker.getResult();

        expect(result[0x0100]).toEqual({ packet: 4, error: 0, drop: 0, scrambling: 0 });
    });

    it('counts a drop when the continuity counter skips the expected next value', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        // cc sequence 0,1,3 skips the expected 2 on the third packet.
        const packets = [0, 1, 3].map(cc => buildPacket({ pid: 0x0101, continuityCounter: cc }));

        await startDropChecker(checker, root, 'synthetic.ts', buildStream(packets));
        const result = await checker.getResult();

        expect(result[0x0101]).toEqual({ packet: 3, error: 0, drop: 1, scrambling: 0 });
        expect(await readLogUntilContains(checker.getFilePath()!, 'drop (pid: 0x0101')).toContain(
            'drop (pid: 0x0101',
        );
    });

    it('counts an error and skips drop/scrambling accounting for a transport_error_indicator packet', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const packets = [
            buildPacket({ pid: 0x0102, continuityCounter: 0 }),
            buildPacket({ pid: 0x0102, continuityCounter: 5, transportErrorIndicator: 1 }),
            buildPacket({ pid: 0x0102, continuityCounter: 1 }),
        ];

        await startDropChecker(checker, root, 'synthetic.ts', buildStream(packets));
        const result = await checker.getResult();

        // the errored packet (cc=5) is excluded from continuity tracking, so the third
        // packet (cc=1) is still evaluated against the first packet's counter (0) and is not a drop.
        expect(result[0x0102]).toEqual({ packet: 3, error: 1, drop: 0, scrambling: 0 });
    });

    it('counts a scrambling packet when transport_scrambling_control has its top bit set', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const packets = [
            buildPacket({ pid: 0x0103, continuityCounter: 0 }),
            buildPacket({ pid: 0x0103, continuityCounter: 1, transportScramblingControl: 0b10 }),
        ];

        await startDropChecker(checker, root, 'synthetic.ts', buildStream(packets));
        const result = await checker.getResult();

        expect(result[0x0103]).toEqual({ packet: 2, error: 0, drop: 0, scrambling: 1 });
    });

    it('stop() forces finish and captures the partial result even before the source stream ends', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const liveStream = new PassThrough();
        await startDropChecker(checker, root, 'synthetic.ts', liveStream);

        liveStream.write(buildPacket({ pid: 0x0104, continuityCounter: 0 }));
        liveStream.write(buildPacket({ pid: 0x0104, continuityCounter: 1 }));
        // deliberately never end() the stream — recording-in-progress characteristic.

        await checker.stop();
        const result = await checker.getResult();

        expect(result[0x0104]).toEqual({ packet: 2, error: 0, drop: 0, scrambling: 0 });
    });

    it('tolerates a second stop() call without throwing', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        await startDropChecker(checker, root, 'synthetic.ts', buildStream([buildPacket({ pid: 0x0105, continuityCounter: 0 })]));

        await checker.stop();
        await expect(checker.stop()).resolves.toBeUndefined();
    });

    it('getResult() rejects after 10 seconds when the source never finishes and stop() is never called', async () => {
        vi.useFakeTimers();
        try {
            const root = await makeRoot();
            const checker = makeChecker();
            const liveStream = new PassThrough();
            await startDropChecker(checker, root, 'synthetic.ts', liveStream);
            liveStream.write(buildPacket({ pid: 0x0106, continuityCounter: 0 }));

            const resultPromise = checker.getResult();
            const assertion = expect(resultPromise).rejects.toThrow('GetResultTimeout');
            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('[R2-DROPCHECKER-GETRESULT-NULL] rejects DestIsNull when dest is unset', async () => {
        const checker = makeChecker();

        expect(checker.getFilePath()).toBeNull();
        await expect(checker.getResult()).rejects.toThrow('DestIsNull');
    });

    it('characterizes finish-log PID names for every named getPIDName switch case', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        // Every named case arm in DropCheckerModel.getPIDName (L290–346), including multi-case labels.
        const namedPids: Array<{ pid: number; name: string }> = [
            { pid: 0x0000, name: 'PAT' },
            { pid: 0x0001, name: 'CAT' },
            { pid: 0x0010, name: 'NIT' },
            { pid: 0x0011, name: 'SDT/BAT' },
            { pid: 0x0012, name: 'EIT' },
            { pid: 0x0026, name: 'EIT' },
            { pid: 0x0027, name: 'EIT' },
            { pid: 0x0013, name: 'RST' },
            { pid: 0x0014, name: 'TDT/TOT' },
            { pid: 0x0017, name: 'DCT' },
            { pid: 0x001e, name: 'DIT' },
            { pid: 0x001f, name: 'SIT' },
            { pid: 0x0020, name: 'LIT' },
            { pid: 0x0021, name: 'ERT' },
            { pid: 0x0022, name: 'PCAT' },
            { pid: 0x0023, name: 'SDTT' },
            { pid: 0x0028, name: 'SDTT' },
            { pid: 0x0024, name: 'BIT' },
            { pid: 0x0025, name: 'NBIT/LDT' },
            { pid: 0x0029, name: 'CDT' },
            { pid: 0x1fff, name: 'NULL' },
        ];
        const packets = namedPids.map(({ pid }) => buildPacket({ pid, continuityCounter: 0 }));

        await startDropChecker(checker, root, 'synthetic-psi-si.ts', buildStream(packets));
        const result = await checker.getResult();
        // onFinish emits FINISH_EVENT before the per-PID name lines finish appending.
        const logPath = checker.getFilePath() as string;
        await vi.waitFor(async () => {
            const partial = await readFile(logPath, 'utf8');
            expect(partial).toContain('name: NULL');
        });
        const log = await readFile(logPath, 'utf8');

        for (const { pid, name } of namedPids) {
            expect(result[pid]).toMatchObject({ packet: 1 });
            expect(log).toContain(
                `pid: 0x${pid.toString(16).toUpperCase().padStart(4, '0')}, error: 0, drop: 0, scrambling: 0, packet: 1, name: ${name}`,
            );
        }
    });

    it('characterizes finish-log names filled by setIndex from a decoded PMT stream list', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const pmtPid = 0x0100;
        // RED baseline without PAT/PMT: elementary packets alone leave getPIDName default as '-'.
        // GREEN path feeds PAT+PMT so tsSectionUpdater.on('pmt') → setIndex for every stream_type arm.
        const packets = [
            buildPsiPacket(0x0000, buildPatSection(pmtPid), 0),
            buildPsiPacket(pmtPid, buildPmtSection(setIndexStreams), 0),
            ...setIndexStreams.map(({ elementaryPid }) =>
                buildPacket({ pid: elementaryPid, continuityCounter: 0 }),
            ),
        ];

        await startDropChecker(checker, root, 'synthetic-pmt-set-index.ts', buildStream(packets));
        await checker.getResult();
        const logPath = checker.getFilePath() as string;
        await vi.waitFor(async () => {
            const partial = await readFile(logPath, 'utf8');
            // Wait for the last elementary PID's full finish line (0x0118 default arm),
            // not an earlier PID, so the final append has completed before snapshot.
            expect(partial).toContain(
                'pid: 0x0118, error: 0, drop: 0, scrambling: 0, packet: 1, name: stream_type 0x0118',
            );
        });
        const log = await readFile(logPath, 'utf8');

        for (const { elementaryPid, finishName } of setIndexStreams) {
            expect(log).toContain(
                `pid: 0x${elementaryPid.toString(16).toUpperCase().padStart(4, '0')}, error: 0, drop: 0, scrambling: 0, packet: 1, name: ${finishName}`,
            );
        }
    });

    it('characterizes onFinish appendFile failure catches after a drop sets hasError', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        logger.system.error.mockClear();
        // Existing drop fixture: continuity skip sets hasError so onFinish takes the blank-line path.
        const packets = [0, 1, 3].map(cc => buildPacket({ pid: 0x0120, continuityCounter: cc }));
        const appendFailure = new Error('synthetic onFinish append failure');
        let appendCalls = 0;
        // First append is the mid-stream drop line (no .catch on the event handler).
        // Subsequent appends are onFinish blank-line + per-PID summary (both .catch bodies).
        const append = vi.spyOn(FileUtil, 'appendFile').mockImplementation(async () => {
            appendCalls += 1;
            if (appendCalls === 1) {
                return;
            }
            throw appendFailure;
        });

        await startDropChecker(checker, root, 'synthetic-append-failure.ts', buildStream(packets));
        await expect(checker.getResult()).resolves.toMatchObject({
            [0x0120]: expect.objectContaining({ drop: 1 }),
        });

        await vi.waitFor(() => {
            expect(logger.system.error).toHaveBeenCalledWith(expect.stringMatching(/^append error: /));
        });
        const appendErrorMessages = logger.system.error.mock.calls
            .map(call => call[0])
            .filter((message): message is string => typeof message === 'string' && message.startsWith('append error: '));
        // Blank-line catch (L150–153) and per-PID summary catch (L163–166) each log message + err.
        expect(appendErrorMessages.length).toBeGreaterThanOrEqual(2);
        expect(logger.system.error).toHaveBeenCalledWith(appendFailure);
        expect(append.mock.calls.length).toBeGreaterThanOrEqual(3);
        append.mockRestore();
    });

    it('[Task 3.6 gap] falls back a falsy actual counter or expected value to "-" in the drop log line', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        const packets = [
            // 14 -> 0 skips the expected 15: the actual (post-drop) counter is the falsy 0.
            buildPacket({ pid: 0x0130, continuityCounter: 14 }),
            buildPacket({ pid: 0x0130, continuityCounter: 0 }),
            // 15 -> 1 skips the expected 0: the skipped/expected value itself is the falsy 0.
            buildPacket({ pid: 0x0131, continuityCounter: 15 }),
            buildPacket({ pid: 0x0131, continuityCounter: 1 }),
        ];

        await startDropChecker(checker, root, 'synthetic-falsy-drop.ts', buildStream(packets));
        await checker.getResult();

        const log = await readLogUntilContains(checker.getFilePath()!, 'drop (pid: 0x0131');
        expect(log).toContain('drop (pid: 0x0130, counter: -, expected: 15, time: -)');
        expect(log).toContain('drop (pid: 0x0131, counter: 1, expected: -, time: -)');
    });

    it('[Task 3.6 gap] renders the latest section time recorded from a tsSectionAnalyzer time event', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        await startDropChecker(checker, root, 'synthetic-section-time.ts', new PassThrough());
        // JST 2024-01-06 00:06:07, matching the fixed startAt used by the filename-format suite.
        const observedTime = new Date(Date.UTC(2024, 0, 5, 15, 6, 7));

        (checker as any).tsSectionAnalyzer.emit('time', observedTime);
        (checker as any).tsPacketAnalyzer.emit('packetScrambling', 0x0150);

        const log = await readLogUntilContains(checker.getFilePath()!, 'scrambling (pid: 0x0150');
        expect(log).toContain('scrambling (pid: 0x0150, time: 2024/01/06 00:06:07)');

        await checker.stop();
    });

    it('[Task 3.6 gap] leaves onFinish a no-op when stop() is called before prepare() and attach()', async () => {
        const checker = makeChecker();

        await expect(checker.stop()).resolves.toBeUndefined();
        expect(checker.getFilePath()).toBeNull();
    });

    it('characterizes getLogFilePath permission failure when access rejects with non-ENOENT', async () => {
        const root = await makeRoot();
        const checker = makeChecker();
        logger.system.fatal.mockClear();
        const permissionError = Object.assign(new Error('synthetic logdir permission failure'), {
            code: 'EACCES',
        });
        const access = vi.spyOn(FileUtil, 'access').mockRejectedValue(permissionError);

        await expect(startDropChecker(checker, root, 'synthetic-permission.ts', buildStream([]))).rejects.toBe(
            permissionError,
        );

        expect(logger.system.fatal).toHaveBeenCalledWith(`dir permission error: ${root}`);
        expect(logger.system.fatal).toHaveBeenCalledWith(permissionError);
        expect(logger.system.fatal).toHaveBeenCalledTimes(2);
        expect(access).toHaveBeenCalledWith(root, expect.any(Number));
        access.mockRestore();
    });
});
