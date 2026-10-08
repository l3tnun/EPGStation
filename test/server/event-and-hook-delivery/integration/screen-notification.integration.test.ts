import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeLogger, makeRecorded, makeReserve, makeSetter, RecordingEvent, ReserveEvent } from '../_harness';

/*
 * 画面向け通知（予約・録画の変更を Service の Socket.IO へ知らせる）の経路を、本物の部品で通して確かめる。
 * operator 側は本物の event と EventSetter、本物の IPCServer。Service 側は実際の子 process で、本物の IPCClient と
 * 本物の SocketIOManageModel を実 HTTP server の上で動かす。画面側は engine.io の polling 通信を生の HTTP で読む。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const IPCServer = (require(join(snapshot, 'model/ipc/IPCServer.js')) as { default: new (...args: any[]) => any })
    .default;
const fixture = join(process.cwd(), 'test/server/fixtures/event-and-hook-delivery/service-notification-child.cjs');

interface IpcRecord {
    readonly at: number;
    readonly message: unknown;
}

interface Frame {
    readonly at: number;
    readonly packet: string;
}

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const startServiceChild = async () => {
    const child: ChildProcess = fork(fixture, [], {
        env: { ...process.env, EPGSTATION_SERVER_COMPILED_SNAPSHOT: snapshot },
        silent: true,
    });
    const records: IpcRecord[] = [];
    let port = 0;
    let buffered = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (text: string) => {
        buffered += text;
        let index = buffered.indexOf('\n');
        while (index >= 0) {
            const line = JSON.parse(buffered.slice(0, index)) as {
                event: string;
                port?: number;
                at?: number;
                message?: unknown;
            };
            buffered = buffered.slice(index + 1);
            if (line.event === 'listening') port = line.port as number;
            else if (line.event === 'ipc') records.push({ at: line.at as number, message: line.message });
            index = buffered.indexOf('\n');
        }
    });
    cleanups.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGCONT');
            child.kill('SIGKILL');
            await once(child, 'exit');
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
    });
    await vi.waitFor(() => expect(port).toBeGreaterThan(0), { timeout: 10_000 });
    return { child, port, records };
};

const exchange = (
    port: number,
    path: string,
    body?: string,
): Promise<{ readonly text: string; readonly status: number }> =>
    new Promise((resolve, reject) => {
        const outgoing = httpRequest(
            {
                headers:
                    body === undefined
                        ? {}
                        : {
                              'Content-Length': String(Buffer.byteLength(body)),
                              'Content-Type': 'text/plain;charset=UTF-8',
                          },
                host: '127.0.0.1',
                method: body === undefined ? 'GET' : 'POST',
                path,
                port,
            },
            response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.once('end', () =>
                    resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
                );
            },
        );
        outgoing.once('error', reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });

/** 画面の代わりに、Socket.IO（engine.io の polling）へ接続し、届いた packet を受信時刻つきで集める。 */
const connectScreen = async (port: number) => {
    const open = await exchange(port, '/socket.io/?EIO=4&transport=polling');
    const sid = (JSON.parse(open.text.slice(1)) as { sid: string }).sid;
    const sessionPath = `/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`;
    expect((await exchange(port, sessionPath, '40')).status).toBe(200);
    const frames: Frame[] = [];
    let stopped = false;
    let pending: ClientRequest | undefined;
    const poll = (): void => {
        if (stopped) return;
        pending = httpRequest({ host: '127.0.0.1', path: sessionPath, port }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.once('end', () => {
                const at = Date.now();
                for (const packet of Buffer.concat(chunks).toString('utf8').split('\u001e')) {
                    if (packet !== '' && !packet.startsWith('40')) frames.push({ at, packet });
                }
                poll();
            });
        });
        pending.once('error', () => undefined);
        pending.end();
    };
    poll();
    cleanups.push(() => {
        stopped = true;
        pending?.destroy();
    });
    return frames;
};

