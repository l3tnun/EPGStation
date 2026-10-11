import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const TunerHttpTransport = (
    require(join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js')) as any
).default;

const makeResponse = (statusCode: number, body: string, location?: string): PassThrough => {
    const response = new PassThrough() as PassThrough & {
        headers: Record<string, string | undefined>;
        statusCode: number;
    };
    response.statusCode = statusCode;
    response.headers = location === undefined ? {} : { location };
    queueMicrotask(() => response.end(body));
    return response;
};

describe('tuner transport redirect cleanup', () => {
    it('[TA-2.1] releases the superseded request listeners and the abort listener when it follows a redirect', async () => {
        const requests: EventEmitter[] = [];
        const replies = [
            { statusCode: 302, body: '', location: '/api/version' },
            { statusCode: 200, body: '{"ok":true}', location: undefined },
        ];
        const request = vi.fn((_options: unknown, callback: (response: PassThrough) => void) => {
            const requestObject = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
            requestObject.destroy = vi.fn();
            const reply = replies.shift()!;
            requestObject.end = () => callback(makeResponse(reply.statusCode, reply.body, reply.location));
            requests.push(requestObject);
            return requestObject;
        });
        const transport = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const controller = new AbortController();

        await expect(transport.getJson('/api/status', { signal: controller.signal })).resolves.toEqual({ ok: true });

        expect(requests).toHaveLength(2);
        // 追跡して役目を終えた最初の要求に、error と close の listener を残さない。
        expect(requests[0].listenerCount('error')).toBe(0);
        expect(requests[0].listenerCount('close')).toBe(0);
        // 追跡先の要求も、成功で確定した時点で listener を外す。
        expect(requests[1].listenerCount('error')).toBe(0);
    });
});
