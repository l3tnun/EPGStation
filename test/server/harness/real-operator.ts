import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCompiledEntrypointSession, type ChildHarnessSession } from './child-process.js';

/**
 * Real-process harness for `application-runtime` tests: the compiled Operator (`dist/index.js`) runs as an
 * OS process against a loopback tuner-server stub, a real SQLite file, and its real Service child. Only
 * the child entry scripts may be replaced by a caller (the replaced script is still a real child process
 * on the real IPC channel).
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const loopbackHost = '127.0.0.1';

export const loopbackUrl = (port: number, path = ''): string =>
    ['http:', '', `${loopbackHost}:${port}`, path.replace(/^\//u, '')].join('/');

export interface TunerStubContext {
    /** Every request path (with query) received so far, in arrival order. */
    readonly requests: string[];
    /** Arrival time (epoch milliseconds) of every request, parallel to `requests`. */
    readonly arrivals: number[];
    /** Number of TCP connections accepted so far. */
    readonly connectionCount: () => number;
    /** Number of TCP connections currently open. */
    readonly openConnectionCount: () => number;
}

export type TunerStubHandler = (request: IncomingMessage, response: ServerResponse, context: TunerStubContext) => void;

export interface TunerStub extends TunerStubContext {
    readonly port: number;
    readonly close: () => Promise<void>;
}

export const respondJson = (response: ServerResponse, body: unknown, status = 200): void => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
};

export interface TunerFixture {
    readonly index: number;
    readonly name: string;
    readonly types: readonly string[];
}

export const tunerEntry = ({ index, name, types }: TunerFixture): Record<string, unknown> => ({
    index,
    isAvailable: true,
    isFault: false,
    isFree: true,
    isRemote: false,
    isUsing: false,
    name,
    types,
});

/** Answers the endpoints the Operator reads at start with a healthy tuner server holding `tuners`. */
export const healthyTunerHandler =
    (tuners: readonly TunerFixture[]): TunerStubHandler =>
    (request, response) => {
        const pathname = new URL(request.url ?? '/', loopbackUrl(1)).pathname;
        if (pathname === '/api/status') {
            respondJson(response, { version: 'synthetic' });
        } else if (pathname === '/api/tuners') {
            respondJson(response, tuners.map(tunerEntry));
        } else if (pathname === '/api/services' || pathname === '/api/programs') {
            respondJson(response, []);
        } else {
            respondJson(response, {}, 404);
        }
    };

export const startTunerStub = async (handler: TunerStubHandler): Promise<TunerStub> => {
    const requests: string[] = [];
    const arrivals: number[] = [];
    const sockets = new Set<Socket>();
    let accepted = 0;
    const context: TunerStubContext = {
        arrivals,
        connectionCount: () => accepted,
        openConnectionCount: () => sockets.size,
        requests,
    };
    const server: Server = createServer((request, response) => {
        requests.push(request.url ?? '/');
        arrivals.push(Date.now());
        handler(request, response, context);
    });
    server.on('connection', socket => {
        accepted += 1;
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, loopbackHost, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Tuner stub did not expose a TCP port');
    }
    return {
        ...context,
        close: async () => {
            for (const socket of sockets) socket.destroy();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
        port: address.port,
    };
};

export const reserveUnusedPort = async (): Promise<number> => {
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, loopbackHost, () => resolve());
    });
    const address = probe.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Port probe did not expose a TCP port');
    }
    await new Promise<void>(resolve => probe.close(() => resolve()));
    return address.port;
};

/**
 * Polls `probe` until it holds. The deadline only bounds a hung run; it is far above what the awaited
 * condition needs, so a loaded host does not turn a slow start into a failure.
 */
