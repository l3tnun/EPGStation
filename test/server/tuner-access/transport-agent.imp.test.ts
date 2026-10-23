import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { Agent } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const transportModuleUrl = pathToFileURL(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'TunerHttpTransport.js'),
).href;

// 共有の Agent は module の読み込み時に 1 度だけ作られる。他の test が先に読み込んだ module を使い回すと、
// その時点の Agent を見ることになるので、test の中で module を新しく評価して、その評価で作られた Agent を確かめる。
let freshImportCount = 0;
const importFreshTransport = async (): Promise<any> =>
    (await import(`${transportModuleUrl}?fresh-agent=${++freshImportCount}-${Date.now()}`)).default;

const makeResponse = (): PassThrough => {
    const response = new PassThrough() as PassThrough & {
        headers: Record<string, string | undefined>;
        statusCode: number;
    };
    response.statusCode = 200;
    response.headers = {};
    queueMicrotask(() => response.end('{"ok":true}'));
    return response;
};

/**
 * 全要求と複数の transport が共有する専用の Agent の設定を、request factory に渡る option で確かめる。
 * 実際の response・socket の受信 HWM は結合 test（transport.integration.test.ts）が確かめる。
 */
describe('tuner transport shared agent (unittest/imp)', () => {
    it('[TA-7.1] passes the one shared Agent with keepAlive, a 5 second timeout and a 128 KiB receive HWM', async () => {
        const options: Array<{ agent?: unknown }> = [];
        const request = vi.fn((option: { agent?: unknown }, callback: (response: PassThrough) => void) => {
            options.push(option);
            const requestObject = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
            requestObject.destroy = vi.fn();
            requestObject.end = () => callback(makeResponse());
            return requestObject;
        });
        const TunerHttpTransport = await importFreshTransport();
        const first = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40772'),
            'epgstation/synthetic',
            request,
        );
        const second = new TunerHttpTransport(
            parseConnectionTarget('http://synthetic.invalid:40773'),
            'epgstation/synthetic',
            request,
        );

        await expect(first.getJson('/api/status')).resolves.toEqual({ ok: true });
        await expect(second.getJson('/api/status')).resolves.toEqual({ ok: true });

        expect(options).toHaveLength(2);
        const agent = options[0].agent as Agent & { keepAlive: boolean; options: Record<string, unknown> };
        expect(agent).toBeInstanceOf(Agent);
        expect(options[1].agent).toBe(agent);
        expect(agent.keepAlive).toBe(true);
        expect(agent.options.timeout).toBe(5_000);
        expect(agent.options.readableHighWaterMark).toBe(128 * 1024);
    });
});
