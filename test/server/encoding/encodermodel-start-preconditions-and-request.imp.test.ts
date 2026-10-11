import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncoderModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: new (...args: unknown[]) => any;
    }
).default;

const temporaryRoots: string[] = [];

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) await rm(root, { force: true, recursive: true });
});

const baseRecorded = (overrides: Record<string, unknown> = {}) => ({
    audioComponentType: null,
    audioSamplingRate: null,
    channelId: 903,
    description: null,
    dropLogFile: null,
    duration: 9,
    endAt: 19,
    extended: null,
    genre1: null,
    genre2: null,
    genre3: null,
    halfWidthDescription: null,
    halfWidthExtended: null,
    halfWidthName: 'half name',
    id: 901,
    name: 'Synthetic recording',
    startAt: 10,
    subGenre1: null,
    subGenre2: null,
    subGenre3: null,
    videoComponentType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoType: null,
    ...overrides,
});

interface HarnessOptions {
    channel?: unknown;
    encode?: Array<Record<string, unknown>>;
    inputExists?: boolean;
    option?: Record<string, unknown>;
    recorded?: unknown;
    video?: unknown;
}

const makeHarness = async (options: HarnessOptions = {}) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-encoder-start-gaps-'));
    temporaryRoots.push(root);
    const inputPath = join(root, 'recording.ts');
    if (options.inputExists !== false) await writeFile(inputPath, 'input');
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.exitCode = null;
    child.pid = 73_200;
    child.signalCode = null;
    child.stderr = null;
    child.stdin = null;
    child.stdout = null;
    const createManaged = vi.fn(async (_request: unknown) => ({ child, handle: {} }));
    const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const reserveOutput = vi.fn(async (directory: string, _input: string, suffix: string) =>
        join(directory, `result${suffix}`),
    );
    const model = new EncoderModel(
        { getLogger: () => ({ encode: log }) },
        {
            getConfig: () => ({
                encode: options.encode ?? [{ cmd: '%NODE%', name: 'synthetic-mode' }],
                ffmpeg: join(root, 'ffmpeg'),
                ffprobe: join(root, 'ffprobe'),
            }),
        },
        { create: vi.fn(), createManaged, requestStop: vi.fn() },
        { getFilePath: reserveOutput, release: vi.fn() },
        { findId: vi.fn(async () => ('video' in options ? options.video : { id: 902 })) },
        { findId: vi.fn(async () => ('recorded' in options ? options.recorded : baseRecorded())) },
        {
            findId: vi.fn(async () =>
                'channel' in options ? options.channel : { halfWidthName: 'half channel', id: 903, name: 'Channel' },
            ),
        },
        {
            getFullFilePathFromId: vi.fn(async () => inputPath),
            getInfo: vi.fn(async () => null),
            getParentDirPath: vi.fn(() => root),
        },
        {
            emitAddEncode: vi.fn(),
            emitCancelEncode: vi.fn(),
            emitErrorEncode: vi.fn(),
            emitFinishEncode: vi.fn(),
            emitUpdateEncodeProgress: vi.fn(),
        },
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    model.setOnFinish(() => {});
    model.setOption({
        encodeId: 908,
        mode: 'synthetic-mode',
        parentDir: 'synthetic-parent',
        recordedId: 901,
        removeOriginal: false,
        sourceVideoFileId: 902,
        ...options.option,
    });
    const env = (): Record<string, string> =>
        (createManaged.mock.calls[0][0] as { spawnOption: { env: Record<string, string> } }).spawnOption.env;
    const settle = (): void => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
    };
    return { child, createManaged, env, inputPath, log, model, reserveOutput, root, settle };
};

/**
 * EncoderModel.start が、エンコードの前提（元ファイル・録画情報・放送局・コマンド設定）を揃える段階の
 * 失敗の種類と、プロセスへ渡す環境変数・記録する診断ログ。
 */
describe('EncoderModel start preconditions (unittest/imp)', () => {
    it.each([
        ['the source video file', { video: null }, 'VideoFileIdIsNotFound'],
        ['the recorded program', { recorded: null }, 'RecordedIsNotFound'],
        ['the channel', { channel: null }, 'ChannelIsNotFound'],
    ] as const)('[EN-SPEC-R8-2] rejects with a stable error when %s is not found', async (_label, options, message) => {
        const harness = await makeHarness(options);

        await expect(harness.model.start()).rejects.toThrow(message);

        expect(harness.createManaged).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R8-2] logs the source path and rethrows when the source video file is missing', async () => {
        const harness = await makeHarness({ inputExists: false });

        await expect(harness.model.start()).rejects.toMatchObject({ code: 'ENOENT' });

        expect(harness.log.error).toHaveBeenCalledWith(`video file is not found: ${harness.inputPath}`);
        expect(harness.createManaged).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R8-2] rejects when the mode has no encode command and uses the command whose name matches the mode', async () => {
        const unknown = await makeHarness({ option: { mode: 'unknown-mode' } });

        await expect(unknown.model.start()).rejects.toThrow('EncodeCommandIsNotFound');
        expect(unknown.createManaged).not.toHaveBeenCalled();

        const harness = await makeHarness({
            encode: [
                { cmd: 'first-command', name: 'first-mode' },
                { cmd: 'second-command', name: 'synthetic-mode' },
            ],
        });

        await harness.model.start();

        expect(harness.createManaged.mock.calls[0][0]).toMatchObject({ cmd: 'second-command' });
        harness.settle();
    });

    it('[EN-SPEC-R8-2] logs and rejects when the parent directory setting is unknown', async () => {
        const harness = await makeHarness();
        (harness.model as any).videoUtil.getParentDirPath = vi.fn(() => null);

        await expect(harness.model.getDirPath({ directory: 'nested', parentDir: 'unknown-parent', recordedId: 901 })).rejects.toThrow(
            'parentDirIsNotFound',
        );

        expect(harness.log.error).toHaveBeenCalledWith('parent dir config is not found: unknown-parent');
    });
});

