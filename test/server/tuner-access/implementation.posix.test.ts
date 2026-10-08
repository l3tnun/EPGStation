import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;

// Platform boundary: this best-effort named-pipe request-seam characterization assumes the POSIX
// backslash-preserving path handling this repository's non-Windows CI has always exercised it
// under (see .kiro/specs/server-tuner-access/design.md: "Windows named pipe … best-effortにcharacterizeする。
// Windows host OSはserver正式対応外のため、temporary pipe実接続を必須integrationにしない"). The real
// Windows named-pipe connection is separately characterized, win32-only, in
// test/server/tuner-access/transport.win32.integration.test.ts. This file is selected only for the
// `posix` platform class by scripts/server-test/platform-boundary/selector.mjs before Vitest
// collects tests, so no in-body platform skip is used here.

describe('tuner access implementation baseline (POSIX named-pipe seam)', () => {
    it('[TA-8.4] verifies every named-pipe request seam without claiming a named-pipe integration result', async () => {
        const requestOptions: any[] = [];
        const requests: any[] = [];
        const request = vi.fn((options: any) => {
            requestOptions.push(options);
            const client = new EventEmitter() as any;
            client.end = vi.fn();
            client.destroy = vi.fn(() => client.emit('close'));
            requests.push(client);
            return client;
        });
        const target = { kind: 'named-pipe', socketPath: '\\\\.\\pipe\\synthetic-tuner', basePath: '' };
        const transport = new TunerHttpTransport(target, 'epgstation/synthetic', request);
        const operations: Array<{
            path: string;
            priority?: string;
            run: (signal: AbortSignal) => Promise<unknown>;
        }> = [
            { path: '/api/status', run: signal => transport.getJson('/api/status', { signal }) },
            { path: '/api/version', run: signal => transport.getJson('/api/version', { signal }) },
            { path: '/api/tuners', run: signal => transport.getJson('/api/tuners', { signal }) },
            { path: '/api/services', run: signal => transport.getJson('/api/services', { signal }) },
            { path: '/api/programs', run: signal => transport.getJson('/api/programs', { signal }) },
            {
                path: '/api/services/101/programs',
                run: signal => transport.getJson('/api/services/101/programs', { signal }),
            },
            { path: '/api/programs/201', run: signal => transport.getJson('/api/programs/201', { signal }) },
            {
                path: '/api/services/101/logo',
                run: signal => transport.getBuffer('/api/services/101/logo', { signal }),
            },
            { path: '/api/redirect', run: signal => transport.getJson('/api/redirect', { signal }) },
            { path: '/api/config/server', run: signal => transport.probeJson('/api/config/server', { signal }) },
            {
                path: '/api/events/stream',
                run: signal => transport.getStream('/api/events/stream', { signal }),
            },
            { path: '/events', run: signal => transport.getRootStream('/events', { signal }) },
            {
                path: '/api/programs/201/stream?decode=1',
                priority: '7',
                run: signal => transport.openStream('/api/programs/201/stream?decode=1', 7, { signal }),
            },
            {
                path: '/api/services/101/stream?decode=1',
                priority: '11',
                run: signal => transport.openStream('/api/services/101/stream?decode=1', 11, { signal }),
            },
        ];

        const listenerRemovals = [];
        for (const operation of operations) {
            const controller = new AbortController();
            const removeSignalListener = vi.spyOn(controller.signal, 'removeEventListener');
            listenerRemovals.push(removeSignalListener);
            const pending = operation.run(controller.signal);
            controller.abort();
            await expect(pending).rejects.toThrow('Tuner request cancelled');
        }

        expect(requestOptions).toHaveLength(operations.length);
        expect(requests).toHaveLength(operations.length);
        operations.forEach((operation, index) => {
            expect(requestOptions[index]).toEqual({
                method: 'GET',
                path: operation.path,
                socketPath: target.socketPath,
                headers: {
                    'User-Agent': 'epgstation/synthetic',
                    ...(operation.priority === undefined ? {} : { 'X-Mirakurun-Priority': operation.priority }),
                },
            });
            expect(requestOptions[index]).not.toHaveProperty('host');
            expect(requestOptions[index]).not.toHaveProperty('port');
            expect(requests[index].end).toHaveBeenCalledOnce();
            expect(requests[index].destroy).toHaveBeenCalledOnce();
            expect(requests[index].listenerCount('error')).toBe(0);
            expect(requests[index].listenerCount('close')).toBe(0);
            expect(listenerRemovals[index]).toHaveBeenCalledWith('abort', expect.any(Function));
            expect(listenerRemovals[index]).toHaveBeenCalledTimes(1);
        });
    });
});
