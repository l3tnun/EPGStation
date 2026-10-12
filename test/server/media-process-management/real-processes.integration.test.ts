import 'reflect-metadata';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * 共有実行枠の test の多くは、子 process を偽物（synthetic child）にし、ProcessUtil を spy にしている。ここでは本物の
 * EncodeProcessManageModel と本物の ProcessUtil で、実際に起動した process group（Linux）に signal を送り、実行枠の
 * 数え方・停止の重複・遅れて届く終了通知が、偽物のときと同じ結果になることを確かめる。signal は本物が受け取り、
 * process.kill は呼び出しを記録しながら本物へ通す（signal を握りつぶさない）。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EncodeProcessManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeProcessManageModel.js')) as { default: any }
).default;
const LiveStreamModel = (
    require(join(compiledSnapshot, 'model', 'service', 'stream', 'LiveStreamModel.js')) as { default: any }
).default;

const temporaryDirectories: string[] = [];
const processGroups = new Set<number>();
const pids = new Set<number>();

afterEach(() => {
    for (const pgid of processGroups) {
        try {
            process.kill(-pgid, 'SIGKILL');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    }
    processGroups.clear();
    for (const pid of pids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    }
    pids.clear();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
    vi.restoreAllMocks();
});

const makeManager = (maximum: number): any =>
    new EncodeProcessManageModel(
        { getLogger: () => ({ encode: { error: vi.fn(), info: vi.fn() }, stream: { warn: vi.fn() } }) },
        { getConfig: () => ({ encodeProcessNum: maximum }) },
    );

const registryOf = (manager: any): Array<{ pgid?: number }> => manager.childs;

const option = (cmd: string, priority = 1) => ({ cmd, input: null as null, output: null as null, priority });

const waitFor = (condition: () => boolean, message: string): Promise<void> =>
    vi.waitFor(() => expect(condition(), message).toBe(true), { interval: 10, timeout: 10_000 });

const groupAlive = (pgid: number): boolean => {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
    }
};