describe('EncoderModel start process request (unittest/imp)', () => {
    it('[EN-SPEC-R8-2] creates the output directory and passes the reserved output file to the process and the log', async () => {
        const harness = await makeHarness({
            encode: [{ cmd: '%NODE%', name: 'synthetic-mode', suffix: '.mp4' }],
            option: { directory: 'nested' },
        });

        await harness.model.start();

        const outputDirectory = join(harness.root, 'nested');
        const outputPath = join(outputDirectory, 'result.mp4');
        expect(harness.log.info).toHaveBeenCalledWith(`mkdirp: ${outputDirectory}`);
        expect(harness.reserveOutput).toHaveBeenCalledExactlyOnceWith(outputDirectory, harness.inputPath, '.mp4');
        expect(harness.createManaged.mock.calls[0][0]).toMatchObject({ input: harness.inputPath, output: outputPath });
        expect(harness.env()).toMatchObject({ DIR: outputPath, INPUT: harness.inputPath, OUTPUT: outputPath, SUBDIR: 'nested' });
        expect(harness.log.info.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            `mkdirp: ${outputDirectory}`,
            `encode start. mode: synthetic-mode name: Synthetic recording file: ${harness.inputPath} -> ${outputPath}`,
            'encodeId: 908',
            'encodeCmd.suffix: .mp4',
            'queueItem.directory: nested',
            `outputFilePath: ${outputPath}`,
        ]);
        harness.settle();
    });

    it('[EN-SPEC-R8-2] logs a command without a suffix with its directory and no output file', async () => {
        const harness = await makeHarness({ option: { directory: 'nested' } });

        await harness.model.start();

        expect(harness.log.info.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            `encode start. mode: synthetic-mode name: Synthetic recording file: ${harness.inputPath} -> null`,
            'encodeId: 908',
            'encodeCmd.suffix: undefined',
            'queueItem.directory: nested',
            'outputFilePath: null',
        ]);
        expect(harness.env()).toMatchObject({ DIR: 'nested', OUTPUT: '' });
        harness.settle();
    });

    it('[EN-SPEC-R8-2] passes every present metadata value to the process as a decimal string', async () => {
        const harness = await makeHarness({
            recorded: baseRecorded({
                audioComponentType: 4,
                audioSamplingRate: 3,
                description: 'description',
                dropLogFile: { dropCnt: 13, errorCnt: 12, filePath: 'drop.log', id: 11, scramblingCnt: 14 },
                extended: 'extended',
                genre1: 5,
                genre2: 7,
                genre3: 9,
                halfWidthDescription: 'half description',
                halfWidthExtended: 'half extended',
                subGenre1: 6,
                subGenre2: 8,
                subGenre3: 10,
                videoComponentType: 2,
                videoResolution: '1080i',
                videoStreamContent: 1,
                videoType: 'mpeg2',
            }),
        });

        await harness.model.start();

        expect(harness.env()).toMatchObject({
            AUDIOCOMPONENTTYPE: '4',
            AUDIOSAMPLINGRATE: '3',
            DESCRIPTION: 'description',
            DROPLOG_ID: '11',
            DROPLOG_PATH: 'drop.log',
            DROP_CNT: '13',
            ERROR_CNT: '12',
            EXTENDED: 'extended',
            GENRE1: '5',
            GENRE2: '7',
            GENRE3: '9',
            HALF_WIDTH_DESCRIPTION: 'half description',
            HALF_WIDTH_EXTENDED: 'half extended',
            SCRAMBLING_CNT: '14',
            SUBGENRE1: '6',
            SUBGENRE2: '8',
            SUBGENRE3: '10',
            VIDEOCOMPONENTTYPE: '2',
            VIDEORESOLUTION: '1080i',
            VIDEOSTREAMCONTENT: '1',
            VIDEOTYPE: 'mpeg2',
        });
        harness.settle();
    });

    it('[EN-SPEC-R8-2] passes empty strings for every missing metadata value', async () => {
        const harness = await makeHarness({ recorded: baseRecorded({ dropLogFile: undefined }) });

        await harness.model.start();

        expect(harness.env()).toMatchObject({
            AUDIOCOMPONENTTYPE: '',
            AUDIOSAMPLINGRATE: '',
            DESCRIPTION: '',
            DROPLOG_ID: '',
            DROPLOG_PATH: '',
            DROP_CNT: '',
            ERROR_CNT: '',
            EXTENDED: '',
            GENRE1: '',
            GENRE2: '',
            GENRE3: '',
            HALF_WIDTH_DESCRIPTION: '',
            HALF_WIDTH_EXTENDED: '',
            SCRAMBLING_CNT: '',
            SUBGENRE1: '',
            SUBGENRE2: '',
            SUBGENRE3: '',
            VIDEOCOMPONENTTYPE: '',
            VIDEORESOLUTION: '',
            VIDEOSTREAMCONTENT: '',
            VIDEOTYPE: '',
        });
        harness.settle();
    });
});
