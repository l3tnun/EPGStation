import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixture = join(process.cwd(), 'test/server/process-messaging/fixtures/notification-child.cjs');

const run = (): Promise<unknown[]> =>
    new Promise((resolve, reject) => {
        const child: ChildProcess = fork(fixture, [], {
            env: {
                ...process.env,
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT,
                PATH: process.env.PATH,
            },
            silent: true,
        });
        const messages: unknown[] = [];
        let settled = false;
        const deadline = setTimeout(() => finish(new Error('synthetic notification child timeout')), 2_000);
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            child.removeAllListeners('message');
            if (child.connected) child.disconnect();
            const terminal = () => {
                child.removeAllListeners();
                child.stdout?.destroy();
                child.stderr?.destroy();
                if (error === undefined) resolve(messages);
                else reject(error);
            };
            if (child.exitCode !== null || child.signalCode !== null) terminal();
            else {
                child.once('exit', terminal);
                if (!child.killed) child.kill('SIGTERM');
            }
        };
        child.once('error', finish);
        child.once('exit', (code, signal) => {
            if (!settled) finish(new Error(`notification child exited early: ${code}/${signal}`));
        });
        child.on('message', message => {
            messages.push(message);
            if ((message as any).observation === 'ready') {
                child.send({ type: 'notifyClient' });
                child.send({ type: 'pushEncode', value: { recordedId: 31, mode: 'synthetic' } });
            }
            if (messages.length === 3) finish();
        });
    });

describe('compiled IPCClient reverse notification boundary', () => {
    it('[Task 1.2] delivers exact one-way payloads to client-owned ports without replies', async () => {
        await expect(run()).resolves.toEqual([
            { observation: 'ready' },
            { observation: 'notifyClient' },
            { observation: 'pushEncode', value: { recordedId: 31, mode: 'synthetic' } },
        ]);
    });
});