export const waitFor = async (
    probe: () => boolean | Promise<boolean>,
    description: string,
    diagnostic: () => unknown = () => undefined,
    deadlineMilliseconds = 40_000,
): Promise<void> => {
    const deadline = Date.now() + deadlineMilliseconds;
    while (Date.now() < deadline) {
        if (await probe()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Did not observe ${description}: ${JSON.stringify(diagnostic())}`);
};

export const sleep = (milliseconds: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

export interface OperatorOptions {
    /** Extra `config.yml` lines (YAML), after the fixed lines. */
    readonly config?: readonly string[];
    /** Source of the replacement `EPGUpdateExecutor.js` (ES module). Idles when omitted. */
    readonly epgExecutorSource?: string;
    /** Called with the runtime root after it is laid out and before the Operator starts. */
    readonly prepare?: (runtimeRoot: string) => Promise<void>;
    /** Source of the replacement `ServiceExecutor.js` (ES module). The real Service runs when omitted. */
    readonly serviceExecutorSource?: string;
    readonly servicePort: number;
    readonly tunerPort: number;
}

export interface OperatorHandle {
    readonly root: string;
    readonly servicePort: number;
    readonly runSession: ChildHarnessSession;
    /** Pids announced by `start epg updater pid:` lines, in order. */
    epgPids(): number[];
    /** Whether the Operator process is still running. */
    isAlive(): boolean;
    /** Number of occurrences of `text` in the Operator stdout. */
    count(text: string): number;
    readSystemLog(): Promise<string>;
    /** Pids announced by `start service pid:` lines, in order. */
    servicePids(): number[];
    stop(): Promise<void>;
    stdout(): string;
}

const idleExecutor = 'setInterval(() => undefined, 1_000_000);\n';

const layOutRuntimeRoot = async (runtimeRoot: string, compiledDist: string, options: OperatorOptions): Promise<void> => {
    await cp(compiledDist, join(runtimeRoot, 'dist'), { recursive: true });
    await symlink(
        dirname(dirname(createRequire(join(repositoryRoot, 'package.json')).resolve('reflect-metadata'))),
        join(runtimeRoot, 'node_modules'),
        'dir',
    );
    await Promise.all(['api.yml', 'package.json'].map(file => cp(join(repositoryRoot, file), join(runtimeRoot, file))));
    await Promise.all(
        ['config', 'data', 'logs/Operator', 'logs/Service', 'recorded', 'thumbnail', 'streamfiles'].map(directory =>
            mkdir(join(runtimeRoot, directory), { recursive: true }),
        ),
    );
    await Promise.all(
        [
            ['config.yml.template', 'config.yml.template'],
            ['operatorLogConfig.sample.yml', 'operatorLogConfig.yml'],
            ['serviceLogConfig.sample.yml', 'serviceLogConfig.yml'],
        ].map(([source, destination]) =>
            cp(join(repositoryRoot, 'config', source), join(runtimeRoot, 'config', destination)),
        ),
    );
        const keyOf = (line: string): string | undefined => /^([A-Za-z0-9_]+):/u.exec(line)?.[1];
    const overridden = new Set((options.config ?? []).map(keyOf));
    const fixedLines: readonly string[] = [
        `port: ${options.servicePort}`,
        `mirakurunPath: ${loopbackUrl(options.tunerPort)}`,
        'dbtype: sqlite',
        "thumbnail: '%ROOT%/thumbnail'",
        "streamFilePath: '%ROOT%/streamfiles'",
        'encodeProcessNum: 0',
        'concurrentEncodeNum: 0',
        'encode: []',
        "recorded: [{ name: 'synthetic', path: '%ROOT%/recorded' }]",
    ];
    await writeFile(
        join(runtimeRoot, 'config', 'config.yml'),
        [...fixedLines.filter(line => !overridden.has(keyOf(line))), ...(options.config ?? []), ''].join('\n'),
        { encoding: 'utf8', mode: 0o600 },
    );
    await writeFile(join(runtimeRoot, 'dist', 'model', 'epgUpdater', 'EPGUpdateExecutor.js'), idleExecutor);
    if (options.epgExecutorSource !== undefined) {
        await writeFile(join(runtimeRoot, 'dist', 'model', 'epgUpdater', 'EPGUpdateExecutor.js'), options.epgExecutorSource);
    }
    if (options.serviceExecutorSource !== undefined) {
        await writeFile(join(runtimeRoot, 'dist', 'model', 'service', 'ServiceExecutor.js'), options.serviceExecutorSource);
    }
    await options.prepare?.(runtimeRoot);
};

/** Starts the compiled Operator process. Returns once the process is spawned; callers wait for what they need. */
export const startOperator = async (options: OperatorOptions): Promise<OperatorHandle> => {
    const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
    if (compiledSnapshot === undefined) {
        throw new Error('Server test runner did not provide its compiled snapshot');
    }
    const runSession = await createCompiledEntrypointSession({
        compiledEntrypoint: join(compiledSnapshot, 'index.js'),
        cwd: dirname(compiledSnapshot),
        detachedProcessGroup: process.platform !== 'win32',
        gracefulReapDeadlineMilliseconds: 10_000,
        hardReapDeadlineMilliseconds: 10_000,
        prepareRuntimeRoot: runtimeRoot => layOutRuntimeRoot(runtimeRoot, compiledSnapshot, options),
    });
    const pidsOf = (label: string): number[] =>
        [...runSession.stdout.matchAll(new RegExp(`${label} pid: (\\d+)`, 'gu'))].map(match => Number(match[1]));
    let stopped = false;
    return {
        count: text => runSession.stdout.split(text).length - 1,
        epgPids: () => pidsOf('start epg updater'),
        isAlive: () => runSession.child.exitCode === null && runSession.child.signalCode === null,
        readSystemLog: async () => {
            try {
                return await readFile(join(runSession.tempDirectory, 'logs', 'Operator', 'system.log'), 'utf8');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return '';
                }
                throw error;
            }
        },
        root: runSession.tempDirectory,
        servicePids: () => pidsOf('start service'),
        servicePort: options.servicePort,
        runSession,
        stdout: () => runSession.stdout,
        stop: async () => {
            if (stopped) return;
            stopped = true;
            const evidence = await runSession.cleanup();
            if (evidence.remainingChildProcesses !== 0) {
                throw new Error(`Operator left ${evidence.remainingChildProcesses} child processes`);
            }
        },
    };
};

export const fetchJson = async (port: number, path: string, init?: RequestInit): Promise<{ body: unknown; status: number }> => {
    const response = await fetch(loopbackUrl(port, path), init);
    const text = await response.text();
    return { body: text === '' ? undefined : JSON.parse(text), status: response.status };
};

/** Resolves true when the Service answers `GET /api/version` with 2xx. */
export const serviceAnswers = async (port: number): Promise<boolean> => {
    try {
        const response = await fetch(loopbackUrl(port, '/api/version'));
        await response.arrayBuffer();
        return response.ok;
    } catch {
        return false;
    }
};

export const isProcessAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

/** Open file descriptor count of `pid` (Linux). */
export const openDescriptorCount = async (pid: number): Promise<number> => {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(`/proc/${pid}/fd`)).length;
};

export const residentSetKilobytes = async (pid: number): Promise<number> => {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = /VmRSS:\s+(\d+) kB/u.exec(status);
    if (match === null) throw new Error('VmRSS is missing');
    return Number(match[1]);
};

export interface SocketIoClient {
    /** Names of the events received so far, in arrival order. */
    events(): string[];
    /** The same events with their arrival time (epoch milliseconds). */
    timedEvents(): { at: number; name: string }[];
    close(): Promise<void>;
}

/** Minimal Socket.IO (Engine.IO v4) polling client: connects, then collects event names. */
export const connectSocketIo = async (port: number): Promise<SocketIoClient> => {
    const base = loopbackUrl(port, '/socket.io/');
    const opening = await (await fetch(`${base}?EIO=4&transport=polling`)).text();
    const sid = (JSON.parse(opening.slice(1)) as { sid: string }).sid;
    const url = `${base}?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`;
    await fetch(url, { body: '40', method: 'POST' });
    const received: { at: number; name: string }[] = [];
    const abort = new AbortController();
    let closed = false;
    const loop = (async () => {
        while (!closed) {
            try {
                const text = await (await fetch(url, { signal: abort.signal })).text();
                for (const packet of text.split('\u001e')) {
                    if (packet.startsWith('42')) {
                        received.push({ at: Date.now(), name: (JSON.parse(packet.slice(2)) as string[])[0] });
                    } else if (packet === '2') {
                        await fetch(url, { body: '3', method: 'POST' });
                    }
                }
            } catch {
                if (closed) return;
                await sleep(50);
            }
        }
    })();
    return {
        close: async () => {
            closed = true;
            abort.abort();
            await loop;
        },
        events: () => received.map(event => event.name),
        timedEvents: () => [...received],
    };
};

const requireFromProject = createRequire(join(repositoryRoot, 'package.json'));

interface SqliteDatabase {
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): { all(...parameters: unknown[]): unknown[]; run(...parameters: unknown[]): unknown };
}

/** Runs `work` against the Operator's real SQLite file (`data/database.db` under its runtime root). */
export const withDatabase = async <T>(root: string, work: (database: SqliteDatabase) => T | Promise<T>): Promise<T> => {
    const Database = requireFromProject('better-sqlite3') as new (path: string) => SqliteDatabase;
    const database = new Database(join(root, 'data', 'database.db'));
    try {
        return await work(database);
    } finally {
        database.close();
    }
};

export const seedChannel = (
    database: SqliteDatabase,
    channel: { readonly channelType: string; readonly id: number; readonly name: string },
): void => {
    database
        .prepare(
            'INSERT INTO channel (id, serviceId, networkId, name, halfWidthName, hasLogoData, channelTypeId, channelType, channel, type) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 1)',
        )
        .run(channel.id, channel.id, 1, channel.name, channel.name, channel.id, channel.channelType, String(channel.id));
};
