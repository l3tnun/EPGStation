import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { baseConfig, compiled, fakeChild, logger, prepareEncodeProcessManageModel, spawnStub } from './_media-harness';

const ProcessUtil = compiled<any>('util', 'ProcessUtil.js').default;
const LiveHLSStreamModel = compiled<any>('model', 'service', 'stream', 'LiveHLSStreamModel.js').default;
const LiveStreamModel = compiled<any>('model', 'service', 'stream', 'LiveStreamModel.js').default;
const RecordedHLSStreamModel = compiled<any>('model', 'service', 'stream', 'RecordedHLSStreamModel.js').default;

let EncodeProcessManageModel: new (...args: any[]) => any;
beforeAll(async () => {
    EncodeProcessManageModel = await prepareEncodeProcessManageModel();
});

afterEach(() => vi.restoreAllMocks());

const createProcessManager = () =>
    new EncodeProcessManageModel({ getLogger: logger }, { getConfig: () => baseConfig() });

const createLiveHls = (config = baseConfig()) =>
    new LiveHLSStreamModel(
        { getConfig: () => config },
        { getLogger: logger },
        {},
        { deleteAllFiles: async () => undefined, setOption: () => undefined },
        { getServiceStream: async () => undefined },
        { notifyClient: () => undefined },
    );

const createRecordedHls = (config = baseConfig()) =>
    new RecordedHLSStreamModel(
        { getConfig: () => config },
        { getLogger: logger },
        {},
        { deleteAllFiles: async () => undefined, setOption: () => undefined },
        { notifyClient: () => undefined },
        {},
        {},
        {},
    );

describe('command parser compatibility', () => {
    it('[PRIMARY R9.2] splits a viewer command only on literal spaces without interpreting quotes or shell syntax', () => {
        const result = ProcessUtil.parseCmdStr("%NODE% first  %ROOT%/a%SPACE%b 'quoted' | shell");
        expect(result.bin).toBe(process.argv[0]);
        expect(result.args).toEqual(['first', `${ProcessUtil.ROOT_PATH}/a b`, "'quoted'", '|', 'shell']);
    });

    it('[MD-5.1] preserves the missing executable failure', () => {
        expect(() => ProcessUtil.parseCmdStr('/definitely/missing/epgstation-command')).toThrow('CmdBinIsNotFound');
    });

    it('[PRIMARY R9.1] starts no managed process when a live delivery has no transform command', async () => {
        const tuner = new PassThrough();
        const close = vi.fn(() => tuner.destroy());
        const processManager = { createManaged: vi.fn(), requestStop: vi.fn() };
        const live = new LiveStreamModel(
            { getConfig: () => baseConfig() },
            { getLogger: logger },
            processManager,
            { deleteAllFiles: async () => undefined, setOption: () => undefined },
            { openServiceStream: vi.fn(async () => ({ close, stream: tuner })) },
            { notifyClient: () => undefined },
        );
        live.setOption({ channelId: 101 }, 0);

        await live.start(0);

        expect(live.getStream()).toBe(tuner);
        expect(processManager.createManaged).not.toHaveBeenCalled();
        await live.stop();
        expect(close).toHaveBeenCalledOnce();
    });

    it('[PRIMARY R9.3] sends parser-expanded node, root, input, and output arguments to the spawned process', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();

        await manager.create({
            cmd: '%NODE% %ROOT%/a%SPACE%b %INPUT% %OUTPUT%',
            input: 'synthetic-input',
            output: 'synthetic-output',
            priority: 1,
        });

        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], [
            `${ProcessUtil.ROOT_PATH}/a b`,
            'synthetic-input',
            'synthetic-output',
        ]);
    });

    it('[PRIMARY R9.4] substitutes the configured FFmpeg path before creating a live HLS process option', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();
        const live = createLiveHls(baseConfig({ ffmpeg: process.argv[0] }));
        live.setOption({ channelId: 101, cmd: '%FFMPEG%' }, 0);

        const option = live.createProcessOption(17);
        expect(option).toMatchObject({ cmd: process.argv[0] });
        await manager.create(option);
        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], []);
    });

    it('[PRIMARY R9.5] substitutes the HLS directory and decimal stream identifier in a live HLS process option', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();
        const live = createLiveHls();
        live.setOption({ channelId: 101, cmd: '%streamFileDir% %streamNum%' }, 0);

        const option = live.createProcessOption(17);
        expect(option).toMatchObject({
            cmd: 'synthetic-stream-root 17',
            output: 'synthetic-stream-root/stream17.m3u8',
        });
        option.cmd = `%NODE% ${option.cmd}`;
        await manager.create(option);
        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], ['synthetic-stream-root', '17']);
    });

    it('[PRIMARY R9.6] substitutes the recorded seek placeholder by source type before creating an HLS process option', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();
        const recorded = createRecordedHls(baseConfig({ ffmpeg: process.argv[0] }));
        recorded.setOption({ cmd: '%FFMPEG% %SS%', playPosition: 12.5, videoFileId: 31 }, 0);
        recorded.videoFilePath = 'synthetic/video.ts';
        recorded.videoFileInfo = { bitRate: 8, duration: 30, size: 30 };
        recorded.videoFileType = 'ts';

        const tsOption = await recorded.createProcessOption(7);
        expect(tsOption).toMatchObject({ cmd: `${process.argv[0]} ` });
        await manager.create(tsOption);

        recorded.videoFileType = 'encoded';
        const encodedOption = await recorded.createProcessOption(7);
        expect(encodedOption).toMatchObject({ cmd: `${process.argv[0]} 12.5` });
        await manager.create(encodedOption);
        expect(spawnStub).toHaveBeenNthCalledWith(1, process.argv[0], []);
        expect(spawnStub).toHaveBeenNthCalledWith(2, process.argv[0], ['12.5']);
    });

    it('[PRIMARY R9.7] leaves placeholders whose input, output, or stream values do not apply unchanged', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();

        await manager.create({
            cmd: '%NODE% %INPUT% %OUTPUT% %streamFileDir% %streamNum% %SS%',
            input: null,
            output: null,
            priority: 1,
        });

        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], [
            '%INPUT%',
            '%OUTPUT%',
            '%streamFileDir%',
            '%streamNum%',
            '%SS%',
        ]);
    });

    it('[PRIMARY R9.8] starts ordinary viewer transforms without an explicit environment override', async () => {
        const child = fakeChild();
        spawnStub.mockImplementation(() => child);
        const manager = createProcessManager();

        await manager.create({ cmd: '%NODE% inherited-environment', input: null, output: null, priority: 1 });

        expect(spawnStub).toHaveBeenCalledWith(process.argv[0], ['inherited-environment']);
    });
});
