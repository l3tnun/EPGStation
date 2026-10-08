import { spawn, type ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { makeRecorded, makeReserve } from '../../event-and-hook-delivery/_harness';
import { makeChild, makeServer } from '../_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const loadDefault = <T>(path: string): T => (require(join(compiledSnapshot, path)) as { default: T }).default;
const ReserveEntity = loadDefault<new () => object>('db/entities/Reserve.js');
const RecordedEntity = loadDefault<new () => object>('db/entities/Recorded.js');
const RecordingCandidateRegistry = loadDefault<new () => any>('model/operator/recording/RecordingCandidateRegistry.js');

/*
 * IPC の test は、子 process を `send` が vi.fn の EventEmitter（makeChild）にし、受信を `emit('message', value)` で
 * 再現する。この偽物は渡した object をそのまま届ける。本物の子 process との IPC channel は JSON で直列化するので、
 * undefined の field は消え、Date は文字列になり、class の instance は plain object になる。同じ要求を本物の子 process
 * から本物の IPCServer へ送り、port が受ける値と応答が、偽物のときと JSON の往復の分だけしか違わないことを確かめる。
 */

const closedRelays = new WeakSet<ChildProcess>();

const stopRelay = async (child: ChildProcess): Promise<void> => {
    const closed = closedRelays.has(child)
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
              const onClose = () => {
                  clearTimeout(deadline);
                  resolve();
              };
              const deadline = setTimeout(() => {
                  child.off('close', onClose);
                  reject(new Error('IPC relay did not close after SIGKILL'));
              }, 5_000);
              child.once('close', onClose);
          });
    let signalError: unknown;
    try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') signalError = error;
    }
    await closed;
    if (signalError !== undefined) throw signalError;
    await vi.waitFor(
        () => {
            if (child.pid === undefined) return;
            expect(() => process.kill(-child.pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
        },
        { timeout: 5_000 },
    );
};

// 親から受けた要求を、そのまま親へ送り直し、親の応答を stdout に書く子。
const relayChild = String.raw`
process.on('message', message => {
    if (message && message.relay !== undefined) {
        process.send(message.relay);
        return;
    }
    process.stdout.write(JSON.stringify(message) + '\n');
});
`;

const startRelay = () => {
    const child = spawn(process.execPath, ['-e', relayChild], {
        detached: true,
        stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
    });
    child.once('close', () => closedRelays.add(child));
    const replies: unknown[] = [];
    let buffer = '';
    child.stdout!.on('data', chunk => {
        buffer += String(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) if (line.length > 0) replies.push(JSON.parse(line));
    });
    return { child, replies };
};

class SyntheticOption {
    public readonly startAt = new Date(1_700_000_000_000);
    public readonly nested = { tags: [1, 2], omitted: undefined };
    public readonly programId = 501;
    public readonly allowEndLack = false;
    public readonly encodeOption = undefined;
}

describe('IPC child double against a real IPC channel', () => {
    it('[PM-DOUBLE-PARITY-SERIALIZATION] delivers a request to the server port as its JSON form, while the double delivers the object itself', async () => {
        const option = new SyntheticOption();
        const request = { id: 1, model: 'reserveation', func: 'add', args: { option } };

        const doubled = makeServer();
        doubled.domains.reservation.add.mockResolvedValue(41);
        const doubleChild = makeChild();
        doubled.server.register(doubleChild);
        doubleChild.emit('message', request);
        await vi.waitFor(() => expect(doubleChild.send).toHaveBeenCalledOnce());

        const real = makeServer();
        real.domains.reservation.add.mockResolvedValue(41);
        const relay = startRelay();
        try {
            real.server.register(relay.child);
            // 子へ要求を渡し、子から本物の IPC channel で送り返させる（子 process が送る要求と同じ経路）。
            relay.child.send({ relay: request });
            await vi.waitFor(() => expect(relay.replies).toHaveLength(1));

            const receivedByDouble = doubled.domains.reservation.add.mock.calls[0][0];
            const receivedByReal = real.domains.reservation.add.mock.calls[0][0];
            expect(receivedByDouble).toBe(option);
            expect(receivedByReal).toEqual(JSON.parse(JSON.stringify(option)));
            expect(receivedByReal).toEqual({
                allowEndLack: false,
                nested: { tags: [1, 2] },
                programId: 501,
                startAt: '2023-11-14T22:13:20.000Z',
            });
            expect(receivedByReal).not.toHaveProperty('encodeOption');
            expect(receivedByReal).not.toBeInstanceOf(SyntheticOption);

            // 応答は、どちらも同じ id と結果になる。
            expect(doubleChild.send.mock.calls[0][0]).toEqual({ id: 1, result: 41 });
            expect(relay.replies).toEqual([{ id: 1, result: 41 }]);
        } finally {
            await stopRelay(relay.child);
        }
    }, 15_000);

    it('[PM-DOUBLE-PARITY-SERIALIZATION] turns an error thrown by the port into the same error reply through a real IPC channel', async () => {
        const real = makeServer();
        real.domains.reservation.cancel.mockRejectedValue(new Error('SyntheticCancelFailure'));
        const relay = startRelay();
        try {
            real.server.register(relay.child);
            relay.child.send({ relay: { id: 2, model: 'reserveation', func: 'cancel', args: { reserveId: 7 } } });
            await vi.waitFor(() => expect(relay.replies).toHaveLength(1));

            const doubled = makeServer();
            doubled.domains.reservation.cancel.mockRejectedValue(new Error('SyntheticCancelFailure'));
            const doubleChild = makeChild();
            doubled.server.register(doubleChild);
            doubleChild.emit('message', { id: 2, model: 'reserveation', func: 'cancel', args: { reserveId: 7 } });
            await vi.waitFor(() => expect(doubleChild.send).toHaveBeenCalledOnce());

            expect(relay.replies).toEqual([JSON.parse(JSON.stringify(doubleChild.send.mock.calls[0][0]))]);
            expect(real.domains.reservation.cancel).toHaveBeenCalledExactlyOnceWith(7);
        } finally {
            await stopRelay(relay.child);
        }
    }, 15_000);

    it('[PM-DOUBLE-PARITY-ENTITY] hands real Reserve and Recorded entities to the port as plain objects that the recording-side copy still accepts', async () => {
        const reserve = makeReserve({ id: 21, isConflict: true, shortName: undefined, startAt: 1_700_000_000_000 });
        const recorded = makeRecorded({ id: 31, description: undefined });
        const request = { id: 3, model: 'reserveation', func: 'add', args: { option: { reserve, recorded } } };

        const real = makeServer();
        real.domains.reservation.add.mockResolvedValue(41);
        const relay = startRelay();
        try {
            real.server.register(relay.child);
            relay.child.send({ relay: request });
            await vi.waitFor(() => expect(relay.replies).toHaveLength(1));

            const received = real.domains.reservation.add.mock.calls[0][0] as { reserve: any; recorded: any };
            expect(received.reserve).not.toBeInstanceOf(ReserveEntity);
            expect(received.recorded).not.toBeInstanceOf(RecordedEntity);
            expect(received.reserve).toEqual(JSON.parse(JSON.stringify(reserve)));
            expect(received.reserve).not.toHaveProperty('shortName');
            expect(received.recorded).not.toHaveProperty('description');
            expect(typeof received.reserve.startAt).toBe('number');
            expect(received.reserve.startAt).toBe(reserve.startAt);

            // 録画側が作る候補の写しは、instance でなくても、本物の entity から作った写しと同じ値になる。
            const registry = new RecordingCandidateRegistry();
            const fromPlain = registry.upsert(received.reserve);
            const fromEntity = new RecordingCandidateRegistry().upsert(reserve);
            expect(fromPlain).toMatchObject({
                endAt: reserve.endAt,
                kind: 'Program',
                prepareAt: fromEntity.prepareAt,
                reservationId: 21,
                startAt: reserve.startAt,
                state: 'Conflict',
            });
            expect({ ...fromPlain.reservation }).toEqual(JSON.parse(JSON.stringify({ ...fromEntity.reservation })));
            expect(Object.isFrozen(fromPlain.reservation)).toBe(true);
        } finally {
            await stopRelay(relay.child);
        }
    }, 15_000);
});
