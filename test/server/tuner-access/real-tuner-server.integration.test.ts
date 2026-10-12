import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import compatibility from '../fixtures/tuner-access/compatibility.json';
import { rawProgram, rawService } from '../fixtures/program-guide/raw-tuner-responses';

/*
 * tuner server の偽物（手書きの応答、`SyntheticTunerServer`、`PassThrough` の変更通知）が、本物の Mirakurun と
 * mirakc（Docker の公式 image を tuner 無しで起動したもの）と同じに振る舞うことを確かめる。
 *   - 偽物が返す services・programs・tuners の形を、本物が公開する API の schema（`/api/docs`）で検証する。
 *   - 同じ `TunerServerAccessModel`・製品判定・変更通知の adapter を、本物の server に向けて動かす。
 *   - 変更通知の stream を、実際の TCP の上で任意の byte 境界に分けて届けても、まとめて届けたときと同じに読む。
 * 本物の server は外へ出られない Docker network に置く（Mirakurun の `/api/version` は外部の registry に問い合わせる
 * ので、この構成では応答しない。version は mirakc で確かめる）。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const load = (...segments: string[]): any => (require(join(compiledSnapshot, ...segments)) as any).default;
const TunerServerAccessModel = load('model', 'tuner', 'TunerServerAccessModel.js');
const TunerHttpTransport = load('model', 'tuner', 'transport', 'TunerHttpTransport.js');
const { parseConnectionTarget } = require(
    join(compiledSnapshot, 'model', 'tuner', 'transport', 'ConnectionTargetParser.js'),
) as any;
const { normalizeTunerProgram, normalizeTunerService } = require(
    join(compiledSnapshot, 'model', 'tuner', 'TunerServerAccessModel.js'),
) as any;
const MirakurunChangeAdapter = load('model', 'tuner', 'change', 'MirakurunChangeAdapter.js');
const MirakcChangeAdapter = load('model', 'tuner', 'change', 'MirakcChangeAdapter.js');
const ProductDetector = load('model', 'tuner', 'change', 'ProductDetector.js');
const Ajv = require('ajv') as new (options: Record<string, unknown>) => {
    addFormat(name: string, format: boolean): void;
    addSchema(schema: unknown, key: string): void;
    validate(schema: unknown, value: unknown): boolean;
    errors?: Array<{
        instancePath?: string;
        dataPath?: string;
        keyword: string;
        params: Record<string, unknown>;
    }> | null;
};

const MIRAKURUN_IMAGE = 'chinachu/mirakurun:latest';
const MIRAKC_IMAGE = 'mirakc/mirakc:latest';
const CONTAINER_START_TIMEOUT_MS = 120_000;
const REQUEST_DEADLINE_MS = 5_000;
const DOCKER_COMMAND_TIMEOUT_MS = 30_000;
const userAgent = 'epgstation/synthetic';

const docker = (arguments_: readonly string[]): Promise<string> =>
    new Promise((resolve, reject) => {
        const child = execFile(
            'docker',
            arguments_,
            { detached: true, maxBuffer: 8 * 1024 * 1024, timeout: DOCKER_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' },
            (error, stdout, stderr) => {
                clearTimeout(deadline);
                if (error !== null) {
                    reject(
                        new Error(`docker ${arguments_[0]} failed: ${stderr.trim() || error.message}`, {
                            cause: error,
                        }),
                    );
                    return;
                }
                resolve(stdout.trim());
            },
        );
        // execFile の callback は close 後に呼ばれる。期限では CLI の process group も止める。
        const deadline = setTimeout(() => {
            try {
                if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
            }
        }, DOCKER_COMMAND_TIMEOUT_MS);
    });

interface RealTunerServer {
    readonly target: string;
    readonly name: string;
}

const lease = `synthetic-${process.pid}-${randomBytes(4).toString('hex')}`;
const networkName = `epgs-tuner-fixture-${lease}`;
const containers: string[] = [];
let fixtureRoot: string | undefined;
let mirakurun: RealTunerServer;
let mirakc: RealTunerServer;
const programStartAt = Date.now() + 2 * 60 * 60 * 1_000;

const syntheticService = {
    id: 3_273_601_024,
    serviceId: 1_024,
    networkId: 32_736,
    name: 'synthetic-service',
    type: 1,
    logoId: -1,
    remoteControlKeyId: 1,
    channel: { type: 'GR', channel: '27' },
};
const programAt = (startAt: number) => ({
    id: 327_361_024_001,
    eventId: 1,
    serviceId: 1_024,
    networkId: 32_736,
    startAt,
    duration: 1_800_000,
    isFree: true,
    name: 'synthetic-program',
    description: 'synthetic-description',
    genres: [{ lv1: 7, lv2: 0, un1: 15, un2: 15 }],
    video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 179 },
    audios: [{ componentType: 3, componentTag: 16, isMain: true, samplingRate: 48_000, langs: ['jpn'] }],
    extended: { 'synthetic-heading': 'synthetic-text' },
});
const syntheticProgram = programAt(programStartAt);

const startContainer = async (name: string, arguments_: readonly string[]): Promise<RealTunerServer> => {
    containers.push(name);
    await docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        networkName,
        '--label',
        `epgstation.tuner.fixture=${lease}`,
        ...arguments_,
    ]);
    const address = await docker(['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name]);
    const target = ['http:', '', `${address}:40772`].join('/');
    const access = new TunerServerAccessModel(target, userAgent, undefined, { tunerRestRequestTimeoutMs: 2_000 });
    const deadline = Date.now() + CONTAINER_START_TIMEOUT_MS;
    for (;;) {
        try {
            await access.checkAvailability();
            return { name, target };
        } catch (error) {
            if (Date.now() > deadline) {
                throw new Error(`${name} did not answer /api/status: ${(error as Error).message}`, { cause: error });
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
};

const setupRealTuners = async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'epgstation-real-tuner-'));
    await docker(['network', 'create', '--internal', '--label', `epgstation.tuner.fixture=${lease}`, networkName]);

    const mirakurunConfig = join(fixtureRoot, 'mirakurun-config');
    const mirakurunData = join(fixtureRoot, 'mirakurun-data');
    await mkdir(mirakurunConfig, { recursive: true });
    await mkdir(mirakurunData, { recursive: true });
    await writeFile(
        join(mirakurunConfig, 'server.yml'),
        'logLevel: 2\npath: /run/synthetic-mirakurun.sock\nport: 40772\n',
    );
    // 録画できる tuner は持たない。GR の局を有効にするため、すぐに終わる command の tuner を 1 台だけ置く。
    await writeFile(
        join(mirakurunConfig, 'tuners.yml'),
        "- name: synthetic-tuner\n  types:\n    - GR\n  command: 'false'\n",
    );
    await writeFile(join(mirakurunConfig, 'channels.yml'), "- name: synthetic-channel\n  type: GR\n  channel: '27'\n");
    // Mirakurun は integrity の見出しの無い保存 data をそのまま読み込む。
    await writeFile(join(mirakurunData, 'services.json'), JSON.stringify([syntheticService]));
    await writeFile(join(mirakurunData, 'programs.json'), JSON.stringify([syntheticProgram]));

    const mirakcRoot = join(fixtureRoot, 'mirakc');
    await mkdir(join(mirakcRoot, 'epg'), { recursive: true });
    await writeFile(
        join(mirakcRoot, 'config.yml'),
        'server:\n  addrs:\n    - http: 0.0.0.0:40772\nepg:\n  cache-dir: /synthetic-epg\nchannels: []\ntuners: []\n',
    );

    const started = await Promise.allSettled([
        startContainer(`epgs-tuner-fixture-mirakurun-${lease}`, [
            '-e',
            'DISABLE_B25_TEST=1',
            '-e',
            'DISABLE_PCSCD=1',
            '-v',
            `${mirakurunConfig}:/app-config`,
            '-v',
            `${mirakurunData}:/app-data`,
            MIRAKURUN_IMAGE,
        ]),
        startContainer(`epgs-tuner-fixture-mirakc-${lease}`, [
            '-v',
            `${join(mirakcRoot, 'config.yml')}:/etc/mirakc/config.yml:ro`,
            '-v',
            `${join(mirakcRoot, 'epg')}:/synthetic-epg`,
            MIRAKC_IMAGE,
        ]),
    ]);
    const failures = started.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
        throw new AggregateError(
            failures.map(result => result.reason),
            'real tuner server fixture startup failed',
        );
    }
    mirakurun = (started[0] as PromiseFulfilledResult<RealTunerServer>).value;
    mirakc = (started[1] as PromiseFulfilledResult<RealTunerServer>).value;
};

const cleanupRealTuners = async () => {
    const failures: unknown[] = [];
    for (const name of containers.splice(0)) {
        await docker(['rm', '-f', '-v', name]).catch(error => failures.push(error));
    }
    await docker(['network', 'rm', networkName]).catch(error => failures.push(error));
    // container が root で作った file を消せるよう、消す前に container の中から持ち主を戻すことはしない。
    // 一時 directory の中身は container が書いた data だけなので、docker で消してから host 側を消す。
    if (fixtureRoot !== undefined) {
        const cleanupName = `epgs-tuner-fixture-cleanup-${lease}`;
        await docker([
            'run',
            '--name',
            cleanupName,
            '--label',
            `epgstation.tuner.fixture=${lease}`,
            '--rm',
            '-v',
            `${fixtureRoot}:/fixture`,
            '--entrypoint',
            'sh',
            MIRAKURUN_IMAGE,
            '-c',
            'rm -rf /fixture/mirakurun-config /fixture/mirakurun-data /fixture/mirakc',
        ]).catch(error => failures.push(error));
        // CLI が期限で終了しても、daemon 側に残った掃除用 container を必ず回収する。
        await docker(['rm', '-f', '-v', cleanupName]).catch(async error => {
            try {
                const remaining = await docker(['ps', '-a', '-q', '--filter', `name=^/${cleanupName}$`]);
                if (remaining !== '') failures.push(error);
            } catch (inspectionError) {
                failures.push(error, inspectionError);
            }
        });
        await rm(fixtureRoot, { force: true, recursive: true }).catch(error => failures.push(error));
    }
    await docker(['ps', '-a', '-q', '--filter', `label=epgstation.tuner.fixture=${lease}`])
        .then(remaining => expect(remaining).toBe(''))
        .catch(error => failures.push(error));
    await docker(['network', 'ls', '-q', '--filter', `name=^${networkName}$`])
        .then(remaining => expect(remaining).toBe(''))
        .catch(error => failures.push(error));
    if (failures.length > 0) throw new AggregateError(failures, 'real tuner server fixture cleanup failed');
};

const accessFor = (server: RealTunerServer) =>
    new TunerServerAccessModel(server.target, userAgent, undefined, {
        tunerRestRequestTimeoutMs: REQUEST_DEADLINE_MS,
        tunerStreamEstablishmentTimeoutMs: REQUEST_DEADLINE_MS,
    });

const transportFor = (server: RealTunerServer) =>
    new TunerHttpTransport(parseConnectionTarget(server.target), userAgent);

const schemaValidator = async (server: RealTunerServer, product: 'mirakurun' | 'mirakc') => {
    const document = (await transportFor(server).getJson('/api/docs', {
        signal: AbortSignal.timeout(REQUEST_DEADLINE_MS),
    })) as Record<string, any>;
    const ajv = new Ajv({ strict: false, allErrors: true });
    // 数値の幅（int32・int64）と OpenAPI の拡張の format は、値の形の比較に関係しないので検証しない。
    for (const format of ['int32', 'int64', 'float', 'double', 'byte', 'binary', 'date-time', 'uri']) {
        ajv.addFormat(format, true);
    }
    ajv.addSchema(document, product);
    const definitions = product === 'mirakurun' ? 'definitions' : 'components/schemas';
    return (name: string, value: unknown): string[] => {
        const valid = ajv.validate({ $ref: `${product}#/${definitions}/${name}` }, value);
        return valid
            ? []
            : (ajv.errors ?? [])
                  .filter(error => error.keyword !== 'oneOf')
                  .map(
                      error =>
                          `${error.instancePath ?? error.dataPath} ${error.keyword} ${JSON.stringify(error.params)}`,
                  )
                  .sort();
    };
};

// 同じ fixture を使う六つの観測を、本体の finally が setup 失敗も含めて回収する一つの case で実行する。
const realTunerScenarios = [
    {
        name: '[TA-REAL-SERVER] reads the services, programs, tuners, and one program a real Mirakurun serves into the same normalized values',
        run: async () => {
            const access = accessFor(mirakurun);

            await expect(access.getServices()).resolves.toEqual([
                {
                    ...syntheticService,
                    epgReady: false,
                    epgUpdatedAt: 0,
                    hasLogoData: false,
                },
            ]);
            await expect(access.getPrograms()).resolves.toEqual([normalizeTunerProgram(syntheticProgram)]);
            await expect(access.getProgram(syntheticProgram.id)).resolves.toEqual(
                normalizeTunerProgram(syntheticProgram),
            );
            await expect(access.getTuners()).resolves.toEqual([
                {
                    index: 0,
                    name: 'synthetic-tuner',
                    types: ['GR'],
                    isAvailable: true,
                    isRemote: false,
                    isFree: true,
                    isUsing: false,
                    isFault: false,
                },
            ]);
            // 番組単位の取得（`/api/services/{id}/programs`）は mirakc だけが持つ。Mirakurun では使わない経路が 404 で失敗する。
            await expect(access.getProgramsByService(syntheticService.id)).rejects.toThrow(
                'Tuner request failed with status 404',
            );
            // logo を持たない局の logo は 503 で断る。
            await expect(access.getLogo(syntheticService.id)).rejects.toThrow('Tuner request failed with status 503');
            // 偽物の tuner server は stream を即時に返すが、本物の Mirakurun は放送前の番組・受信できない tuner の stream に
            // 応答を返さないまま待つ。stream の確立は EPGStation 側の期限（tunerStreamEstablishmentTimeoutMs）で打ち切る。
            const shortDeadline = new TunerServerAccessModel(mirakurun.target, userAgent, undefined, {
                tunerStreamEstablishmentTimeoutMs: 1_000,
            });
            await expect(
                shortDeadline.openProgramStream({ programId: syntheticProgram.id, priority: 1 }),
            ).rejects.toThrow('Tuner request timeout after 1000ms');
            await expect(
                shortDeadline.openServiceStream({ serviceId: syntheticService.id, priority: 1 }),
            ).rejects.toThrow('Tuner request timeout after 1000ms');
        },
    },
    {
        name: '[TA-REAL-SERVER] detects Mirakurun and opens and releases its real change feed',
        run: async () => {
            const transport = transportFor(mirakurun);
            const detector = new ProductDetector((options: any) => transport.probeJson('/api/config/server', options));
            await expect(detector.detect({ signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) })).resolves.toBe(
                'mirakurun',
            );

            const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
            const adapter = new MirakurunChangeAdapter((options: any) =>
                transport.getStream('/api/events/stream', options),
            );
            const handle = await adapter.open(observer, { signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) });
            try {
                // 本物の Mirakurun は接続の直後に配列の始まり（`[`）を送り、変更が無ければそのまま開いておく。
                await new Promise(resolve => setTimeout(resolve, 500));
                expect(observer.started).toHaveBeenCalledOnce();
                expect(observer.aborted).not.toHaveBeenCalled();
                handle.close();
                await expect(handle.completion).resolves.toBeUndefined();
                expect(observer.changed).not.toHaveBeenCalled();
            } finally {
                handle.close();
                await handle.completion;
            }
        },
    },
    {
        name: '[TA-REAL-SERVER] checks the shapes the response doubles use against the schema a real Mirakurun publishes',
        run: async () => {
            const validate = await schemaValidator(mirakurun, 'mirakurun');

            expect({
                seededService: validate('Service', syntheticService),
                seededProgram: validate('Program', syntheticProgram),
                compatibilityService: validate('Service', compatibility.service),
                compatibilityTuner: validate('TunerDevice', compatibility.tuner),
                compatibilityProgram: validate('Program', compatibility.program),
                programGuideService: validate('Service', rawService()),
                programGuideProgram: validate('Program', rawProgram('mirakurun')),
            }).toEqual({
                seededService: [],
                seededProgram: [],
                compatibilityService: [],
                // 偽物の tuner は、本物の Mirakurun が必ず返す `command`・`pid`・`users` を持たない。
                compatibilityTuner: [
                    ' required {"missingProperty":"command"}',
                    ' required {"missingProperty":"pid"}',
                    ' required {"missingProperty":"users"}',
                ],
                // 偽物の番組は `extended` を配列で持つ。本物の Mirakurun は object で返す。
                compatibilityProgram: ['.extended type {"type":"object"}'],
                programGuideService: [],
                programGuideProgram: [],
            });
        },
    },
    {
        name: '[TA-REAL-SERVER] reads the version, status, tuners, services, programs, and per-service programs a real mirakc serves',
        run: async () => {
            const access = accessFor(mirakc);

            await expect(access.getStatus()).resolves.toEqual({
                available: true,
                version: {
                    current: expect.stringMatching(/^\d+\.\d+\.\d+/u),
                    latest: expect.stringMatching(/^\d+\.\d+\.\d+/u),
                },
            });
            await expect(access.getTuners()).resolves.toEqual([]);
            await expect(access.getServices()).resolves.toEqual([]);
            await expect(access.getPrograms()).resolves.toEqual([]);
            await expect(access.getProgramsByService(syntheticService.id)).rejects.toThrow(
                'Tuner request failed with status 404',
            );
        },
    },
    {
        name: '[TA-REAL-SERVER] detects mirakc and opens and releases its real server-sent event feed',
        run: async () => {
            const transport = transportFor(mirakc);
            const detector = new ProductDetector((options: any) => transport.probeJson('/api/config/server', options));
            await expect(detector.detect({ signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) })).resolves.toBe('mirakc');

            const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
            const adapter = new MirakcChangeAdapter((options: any) => transport.getRootStream('/events', options));
            const handle = await adapter.open(observer, { signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) });
            try {
                await new Promise(resolve => setTimeout(resolve, 1_500));
                expect(observer.started).toHaveBeenCalledOnce();
                expect(observer.aborted).not.toHaveBeenCalled();
                handle.close();
                await expect(handle.completion).resolves.toBeUndefined();
            } finally {
                handle.close();
                await handle.completion;
            }
        },
    },
    {
        name: '[TA-REAL-SERVER] checks the shapes the response doubles use against the schema a real mirakc publishes',
        run: async () => {
            const validate = await schemaValidator(mirakc, 'mirakc');

            expect({
                compatibilityService: validate('MirakurunService', compatibility.service),
                compatibilityTuner: validate('MirakurunTuner', compatibility.tuner),
                compatibilityProgram: validate('MirakurunProgram', compatibility.program),
                programGuideService: validate('MirakurunService', rawService()),
                programGuideProgram: validate('MirakurunProgram', rawProgram('mirakc')),
            }).toEqual({
                compatibilityService: [],
                // 偽物の tuner は、本物の mirakc が必ず返す `users` を持たない。
                compatibilityTuner: [' required {"missingProperty":"users"}'],
                // 偽物の番組は `extended` を配列で持ち、`audio` に `isMain` が無い。本物の mirakc は `extended` を object で返す。
                compatibilityProgram: [
                    '.audio required {"missingProperty":"isMain"}',
                    '.audio type {"type":"null"}',
                    '.extended type {"type":"object"}',
                ],
                programGuideService: [],
                programGuideProgram: ['.extended type {"type":"object"}'],
            });
        },
    },
];

describe('tuner response doubles against real tuner servers', () => {
    it('[TA-REAL-SERVER] verifies REST, schemas, and feeds and reclaims both server fixtures', async () => {
        try {
            await setupRealTuners();
            for (const scenario of realTunerScenarios) {
                await expect(scenario.run(), scenario.name).resolves.toBeUndefined();
            }
        } finally {
            await cleanupRealTuners();
        }
    }, 480_000);
});

// ---- 変更通知の stream の byte 境界（実際の TCP） ----

type Delivery = 'whole' | 'byte-by-byte' | 'coalesced';

class FeedServer {
    private readonly server: Server;
    private readonly sockets = new Set<Socket>();

    constructor(handler: (request: IncomingMessage, response: ServerResponse) => void) {
        this.server = createServer(handler);
        this.server.on('connection', socket => {
            this.sockets.add(socket);
            socket.once('close', () => this.sockets.delete(socket));
        });
    }

    public async listen(): Promise<string> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => resolve());
        });
        const address = this.server.address();
        if (address === null || typeof address === 'string') throw new Error('feed server address is unavailable');
        return ['http:', '', `127.0.0.1:${address.port}`].join('/');
    }

    public async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }
}

const deliver = async (response: ServerResponse, frames: readonly string[], delivery: Delivery): Promise<void> => {
    const bytes = Buffer.from(frames.join(''), 'utf8');
    if (delivery === 'whole') {
        for (const frame of frames) {
            response.write(frame);
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return;
    }
    if (delivery === 'coalesced') {
        response.write(bytes);
        return;
    }
    for (const byte of bytes) {
        response.write(Buffer.from([byte]));
        await new Promise(resolve => setImmediate(resolve));
    }
};

const mirakurunEvent = (type: string, data: unknown, time: number) =>
    JSON.stringify({ resource: 'program', type, data, time });

describe('tuner change feed doubles against real TCP chunk boundaries', () => {
    const program = (id: number, name: string) => ({
        id,
        eventId: id,
        serviceId: 1_024,
        networkId: 32_736,
        startAt: programStartAt,
        duration: 60_000,
        isFree: true,
        name,
    });

    it.each(['whole', 'byte-by-byte', 'coalesced'] as const)(
        '[TA-REAL-SERVER] reads the Mirakurun change frames delivered %s over a real socket into the same changes',
        async delivery => {
            const frames = [
                '[\n',
                mirakurunEvent('create', program(1, 'synthetic-番組-一'), 1_000),
                '\n,\n',
                mirakurunEvent('update', program(2, 'synthetic-"quoted"-{brace}'), 2_000),
                '\n,\n',
                JSON.stringify({ resource: 'tuner', type: 'update', data: { index: 0 }, time: 2_500 }),
                '\n,\n',
                mirakurunEvent('remove', { id: 3 }, 3_000),
            ];
            const server = new FeedServer((_request, response) => {
                response.writeHead(200, { 'Content-Type': 'application/json' });
                void deliver(response, frames, delivery);
            });
            const target = await server.listen();
            try {
                const transport = new TunerHttpTransport(parseConnectionTarget(target), userAgent);
                const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
                const adapter = new MirakurunChangeAdapter((options: any) =>
                    transport.getStream('/api/events/stream', options),
                );
                const handle = await adapter.open(observer, { signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) });
                await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledTimes(3), { timeout: 10_000 });
                handle.close();
                await expect(handle.completion).resolves.toBeUndefined();

                expect(observer.changed.mock.calls.map(([change]) => change)).toEqual([
                    {
                        kind: 'program',
                        operation: 'create',
                        program: normalizeTunerProgram(program(1, 'synthetic-番組-一')),
                        time: 1_000,
                    },
                    {
                        kind: 'program',
                        operation: 'update',
                        program: normalizeTunerProgram(program(2, 'synthetic-"quoted"-{brace}')),
                        time: 2_000,
                    },
                    expect.objectContaining({ kind: 'program', operation: 'remove', time: 3_000 }),
                ]);
                expect(observer.aborted).not.toHaveBeenCalled();
            } finally {
                await server.close();
            }
        },
        30_000,
    );

    it.each(['whole', 'byte-by-byte', 'coalesced'] as const)(
        '[TA-REAL-SERVER] reads the mirakc server-sent events delivered %s over a real socket into the same changes',
        async delivery => {
            const frames = [
                'event: onair.program-changed\ndata: {"serviceId":3273601024}\n\n',
                'event: tuner.status-changed\ndata: {"tunerIndex":0}\n\n',
                'event: onair.program-changed\r\ndata: {"serviceId":3273601025}\r\n\r\n',
            ];
            const server = new FeedServer((_request, response) => {
                response.writeHead(200, { 'Content-Type': 'text/event-stream' });
                void deliver(response, frames, delivery);
            });
            const target = await server.listen();
            try {
                const transport = new TunerHttpTransport(parseConnectionTarget(target), userAgent);
                const observer = { aborted: vi.fn(), changed: vi.fn(), started: vi.fn() };
                const adapter = new MirakcChangeAdapter((options: any) => transport.getRootStream('/events', options));
                const handle = await adapter.open(observer, { signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) });
                await vi.waitFor(() => expect(observer.changed).toHaveBeenCalledTimes(2), { timeout: 10_000 });
                handle.close();
                await expect(handle.completion).resolves.toBeUndefined();

                expect(observer.changed.mock.calls.map(([change]) => change)).toEqual([
                    { kind: 'on-air-service', serviceId: 3_273_601_024 },
                    { kind: 'on-air-service', serviceId: 3_273_601_025 },
                ]);
            } finally {
                await server.close();
            }
        },
        30_000,
    );
});
