import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;

const service = {
    id: 51,
    serviceId: 52,
    networkId: 32,
    name: 'synthetic-service-51',
    type: 1,
};

describe('Mirakurun change feed frames with an unsupported type', () => {
    it.each([
        ['program', 'create-or-remove'],
        ['service', 'redefine'],
    ] as const)(
        '[TA-2.3] aborts the feed on a %s frame whose type is %s, even when its data has a service shape',
        async (resource, type) => {
            const stream = new PassThrough();
            const observer = { started: vi.fn(), changed: vi.fn(), aborted: vi.fn() };
            const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
            const handle = await adapter.open(observer);
            const completion = handle.completion.catch((error: Error) => error);

            stream.write(JSON.stringify({ resource, type, data: service, time: 3_000 }));

            await expect(completion).resolves.toMatchObject({ message: 'Invalid Mirakurun change frame' });
            expect(observer.changed).not.toHaveBeenCalled();
            expect(observer.aborted).toHaveBeenCalledOnce();
        },
    );
});
