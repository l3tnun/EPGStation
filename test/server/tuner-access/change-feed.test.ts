import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;
const MirakcChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakcChangeAdapter.js')) as any
).default;
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;

const changeObserver = () => ({
    started: vi.fn(),
    changed: vi.fn(),
    aborted: vi.fn(),
});

const completeProgram = (id: number) => ({
    id,
    eventId: id + 1,
    serviceId: 31,
    networkId: 32,
    startAt: 1_000,
    duration: 60_000,
    isFree: true,
    name: `synthetic-program-${id}`,
});

const completeService = (id: number) => ({
    id,
    serviceId: id + 1,
    networkId: 32,
    name: `synthetic-service-${id}`,
    type: 1,
});

const expectAdapterListenersRemoved = (stream: PassThrough): void => {
    for (const event of ['data', 'error', 'end', 'close']) expect(stream.listenerCount(event)).toBe(0);
};

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('tuner change-feed adapters', () => {
    it('[TA-2.3] normalizes arbitrarily split Mirakurun program and service frames', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);
        const frames = [
            { resource: 'program', type: 'update', data: completeProgram(41), time: 2_000 },
            { resource: 'service', type: 'create', data: completeService(51), time: 2_001 },
            { resource: 'tuner', type: 'update', data: {}, time: 2_002 },
        ];
        const payload = `[\n${frames.map(frame => JSON.stringify(frame)).join(',\n')},\n`;

        stream.write(payload.slice(0, 7));
        stream.write(payload.slice(7, 43));
        stream.write(payload.slice(43));

        expect(observer.started).toHaveBeenCalledOnce();
        expect(observer.changed.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            { kind: 'program', operation: 'update', program: completeProgram(41), time: 2_000 },
            { kind: 'service', operation: 'create', service: completeService(51), time: 2_001 },
        ]);
        expect(observer.aborted).not.toHaveBeenCalled();

        stream.end(']\n');
        await expect(completion).resolves.toMatchObject({ message: 'Ended tuner change feed' });
        expect(observer.aborted).not.toHaveBeenCalled();
        expectAdapterListenersRemoved(stream);
    });

    // Mirakurun 4.x emits `job` and `job_schedule` events (Job.ts: queued/running/finished updates and the
    // gather schedules) on the same event stream that carries program and service events. The shapes below
    // follow what Mirakurun 4.1.5 emits.
    it.each([
        [
            'job create (queued)',
            {
                resource: 'job',
                type: 'create',
                data: {
                    key: 'synthetic-job-key',
                    name: 'synthetic-job-name',
                    id: 'synthetic-job-id',
                    status: 'queued',
                    retryCount: 0,
                    createdAt: 1_000,
                    updatedAt: 1_000,
                    duration: 0,
                    isRerunnable: true,
                },
                time: 5_001,
            },
        ],
        [
            'job update (running)',
            {
                resource: 'job',
                type: 'update',
                data: {
                    key: 'synthetic-job-key',
                    name: 'synthetic-job-name',
                    id: 'synthetic-job-id',
                    status: 'running',
                    retryCount: 0,
                    isAborting: false,
                    createdAt: 1_000,
                    updatedAt: 1_100,
                    startedAt: 1_100,
                    duration: 0,
                },
                time: 5_002,
            },
        ],
        [
            'job update (finished)',
            {
                resource: 'job',
                type: 'update',
                data: {
                    key: 'synthetic-job-key',
                    name: 'synthetic-job-name',
                    id: 'synthetic-job-id',
                    status: 'finished',
                    retryCount: 0,
                    isAborting: false,
                    hasFailed: true,
                    error: 'synthetic-job-error',
                    createdAt: 1_000,
                    updatedAt: 1_200,
                    startedAt: 1_100,
                    finishedAt: 1_200,
                    duration: 100,
                },
                time: 5_003,
            },
        ],
        [
            'job_schedule create',
            {
                resource: 'job_schedule',
                type: 'create',
                data: {
                    key: 'synthetic-schedule-key',
                    schedule: '20,50 * * * *',
                    job: { key: 'synthetic-job-key', name: 'synthetic-job-name' },
                },
                time: 5_004,
            },
        ],
    ])(
        '[TA-2.3] ignores a Mirakurun %s frame without aborting the feed and still delivers the next program frame',
        async (_label, frame) => {
            const stream = new PassThrough();
            const observer = changeObserver();
            const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
            const handle = await adapter.open(observer);
            const completion = handle.completion.catch((error: Error) => error);
            const followingProgram = { resource: 'program', type: 'update', data: completeProgram(81), time: 5_100 };

            stream.write(`${JSON.stringify(frame)},\n`);
            stream.write(`${JSON.stringify(followingProgram)},\n`);

            expect(observer.aborted).not.toHaveBeenCalled();
            expect(observer.changed.mock.calls.map((call: unknown[]) => call[0])).toEqual([
                { kind: 'program', operation: 'update', program: completeProgram(81), time: 5_100 },
            ]);

            handle.close();
            await expect(completion).resolves.toBeUndefined();
            expectAdapterListenersRemoved(stream);
        },
    );

    it('[TA-2.3] ignores a Mirakurun frame of a resource it does not know without aborting the feed', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write(JSON.stringify({ resource: 'synthetic-future-resource', type: 'update', data: 7, time: 5_200 }));
        stream.write(JSON.stringify({ resource: 'service', type: 'update', data: completeService(82), time: 5_201 }));

        expect(observer.aborted).not.toHaveBeenCalled();
        expect(observer.changed.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            { kind: 'service', operation: 'update', service: completeService(82), time: 5_201 },
        ]);

        handle.close();
        await expect(completion).resolves.toBeUndefined();
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] decodes a multibyte Mirakurun payload split at every byte boundary', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const changedProgram = { ...completeProgram(69), name: '合成番組・境界' };
        const payload = Buffer.from(
            JSON.stringify({ resource: 'program', type: 'update', data: changedProgram, time: 1_999 }),
            'utf8',
        );

        for (let index = 0; index < payload.length; index += 1) stream.write(payload.subarray(index, index + 1));

        expect(observer.changed).toHaveBeenCalledWith({
            kind: 'program',
            operation: 'update',
            program: changedProgram,
            time: 1_999,
        });
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();
    });

    it('[TA-2.3] preserves every Mirakurun operation, duplicate, and JSON string boundary in order', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const createProgram = completeProgram(71);
        const frames = [
            { resource: 'program', type: 'create', data: createProgram, time: 3_001 },
            { resource: 'program', type: 'update', data: completeProgram(72), time: 3_002 },
            { resource: 'program', type: 'remove', data: { id: 73 }, time: 3_003 },
            { resource: 'program', type: 'remove', data: { id: 73 }, time: 3_004 },
            { resource: 'program', type: 'redefine', data: { from: 74, to: 75 }, time: 3_005 },
            { resource: 'service', type: 'create', data: completeService(76), time: 3_006 },
            { resource: 'service', type: 'update', data: completeService(77), time: 3_007 },
            { resource: 'service', type: 'remove', data: completeService(78), time: 3_008 },
            { resource: 'tuner', type: 'update', data: {}, time: 3_009 },
        ];
        const payload = ` [ , ${frames.map(frame => JSON.stringify(frame)).join(',')} , ] `;

        for (const character of payload) stream.write(character);

        const changes = observer.changed.mock.calls.map((call: unknown[]) => call[0]);
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();

        expect(changes).toEqual([
            { kind: 'program', operation: 'create', program: createProgram, time: 3_001 },
            { kind: 'program', operation: 'update', program: completeProgram(72), time: 3_002 },
            { kind: 'program', operation: 'remove', programId: 73, time: 3_003 },
            { kind: 'program', operation: 'remove', programId: 73, time: 3_004 },
            { kind: 'program', operation: 'redefine', from: 74, to: 75, time: 3_005 },
            { kind: 'service', operation: 'create', service: completeService(76), time: 3_006 },
            { kind: 'service', operation: 'update', service: completeService(77), time: 3_007 },
            { kind: 'service', operation: 'remove', service: completeService(78), time: 3_008 },
        ]);

        expect(observer.aborted).not.toHaveBeenCalled();
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] parses compact Mirakurun frames with empty, escaped, and brace-bearing JSON strings', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.end(
            [
                { '': 0, resource: 'tuner', time: 3_010 },
                { resource: 'tuner', time: 3_011, note: '"', brace: '{' },
            ]
                .map(frame => JSON.stringify(frame))
                .join(','),
        );

        await expect(completion).resolves.toMatchObject({ message: 'Ended tuner change feed' });
        expect(observer.changed).not.toHaveBeenCalled();
        expect(observer.aborted).not.toHaveBeenCalled();
        expectAdapterListenersRemoved(stream);
    });

    it.each([
        ['non-object program data', { resource: 'program', type: 'remove', data: null, time: 4_001 }],
        ['array program data', { resource: 'program', type: 'remove', data: [], time: 4_002 }],
        ['scalar program data', { resource: 'program', type: 'remove', data: 73, time: 4_003 }],
        ['missing event time', { resource: 'tuner', type: 'update', data: {} }],
        ['non-finite event time', { resource: 'tuner', type: 'update', data: {}, time: null }],
        [
            'invalid operation',
            { resource: 'program', type: 'synthetic-invalid', data: { from: 74, to: 75 }, time: 4_004 },
        ],
        ['missing resource', { type: 'update', data: completeService(79), time: 4_005 }],
        ['non-string resource', { resource: 7, type: 'update', data: completeService(79), time: 4_006 }],
        ['invalid service operation', { resource: 'service', type: 'synthetic-invalid', data: {}, time: 4_007 }],
        ['non-finite time on an ignored resource', { resource: 'job', type: 'update', data: {}, time: null }],
    ])('[TA-2.3] rejects a Mirakurun %s frame with the owned parse error', async (_label, frame) => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);

        stream.write(JSON.stringify(frame));

        await expect(handle.completion).rejects.toThrow('Invalid Mirakurun change frame');
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(observer.aborted.mock.calls[0][0]).toMatchObject({ message: 'Invalid Mirakurun change frame' });
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] rejects a non-object Mirakurun token as soon as it is received', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);

        stream.write('synthetic-invalid-token');

        expect(observer.aborted).toHaveBeenCalledTimes(1);
        await expect(handle.completion).rejects.toThrow('Invalid Mirakurun change frame');
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] rejects an incomplete Mirakurun object at normal stream end', async () => {
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);

        stream.end('{"resource":"program"');

        await expect(handle.completion).rejects.toThrow('Invalid Mirakurun change frame');
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] converts incomplete Mirakurun UTF-8 at stream end into one owned frame failure', async () => {
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write(Buffer.from([0xf0, 0x9f, 0x92]));
        expect(() => stream.emit('end')).not.toThrow();

        await expect(completion).resolves.toMatchObject({ message: 'Invalid Mirakurun change frame' });
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(destroy).toHaveBeenCalledTimes(1);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] settles and cleans a Mirakurun caller close only once despite late terminal callbacks', async () => {
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const lateError = stream.listeners('error')[0] as (error: Error) => void;
        const lateEnd = stream.listeners('end')[0] as () => void;

        handle.close();
        lateEnd();
        lateError(new Error('SYNTHETIC_LATE_TERMINAL'));
        handle.close();

        await expect(handle.completion).resolves.toBeUndefined();
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledTimes(1);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] does not destroy an already-destroyed Mirakurun stream during caller cleanup', async () => {
        const stream = new PassThrough();
        stream.destroy();
        await new Promise(resolve => setImmediate(resolve));
        const destroy = vi.spyOn(stream, 'destroy');
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(changeObserver());

        handle.close();

        await expect(handle.completion).resolves.toBeUndefined();
        expect(destroy).not.toHaveBeenCalled();
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] cleans and preserves a Mirakurun observer startup failure', async () => {
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const failure = new Error('SYNTHETIC_OBSERVER_START_FAILURE');
        const observer = changeObserver();
        observer.started.mockImplementation(() => {
            throw failure;
        });
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));

        await expect(adapter.open(observer)).rejects.toBe(failure);

        expect(observer.changed).not.toHaveBeenCalled();
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledTimes(1);
        expectAdapterListenersRemoved(stream);
    });

    it.each(['end', 'close'] as const)(
        '[TA-2.3] completes a normal Mirakurun %s without an aborted notification and cleans once',
        async terminal => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const destroy = vi.spyOn(stream, 'destroy');
            const observer = changeObserver();
            const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
            const handle = await adapter.open(observer);
            const completion = handle.completion.catch((error: Error) => error);

            stream.emit(terminal);

            await expect(completion).resolves.toMatchObject({
                message: terminal === 'end' ? 'Ended tuner change feed' : 'Closed tuner change feed',
            });
            expect(observer.aborted).not.toHaveBeenCalled();
            expectAdapterListenersRemoved(stream);
            expect(destroy).toHaveBeenCalledTimes(1);
            handle.close();
            handle.close();
            expect(destroy).toHaveBeenCalledTimes(1);
        },
    );

    it('[TA-2.3] reports one Mirakurun parse failure and removes listeners before destroying the stream', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write('[\n{invalid},\n');

        const failure = await completion;
        expect(failure).toMatchObject({ message: 'Invalid Mirakurun change frame' });
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(observer.aborted).toHaveBeenCalledWith(failure);
        expectAdapterListenersRemoved(stream);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.3] reports one Mirakurun transport failure after started and cleans once', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const failure = new Error('SYNTHETIC_CHANGE_TRANSPORT_FAILURE');
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.emit('error', failure);

        await expect(completion).resolves.toBe(failure);
        expect(observer.started).toHaveBeenCalledOnce();
        expect(observer.aborted).toHaveBeenCalledOnce();
        expect(observer.aborted).toHaveBeenCalledWith(failure);
        expectAdapterListenersRemoved(stream);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.3] accepts a non-Buffer string chunk for a Mirakurun frame as Buffer delivery', async () => {
        // stream.write(string) delivers Buffer chunks on a non-object-mode PassThrough, so a directly
        // emitted string 'data' event is required to exercise the MirakurunChangeAdapter onData
        // non-Buffer arm (MirakurunChangeAdapter.ts:165, `Buffer.from(chunk)`).
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const changedProgram = completeProgram(81);
        const frame = { resource: 'program', type: 'update', data: changedProgram, time: 3_000 };
        const payload = `[\n${JSON.stringify(frame)},\n`;

        stream.emit('data', payload);

        expect(observer.started).toHaveBeenCalledOnce();
        expect(observer.changed.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            { kind: 'program', operation: 'update', program: changedProgram, time: 3_000 },
        ]);
        expect(observer.aborted).not.toHaveBeenCalled();

        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] rejects Mirakurun acquisition failure without starting or retaining a stream', async () => {
        vi.useFakeTimers();
        const failure = new Error('SYNTHETIC_CHANGE_ACQUISITION_FAILURE');
        const observer = changeObserver();
        const adapter = new MirakurunChangeAdapter(vi.fn(async () => Promise.reject(failure)));

        await expect(adapter.open(observer)).rejects.toBe(failure);

        expect(observer.started).not.toHaveBeenCalled();
        expect(observer.changed).not.toHaveBeenCalled();
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[TA-2.3] suppresses the initial mirakc EPG snapshot and emits later SSE changes from arbitrary chunks', async () => {
        vi.useFakeTimers();
        let now = 10_000;
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(
            vi.fn(async () => stream),
            () => now,
        );
        const handle = await adapter.open(observer);

        stream.write('event: epg.programs-up');
        stream.write('dated\ndata: {"serviceId":61}\n\n');
        now += 1_000;
        stream.write('event: epg.programs-updated\ndata: {"serviceId":62}\n\n');
        now += 1;
        stream.write('event: epg.programs-updated\ndata: {"serviceId":63}\n\n');
        stream.write(
            'event: onair.program-changed\ndata: {"serviceId":64}\n\n' +
                'event: onair.program-changed\ndata: {"serviceId":65}\n\n',
        );

        const changes = observer.changed.mock.calls.map((call: unknown[]) => call[0]);
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();

        expect(observer.started).toHaveBeenCalledOnce();
        expect(changes).toEqual([
            { kind: 'service-programs-updated', serviceId: 63 },
            { kind: 'on-air-service', serviceId: 64 },
            { kind: 'on-air-service', serviceId: 65 },
        ]);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] reports malformed mirakc SSE once and cleans listeners, timers, and stream exactly once', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write('event: onair.program-changed\ndata: {invalid}\n\n');
        handle.close();

        const failure = await completion;
        expect(failure).toMatchObject({ message: 'Invalid mirakc change frame' });
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(observer.aborted).toHaveBeenCalledWith(failure);
        expectAdapterListenersRemoved(stream);
        expect(destroy).toHaveBeenCalledTimes(1);
        handle.close();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        ['null payload', 'null'],
        ['array payload', '[]'],
        ['scalar payload', '73'],
        ['missing service ID', '{}'],
        ['null service ID', '{"serviceId":null}'],
        ['string service ID', '{"serviceId":"73"}'],
    ])('[TA-2.3] rejects mirakc %s with the owned parse error', async (_label, data) => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write(`event: onair.program-changed\ndata: ${data}\n\n`);
        handle.close();

        await expect(completion).resolves.toMatchObject({ message: 'Invalid mirakc change frame' });
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] rejects mirakc multiline data when the required SSE newline separates JSON tokens', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.write('event: onair.program-changed\ndata:{"service\ndata:Id":66}\n\n');
        handle.close();

        await expect(completion).resolves.toMatchObject({ message: 'Invalid mirakc change frame' });
        expect(observer.changed).not.toHaveBeenCalled();
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] ignores unknown mirakc events and parses multiline data with CRLF boundaries', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);

        stream.write('event: synthetic.ignored\r\ndata: {invalid}\r\n\r\n');
        stream.write('synthetic-comment\r\nevent: onair.program-changed\r\ndata: {"serviceId":\r\ndata: 66}\r\n\r\n');
        const changes = observer.changed.mock.calls.map((call: unknown[]) => call[0]);
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();

        expect(changes).toEqual([{ kind: 'on-air-service', serviceId: 66 }]);
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] accepts a non-Buffer string chunk for the same mirakc on-air frame as Buffer delivery', async () => {
        // stream.write(string) delivers Buffer chunks on a non-object-mode PassThrough.
        // Emit a string data event so the MirakcChangeAdapter onData string arm
        // (MirakcChangeAdapter.ts:82) is the path under test for the same valid frame
        // already used by Buffer cases (serviceId 66 → on-air-service).
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const frame = 'event: onair.program-changed\ndata: {"serviceId":66}\n\n';

        stream.emit('data', frame);

        const changes = observer.changed.mock.calls.map((call: unknown[]) => call[0]);
        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();

        expect(observer.started).toHaveBeenCalledOnce();
        expect(changes).toEqual([{ kind: 'on-air-service', serviceId: 66 }]);
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] reports one mirakc transport error by identity and releases every resource', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const failure = new Error('SYNTHETIC_MIRAKC_TRANSPORT_FAILURE');
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        stream.emit('error', failure);

        await expect(completion).resolves.toBe(failure);
        expect(observer.aborted).toHaveBeenCalledWith(failure);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it.each(['end', 'close'] as const)(
        '[TA-2.3] reports one mirakc %s terminal and releases every resource',
        async terminal => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const destroy = vi.spyOn(stream, 'destroy');
            const observer = changeObserver();
            const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
            const handle = await adapter.open(observer);
            const completion = handle.completion.catch((error: Error) => error);

            stream.emit(terminal);

            await expect(completion).resolves.toMatchObject({
                message: terminal === 'end' ? 'Ended mirakc change feed' : 'Closed mirakc change feed',
            });
            expect(observer.aborted).toHaveBeenCalledTimes(1);
            expect(destroy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            expectAdapterListenersRemoved(stream);
        },
    );

    it('[TA-2.3] settles a mirakc caller close once despite late captured terminal callbacks', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const lateError = stream.listeners('error')[0] as (error: Error) => void;
        const lateEnd = stream.listeners('end')[0] as () => void;

        handle.close();
        lateEnd();
        lateError(new Error('SYNTHETIC_LATE_MIRAKC_TERMINAL'));
        handle.close();

        await expect(handle.completion).resolves.toBeUndefined();
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] does not destroy an already-destroyed mirakc stream during caller cleanup', async () => {
        const stream = new PassThrough();
        stream.destroy();
        await new Promise(resolve => setImmediate(resolve));
        vi.useFakeTimers();
        const destroy = vi.spyOn(stream, 'destroy');
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(changeObserver());

        handle.close();

        await expect(handle.completion).resolves.toBeUndefined();
        expect(destroy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] cleans and preserves a mirakc observer startup failure', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const destroy = vi.spyOn(stream, 'destroy');
        const failure = new Error('SYNTHETIC_MIRAKC_OBSERVER_START_FAILURE');
        const observer = changeObserver();
        observer.started.mockImplementation(() => {
            throw failure;
        });
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));

        await expect(adapter.open(observer)).rejects.toBe(failure);

        expect(observer.changed).not.toHaveBeenCalled();
        expect(observer.aborted).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] terminates a mirakc feed whose open stream becomes unreadable without a terminal event', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const adapter = new MirakcChangeAdapter(vi.fn(async () => stream));
        const handle = await adapter.open(observer);
        const completion = handle.completion.catch((error: Error) => error);

        expect(vi.getTimerCount()).toBe(1);
        Object.defineProperty(stream, 'readable', { configurable: true, value: false });
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(completion).resolves.toMatchObject({ message: 'Closed mirakc change feed' });
        expect(observer.aborted).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });

    it('[TA-2.3] keeps a rejected getProgramsByService REST call on a mirakc-configured facade from closing its own open feed', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const observer = changeObserver();
        const restFailure = new Error('synthetic REST failure');
        const transport = {
            getBuffer: vi.fn(),
            getJson: vi.fn(async (path: string) =>
                path.startsWith('/api/services/') && path.endsWith('/programs')
                    ? Promise.reject(restFailure)
                    : Promise.reject(new Error(`unexpected route: ${path}`)),
            ),
        };
        const access = new TunerServerAccessModel('http://synthetic.invalid:40772', 'epgstation/synthetic', transport, {
            changeFeed: {
                detector: { detect: vi.fn(async () => 'mirakc') },
                mirakc: new MirakcChangeAdapter(vi.fn(async () => stream)),
                mirakurun: { open: vi.fn() },
            },
        });

        const handle = await access.openChangeFeed(observer);
        const restRejection = access.getProgramsByService(101).catch((error: Error) => error);

        stream.write('event: onair.program-changed\ndata: {"serviceId":71}\n\n');

        await expect(restRejection).resolves.toBe(restFailure);
        expect(transport.getJson).toHaveBeenCalledWith('/api/services/101/programs', expect.anything());
        expect(observer.changed).toHaveBeenCalledWith({ kind: 'on-air-service', serviceId: 71 });
        expect(observer.aborted).not.toHaveBeenCalled();

        handle.close();
        await expect(handle.completion).resolves.toBeUndefined();
        expectAdapterListenersRemoved(stream);
    });

    it.each([
        ['Mirakurun', (stream: PassThrough) => new MirakurunChangeAdapter(vi.fn(async () => stream))],
        ['mirakc', (stream: PassThrough) => new MirakcChangeAdapter(vi.fn(async () => stream))],
    ] as const)(
        '[TA-2.3] rejects %s completion even when the aborted observer throws',
        async (_product, createAdapter) => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const destroy = vi.spyOn(stream, 'destroy');
            const transportFailure = new Error('SYNTHETIC_ADAPTER_TRANSPORT_FAILURE');
            const observerFailure = new Error('SYNTHETIC_ABORTED_OBSERVER_FAILURE');
            const observer = changeObserver();
            observer.aborted.mockImplementation(() => {
                throw observerFailure;
            });
            const handle = await createAdapter(stream).open(observer);
            let settlement: unknown = { status: 'pending' };
            void handle.completion.then(
                () => {
                    settlement = { status: 'resolved' };
                },
                (reason: unknown) => {
                    settlement = { status: 'rejected', reason };
                },
            );

            expect(() => stream.emit('error', transportFailure)).toThrow(observerFailure);
            await Promise.resolve();

            expect(settlement).toEqual({ status: 'rejected', reason: transportFailure });
            expect(observer.aborted).toHaveBeenCalledWith(transportFailure);
            expect(destroy).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
            expectAdapterListenersRemoved(stream);
        },
    );

    it.each([
        [
            'Mirakurun',
            (stream: PassThrough) => new MirakurunChangeAdapter(vi.fn(async () => stream)),
            [
                { resource: 'program', type: 'remove', data: { id: 91 }, time: 5_001 },
                { resource: 'program', type: 'remove', data: { id: 92 }, time: 5_002 },
            ]
                .map(frame => JSON.stringify(frame))
                .join(','),
        ],
        [
            'mirakc',
            (stream: PassThrough) => new MirakcChangeAdapter(vi.fn(async () => stream)),
            'event: onair.program-changed\ndata: {"serviceId":91}\n\n' +
                'event: onair.program-changed\ndata: {"serviceId":92}\n\n',
        ],
    ] as const)(
        '[TA-2.3] stops %s same-chunk delivery when the consumer closes during changed',
        async (_product, createAdapter, payload) => {
            vi.useFakeTimers();
            const stream = new PassThrough();
            const observer = changeObserver();
            let handle: { completion: Promise<void>; close(): void };
            observer.changed.mockImplementation(() => handle.close());
            handle = await createAdapter(stream).open(observer);

            stream.write(payload);

            handle.close();
            await expect(handle.completion).resolves.toBeUndefined();

            expect(observer.changed).toHaveBeenCalledTimes(1);
            expect(observer.aborted).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            expectAdapterListenersRemoved(stream);
        },
    );

    it.each([
        ['Mirakurun', (stream: PassThrough) => new MirakurunChangeAdapter(vi.fn(async () => stream))],
        ['mirakc', (stream: PassThrough) => new MirakcChangeAdapter(vi.fn(async () => stream))],
    ] as const)('[TA-2.3] leaves a %s feed pending without a total-duration timer', async (product, createAdapter) => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const handle = await createAdapter(stream).open(changeObserver());
        let settled = false;
        void handle.completion.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );

        vi.setSystemTime(new Date().getTime() + 7 * 24 * 60 * 60 * 1_000);
        await vi.advanceTimersByTimeAsync(product === 'mirakc' ? 1_000 : 7 * 24 * 60 * 60 * 1_000);

        expect(settled).toBe(false);
        expect(stream.destroyed).toBe(false);
        expect(vi.getTimerCount()).toBe(product === 'mirakc' ? 1 : 0);
        handle.close();
        await handle.completion.catch(() => undefined);
        expect(vi.getTimerCount()).toBe(0);
        expectAdapterListenersRemoved(stream);
    });
});
