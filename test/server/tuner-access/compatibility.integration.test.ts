import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import compatibility from '../fixtures/tuner-access/compatibility.json';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const TunerServerAccessModel = (require(join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js')) as any)
    .default;
const MirakurunChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakurunChangeAdapter.js')) as any
).default;
const MirakcChangeAdapter = (
    require(join(compiledSnapshot, 'model', 'tuner', 'change', 'MirakcChangeAdapter.js')) as any
).default;
const ProductDetector = (require(join(compiledSnapshot, 'model', 'tuner', 'change', 'ProductDetector.js')) as any)
    .default;

afterEach(() => vi.restoreAllMocks());

describe('tuner minimum and future compatibility integration', () => {
    it.each(compatibility.fixtures)(
        '[TA-7.3] accepts $label fixture without exact-version or additional-field rejection',
        async fixture => {
            const tuner = fixture.futureFields
                ? { ...compatibility.tuner, futureTunerField: 'ignored' }
                : compatibility.tuner;
            const service = fixture.futureFields
                ? { ...compatibility.service, futureServiceField: { ignored: true } }
                : compatibility.service;
            const program = fixture.futureFields
                ? { ...compatibility.program, futureProgramField: ['ignored'] }
                : compatibility.program;
            const logo = Buffer.from(`synthetic-logo-${fixture.product}`);
            const stream = new PassThrough();
            const closeStream = vi.fn(() => stream.destroy());
            const changeStream = new PassThrough();
            const detector = new ProductDetector(async () => fixture.statusProbe);
            const mirakurun = new MirakurunChangeAdapter(async () => changeStream);
            const mirakc = new MirakcChangeAdapter(async () => changeStream);
            const getJson = vi.fn(async (route: string) => {
                if (route === '/api/status') return { available: true, futureStatusField: 'ignored' };
                if (route === '/api/version') {
                    return { current: fixture.version, latest: fixture.version, futureVersionField: 'ignored' };
                }
                if (route === '/api/tuners') return [tuner];
                if (route === '/api/services') return [service];
                if (route === '/api/programs') return [program];
                if (route === '/api/services/101/programs') return [program];
                if (route === '/api/programs/201') return program;
                throw new Error('SYNTHETIC_UNEXPECTED_ROUTE');
            });
            const access = new TunerServerAccessModel(
                'http://synthetic.invalid:40772',
                'epgstation/synthetic',
                {
                    getJson,
                    getBuffer: vi.fn(async () => logo),
                    openStream: vi.fn(async () => ({ stream, close: closeStream })),
                },
                { changeFeed: { detector, mirakurun, mirakc } },
            );

            await expect(detector.detect()).resolves.toBe(fixture.product);
            await expect(access.getStatus()).resolves.toEqual({
                available: true,
                version: { current: fixture.version, latest: fixture.version },
            });
            await expect(access.getTuners()).resolves.toEqual([compatibility.tuner]);
            await expect(access.getServices()).resolves.toEqual([compatibility.service]);
            await expect(access.getPrograms()).resolves.toEqual([compatibility.expectedProgram]);
            await expect(access.getProgramsByService(101)).resolves.toEqual([compatibility.expectedProgram]);
            await expect(access.getProgram(201)).resolves.toEqual(compatibility.expectedProgram);
            await expect(access.getLogo(101)).resolves.toEqual(logo);

            const programStream = await access.openProgramStream({ programId: 201, priority: 7 });
            const serviceStream = await access.openServiceStream({ serviceId: 101, priority: 11 });
            expect(programStream.stream).toBe(stream);
            expect(serviceStream.stream).toBe(stream);

            const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
            const feed = await access.openChangeFeed(observer);
            changeStream.write(
                fixture.product === 'mirakurun'
                    ? JSON.stringify({
                          resource: 'program',
                          type: 'update',
                          data: program,
                          time: 2_000,
                          ...(fixture.futureFields ? { futureFrameField: true } : {}),
                      })
                    : `event:onair.program-changed\ndata:${JSON.stringify({
                          serviceId: 101,
                          ...(fixture.futureFields ? { futureField: true } : {}),
                      })}\n\n`,
            );
            await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledOnce());
            if (fixture.product === 'mirakurun') {
                expect(observer.changed).toHaveBeenCalledWith({
                    kind: 'program',
                    operation: 'update',
                    program: compatibility.expectedProgram,
                    time: 2_000,
                });
            } else {
                expect(observer.changed).toHaveBeenCalledWith({ kind: 'on-air-service', serviceId: 101 });
            }
            feed.close();
            await expect(feed.completion).resolves.toBeUndefined();
            expect(observer.aborted).not.toHaveBeenCalled();
            expect(observer.started).toHaveBeenCalledOnce();

            programStream.close();
            serviceStream.close();
            expect(closeStream).toHaveBeenCalledTimes(2);
        },
    );
});