const operatorSide = (ipcServer: unknown) => {
    const logger = { getLogger: () => makeLogger() };
    const reserveEvent = new ReserveEvent(logger);
    const recordingEvent = new RecordingEvent(logger);
    const operator = makeSetter({ ipc: ipcServer, recordingEvent, reserveEvent });
    operator.setter.set();
    return { operator, recordingEvent, reserveEvent };
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('screen notification path across operator, IPC, and Socket.IO', () => {
    it('[EH-2.3] sends one IPC message per operation while Socket.IO aggregates ten 50ms updates into a few frames', async () => {
        const service = await startServiceChild();
        const ipcServer = new IPCServer({}, {}, {}, {}, {}, {});
        ipcServer.register(service.child);
        const frames = await connectScreen(service.port);
        const { reserveEvent } = operatorSide(ipcServer);

        for (let index = 0; index < 10; index += 1) {
            reserveEvent.emitUpdated({
                insert: [],
                update: [makeReserve({ id: 100 + index })],
                delete: [],
                isSuppressLog: true,
            });
            await sleep(50);
        }
        await sleep(700);

        expect(service.records).toHaveLength(10);
        expect(frames.length).toBeGreaterThanOrEqual(2);
        expect(frames.length).toBeLessThanOrEqual(7);
        for (let index = 1; index < frames.length; index += 1) {
            expect(frames[index].at - frames[index - 1].at).toBeGreaterThanOrEqual(100);
        }
    }, 30_000);

    it('[EH-2.4] carries no business state in the IPC message or the Socket.IO frame for a reservation update and a recording finish', async () => {
        const service = await startServiceChild();
        const ipcServer = new IPCServer({}, {}, {}, {}, {}, {});
        ipcServer.register(service.child);
        const frames = await connectScreen(service.port);
        const { operator, recordingEvent, reserveEvent } = operatorSide(ipcServer);

        reserveEvent.emitUpdated({
            insert: [makeReserve({ id: 4242, name: 'secret-program-name' })],
            update: [],
            delete: [],
            isSuppressLog: true,
        });
        await sleep(700);
        recordingEvent.emitFinishRecording(
            makeReserve({ id: 4243, name: 'secret-finished-name' }),
            makeRecorded({ id: 5151, name: 'secret-finished-name' }),
            false,
        );
        await vi.waitFor(() => expect(operator.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledTimes(1));
        await sleep(700);

        expect(service.records.length).toBeGreaterThanOrEqual(2);
        for (const record of service.records) {
            expect(JSON.stringify(record.message)).toBe('{"type":"notifyClient"}');
        }
        expect(frames.map(frame => frame.packet)).toEqual(Array(frames.length).fill('42["updateStatus"]'));
        expect(frames.length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it('[EH-2.5] keeps operator work moving while the Service process is stopped, and delivers each notification once after it resumes', async () => {
        const service = await startServiceChild();
        const ipcServer = new IPCServer({}, {}, {}, {}, {}, {});
        ipcServer.register(service.child);
        const frames = await connectScreen(service.port);
        const { operator, recordingEvent, reserveEvent } = operatorSide(ipcServer);

        service.child.kill('SIGSTOP');
        const stoppedAt = Date.now();
        for (let index = 0; index < 3; index += 1) {
            reserveEvent.emitUpdated({
                insert: [],
                update: [makeReserve({ id: 200 + index })],
                delete: [],
                isSuppressLog: true,
            });
        }
        recordingEvent.emitFinishRecording(makeReserve({ id: 210 }), makeRecorded({ id: 211 }), false);
        await vi.waitFor(() => expect(operator.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledTimes(1), {
            timeout: 2_000,
        });
        expect(Date.now() - stoppedAt).toBeLessThan(2_000);
        expect(operator.recordingManage.acceptMutation).toHaveBeenCalledTimes(3);
        expect(operator.externalCommandManage.addUpdateReseves).toHaveBeenCalledTimes(3);
        expect(service.records).toHaveLength(0);
        expect(frames).toHaveLength(0);

        service.child.kill('SIGCONT');
        await vi.waitFor(() => expect(service.records).toHaveLength(4), { timeout: 5_000 });
        await sleep(800);

        expect(service.records).toHaveLength(4);
        expect(frames.length).toBeGreaterThanOrEqual(1);
        expect(frames.length).toBeLessThanOrEqual(4);
        expect(operator.recordingManage.acceptMutation).toHaveBeenCalledTimes(3);
        expect(operator.externalCommandManage.addUpdateReseves).toHaveBeenCalledTimes(3);
        expect(operator.externalCommandManage.addRecordingFinishCmd).toHaveBeenCalledTimes(1);
    }, 30_000);
});
