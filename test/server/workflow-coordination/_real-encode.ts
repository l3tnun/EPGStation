import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';

import { load } from '../recording-execution/_harness';
import { EncodeEvent, makeLogger } from '../event-and-hook-delivery/_harness';
import type { World } from './_real-workflow';

/*
 * 本物のエンコード（EncodeManageModel・EncoderModel・EncodeProcessManageModel）を、実の子 process で動かす配線。
 * エンコードの command は、出力 file に書き始めて終了しない node の script。取り消すと process が止まり、出力 file が消える。
 */

const load2 = <T>(...segments: string[]) => load<T>(...segments);
const EncodeManageModel = load2<new (...args: any[]) => any>('model', 'service', 'encode', 'EncodeManageModel.js');
const EncoderModel = load2<new (...args: any[]) => any>('model', 'service', 'encode', 'EncoderModel.js');
const EncodeProcessManageModel = load2<new (...args: any[]) => any>(
    'model',
    'service',
    'encode',
    'EncodeProcessManageModel.js',
);
const EncodeFileManageModel = load2<new () => any>('model', 'service', 'encode', 'EncodeFileManageModel.js');

export const createRealEncode = async (world: World) => {
    const script = join(world.root, 'long-encode.cjs');
    await writeFile(
        script,
        [
            "const fs = require('node:fs');",
            "if (process.env.OUTPUT) fs.writeFileSync(process.env.OUTPUT, 'partial output');",
            "setInterval(() => undefined, 1000);",
        ].join('\n'),
    );
    const log = { ...makeLogger(), encode: makeLogger().system };
    const loggerModel = { getLogger: () => log };
    const processManager = new EncodeProcessManageModel(loggerModel, { getConfig: () => ({ encodeProcessNum: 2 }) });
    const encodeEvent = new EncodeEvent(loggerModel);
    const encoders: any[] = [];
    const config = {
        encode: [{ cmd: `%NODE% ${script}`, name: 'long', suffix: '.mp4' }],
        ffmpeg: join(world.root, 'ffmpeg'),
        ffprobe: join(world.root, 'ffprobe'),
    };
    const provider = vi.fn(async () => {
        const encoder = new EncoderModel(
            loggerModel,
            { getConfig: () => config },
            processManager,
            new EncodeFileManageModel(),
            world.videoFileDB,
            world.recordedDB,
            { findId: vi.fn(async () => ({ halfWidthName: 'synthetic-channel', id: 21, name: 'synthetic-channel' })) },
            world.videoUtil,
            encodeEvent,
            world.wired.recordingUtil,
        );
        encoders.push(encoder);
        return encoder;
    });
    const manage = new EncodeManageModel(
        loggerModel,
        { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
        { getExecution: vi.fn(async () => 'synthetic-execution'), unLockExecution: vi.fn() },
        provider,
        encodeEvent,
        { acquire: vi.fn(async () => ({ token: {} })), release: vi.fn(async () => undefined) },
    );
    return {
        encoders,
        log,
        manage,
        processManager,
        /** エンコードを積む（先頭の 1 件が実行中、残りは待機中になる）。 */
        push: (recordedId: number, sourceVideoFileId: number) =>
            manage.push({
                directory: 'encode-out',
                mode: 'long',
                parentDir: 'synthetic-root',
                recordedId,
                removeOriginal: false,
                sourceVideoFileId,
            }) as Promise<number>,
        /** 後始末（残っている子 process を止める）。 */
        dispose: async () => {
            for (const encoder of encoders) {
                const child = encoder.childProcess as { exitCode: number | null; kill(signal?: string): boolean } | null;
                if (child !== null && child.exitCode === null) child.kill('SIGKILL');
            }
            (manage as { listener: { removeAllListeners(): void } }).listener.removeAllListeners();
            (encodeEvent as { emitter: { removeAllListeners(): void } }).emitter.removeAllListeners();
        },
    };
};
