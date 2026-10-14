import { afterEach, describe, expect, it } from 'vitest';

import { makeClient, type ClientHarness } from '../_harness';

const clients: ClientHarness[] = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.cleanup();
});

describe('service process report sending (unittest/imp)', () => {
    it('[PM-IMP-REPORT] records a report when process.send is unavailable', () => {
        const harness = makeClient();
        clients.push(harness);
        Object.defineProperty(process, 'send', { configurable: true, value: undefined, writable: true });

        harness.client.serviceProcessReporter.started({ kind: 'stream', pid: 9401 });

        expect(harness.logError).toHaveBeenCalledWith('process.send is undefined');
    });

    it('[PM-IMP-REPORT] records an asynchronous send failure and ignores a successful callback', () => {
        const harness = makeClient();
        clients.push(harness);

        harness.client.serviceProcessReporter.ended(9402);
        harness.client.serviceProcessReporter.ended(9403);
        const [[, failed], [, succeeded]] = harness.send.mock.calls as [
            [unknown, (error: Error | null) => void],
            [unknown, (error: Error | null) => void],
        ];
        failed(new Error('synthetic asynchronous send failure'));
        succeeded(null);

        expect(harness.logError.mock.calls).toEqual([
            ['process.send callback error: synthetic asynchronous send failure'],
        ]);
    });

    it('[PM-IMP-REPORT] records a non-Error value thrown by process.send', () => {
        const harness = makeClient();
        clients.push(harness);
        harness.send.mockImplementationOnce(() => {
            throw 'synthetic thrown text';
        });

        harness.client.serviceProcessReporter.ended(9404);

        expect(harness.logError).toHaveBeenCalledWith('process.send error: synthetic thrown text');
    });
});