const read = (path: string): string | null => {
    try {
        return readFileSync(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
};

/**
 * 受けた signal を `<name>.signals` に 1 行ずつ書く writer の script。`late-close` を指定すると、別の process group の
 * 子孫を起こして標準出力・標準エラーの pipe を持たせる（writer が終わっても `close` が遅れる）。
 */
const makeWriter = (name: string, lateClose = false) => {
    const root = mkdtempSync(join(tmpdir(), 'epgstation-real-process-'));
    temporaryDirectories.push(root);
    const script = join(root, `${name}.cjs`);
    const signals = join(root, `${name}.signals`);
    const ready = join(root, `${name}.ready`);
    const descendant = join(root, `${name}.descendant`);
    writeFileSync(
        script,
        [
            "const fs = require('node:fs');",
            "const { spawn } = require('node:child_process');",
            `const signals = ${JSON.stringify(signals)};`,
            `const ready = ${JSON.stringify(ready)};`,
            `const descendant = ${JSON.stringify(descendant)};`,
            "for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {",
            '    process.on(name, () => {',
            "        fs.appendFileSync(signals, name + '\\n');",
            "        if (name === 'SIGINT') process.exit(0);",
            '    });',
            '}',
            lateClose
                ? [
                      "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {",
                      "    detached: true, stdio: ['ignore', 'inherit', 'inherit'],",
                      '});',
                      'fs.writeFileSync(descendant, String(child.pid));',
                      'child.unref();',
                  ].join('\n')
                : '',
            'setInterval(() => undefined, 1000);',
            "fs.writeFileSync(ready, 'ready');",
        ].join('\n'),
    );
    return {
        cmd: `${process.execPath} ${script}`,
        signals: () => read(signals),
        isReady: () => read(ready) !== null,
        descendantPid: () => {
            const text = read(descendant);
            return text === null ? null : Number(text);
        },
    };
};

const startWriter = async (manager: any, writer: ReturnType<typeof makeWriter>) => {
    const started = await manager.createHlsWriter(option(writer.cmd));
    processGroups.add(started.child.pid);
    await waitFor(() => writer.isReady(), 'writer is ready');
    return started;
};

const signalCalls = (kill: { mock: { calls: unknown[][] } }, pgid: number): unknown[] =>
    kill.mock.calls.filter(call => call[0] === -pgid && call[1] !== 0).map(call => call[1]);

describe('shared execution slots against real process groups', () => {
    it('[MP-1.6] never takes an execution slot for a live delivery that needs no transform', async () => {
        const manager = makeManager(1);
        const occupier = makeWriter('occupier');
        const held = await manager.createManaged(option(occupier.cmd, 10));
        pids.add(held.child.pid);
        await waitFor(() => occupier.isReady(), 'occupier is ready');
        expect(registryOf(manager)).toHaveLength(1);

        const source = new PassThrough();
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epgstation-real-live-'));
        temporaryDirectories.push(streamFilePath);
        const live = new LiveStreamModel(
            { getConfig: () => ({ ffmpeg: process.execPath, streamFilePath, streamingPriority: 1 }) },
            { getLogger: () => ({ stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            manager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            {
                openServiceStream: async () => ({ stream: source, close: () => source.destroy() }),
            },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 101 }, 0);
        // 唯一の枠が使われていても、変換の無い配信は始まり、受信した data を流す。
        await live.start(7);
        const received = new Promise<Buffer>(resolve => live.getStream().once('data', resolve));
        source.write(Buffer.from('synthetic-live-payload'));
        await expect(received).resolves.toEqual(Buffer.from('synthetic-live-payload'));
        // 枠を使っていない: 一覧は枠を持つ 1 件のまま、別の変換は（同じ優先度では）これまでどおり拒否される。
        expect(registryOf(manager)).toHaveLength(1);
        await expect(manager.createManaged(option(occupier.cmd, 1))).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );

        await live.stop();
        // 配信を止めても、枠の数は増えも減りもしない。
        expect(registryOf(manager)).toHaveLength(1);
        await manager.requestStop(held.handle);
        await waitFor(() => registryOf(manager).length === 0, 'slot released after the holder stops');
    }, 30_000);

    it('[MP-1.6] lets a transform use the only slot while a direct live delivery is running', async () => {
        const manager = makeManager(1);
        const source = new PassThrough();
        const streamFilePath = mkdtempSync(join(tmpdir(), 'epgstation-real-live-'));
        temporaryDirectories.push(streamFilePath);
        const live = new LiveStreamModel(
            { getConfig: () => ({ ffmpeg: process.execPath, streamFilePath, streamingPriority: 1 }) },
            { getLogger: () => ({ stream: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }) },
            manager,
            { deleteAllFiles: vi.fn(async () => undefined), setOption: vi.fn() },
            { openServiceStream: async () => ({ stream: source, close: () => source.destroy() }) },
            { notifyClient: vi.fn() },
        );
        live.setOption({ channelId: 102 }, 0);
        await live.start(8);
        expect(registryOf(manager)).toHaveLength(0);

        const writer = makeWriter('beside-direct');
        const started = await startWriter(manager, writer);
        expect(registryOf(manager)).toHaveLength(1);
        await manager.stopHls(started.handle);
        expect(registryOf(manager)).toHaveLength(0);
        await live.stop();
    }, 30_000);

    it('[MP-6.10][MP-6.6] sends one SIGINT to a real writer group for duplicate stops and none after the stop finished', async () => {
        const manager = makeManager(1);
        const writer = makeWriter('idempotent');
        const started = await startWriter(manager, writer);
        const pgid = started.child.pid as number;
        const kill = vi.spyOn(process, 'kill');

        const first = manager.stopHls(started.handle);
        const second = manager.stopHls(started.handle);
        expect(second).toBe(first);
        await expect(first).resolves.toEqual({ exitConfirmed: true, sentSignals: ['SIGINT'], slotReleased: true });
        // writer 自身が受け取った signal は SIGINT が 1 回だけ。
        expect(writer.signals()).toBe('SIGINT\n');
        expect(registryOf(manager)).toEqual([]);
        expect(groupAlive(pgid)).toBe(false);

        // 停止が終わった後の再停止は停止済みの結果を返し、signal を送らない。
        await expect(manager.stopHls(started.handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        await expect(manager.stopHls(started.handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        expect(signalCalls(kill, pgid)).toEqual(['SIGINT']);
        expect(writer.signals()).toBe('SIGINT\n');
    }, 30_000);

    it('[MP-6.9] ignores a stale handle after its slot was reused by a newer real group', async () => {
        const manager = makeManager(1);
        const older = await startWriter(manager, makeWriter('stale-old'));
        await manager.stopHls(older.handle);
        expect(registryOf(manager)).toEqual([]);

        const newerWriter = makeWriter('stale-new');
        const newer = await startWriter(manager, newerWriter);
        const newerPgid = newer.child.pid as number;
        const kill = vi.spyOn(process, 'kill');

        // 古い handle での停止は、signal を増やさず、新しい世代を止めず、枠も解放しない。
        await expect(manager.stopHls(older.handle)).resolves.toEqual({
            exitConfirmed: true,
            sentSignals: [],
            slotReleased: true,
        });
        await expect(manager.requestStop(older.handle)).resolves.toEqual({
            sentSignals: [],
            status: 'already-released',
        });
        expect(signalCalls(kill, newerPgid)).toEqual([]);
        expect(newerWriter.signals()).toBeNull();
        expect(groupAlive(newerPgid)).toBe(true);
        expect(registryOf(manager)).toHaveLength(1);
        await expect(manager.createHlsWriter(option(newerWriter.cmd))).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );

        await manager.stopHls(newer.handle);
        expect(registryOf(manager)).toEqual([]);
    }, 30_000);

    it('[MP-6.7] keeps a newer real group and the slot count intact when the released generation closes late', async () => {
        const manager = makeManager(1);
        const olderWriter = makeWriter('late-old', true);
        const older = await startWriter(manager, olderWriter);
        await waitFor(() => olderWriter.descendantPid() !== null, 'descendant pid is published');
        const descendant = olderWriter.descendantPid() as number;
        pids.add(descendant);
        let olderClosed = false;
        const olderClose = new Promise<void>(resolve =>
            older.child.once('close', () => {
                olderClosed = true;
                resolve();
            }),
        );

        // 別の process group の子孫が pipe を持つので、writer の group が消えて枠が解放された後も `close` は来ない。
        await expect(manager.stopHls(older.handle)).resolves.toMatchObject({
            exitConfirmed: true,
            slotReleased: true,
        });
        expect(registryOf(manager)).toEqual([]);
        expect(olderClosed).toBe(false);

        const newerWriter = makeWriter('late-new');
        const newer = await startWriter(manager, newerWriter);
        const newerPgid = newer.child.pid as number;
        const kill = vi.spyOn(process, 'kill');

        // 遅い `close` を起こす（子孫を止めると pipe が閉じる）。
        process.kill(descendant, 'SIGKILL');
        await olderClose;
        expect(olderClosed).toBe(true);

        expect(registryOf(manager)).toHaveLength(1);
        expect(registryOf(manager)[0].pgid).toBe(newerPgid);
        expect(groupAlive(newerPgid)).toBe(true);
        expect(signalCalls(kill, newerPgid)).toEqual([]);
        expect(newerWriter.signals()).toBeNull();
        // 二重に解放されていれば 2 本目が入ってしまう。枠は新しい世代が 1 つだけ使っている。
        await expect(manager.createHlsWriter(option(newerWriter.cmd))).rejects.toThrow(
            'EncodeProcessManageModelCreateError',
        );

        await manager.stopHls(newer.handle);
        expect(registryOf(manager)).toEqual([]);
    }, 30_000);
});
