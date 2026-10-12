import { createServer, type Server } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createCompiledEntrypointSession,
    type ChildHarnessCleanupEvidence,
    type ChildHarnessSession,
} from '../../harness/child-process.js';
import { classifyServiceStartupFailure, retryConfirmedServiceAddressInUse } from '../../harness/startup-retry.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('Server test runner did not provide its compiled snapshot');
}
const activeSessions = new Set<ChildHarnessSession>();
const activeServers = new Set<Server>();
const loopbackHost = '127.0.0.1';

const loopbackUrl = (port: number, path = ''): string =>
    ['http:', '', `${loopbackHost}:${port}`, path.replace(/^\//u, '')].join('/');

const resolveProjectDependencyRoot = (lookupRoot: string): string =>
    dirname(dirname(createRequire(join(lookupRoot, 'package.json')).resolve('reflect-metadata')));

const linkRuntimeDependencies = (runtimeRoot: string, lookupRoot: string): Promise<void> =>
    symlink(resolveProjectDependencyRoot(lookupRoot), join(runtimeRoot, 'node_modules'), 'dir');

const closeServer = async (server: Server): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined ? resolve() : reject(error)));
    });
    activeServers.delete(server);
};

const listenOnUnusedPort = async (server: Server): Promise<number> => {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, loopbackHost, () => {
            server.off('error', reject);
            resolve();
        });
    });
    activeServers.add(server);
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Loopback server did not expose a TCP port');
    }
    return address.port;
};

const reserveUnusedPort = async (): Promise<number> => {
    const server = createServer();
    const port = await listenOnUnusedPort(server);
    await closeServer(server);
    return port;
};

const waitFor = async (
    probe: () => Promise<boolean>,
    description: string,
    diagnostic: () => unknown,
): Promise<void> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await probe()) {
            return;
        }
        // Poll interval for the real condition (probe()) checked above against the 15s
        // deadline; not a fixed wait-then-assume delay.
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Startup smoke did not observe ${description}: ${JSON.stringify(diagnostic())}`);
};

const writeSyntheticRuntimeRoot = async (
    runtimeRoot: string,
    compiledDist: string,
    tunerPort: number,
    servicePort: number,
): Promise<void> => {
    await cp(compiledDist, join(runtimeRoot, 'dist'), { recursive: true });
    await linkRuntimeDependencies(runtimeRoot, repositoryRoot);
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
    await writeFile(
        join(runtimeRoot, 'config', 'config.yml'),
        [
            `port: ${servicePort}`,
            `mirakurunPath: ${loopbackUrl(tunerPort)}`,
            'dbtype: sqlite',
            "recorded: [{ name: 'synthetic', path: '%ROOT%/recorded' }]",
            "thumbnail: '%ROOT%/thumbnail'",
            "streamFilePath: '%ROOT%/streamfiles'",
            "uploadTempDir: '%ROOT%/data/upload'",
            'encodeProcessNum: 0',
            'concurrentEncodeNum: 0',
            'encode: []',
            '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 },
    );
};

describe('startup smoke dependency boundary', () => {
    it('links resolvable project dependencies from regular and nested sandbox roots', async () => {
        const artifactRoot = join(repositoryRoot, 'test/server/.artifacts');
        await mkdir(artifactRoot, { recursive: true });
        const fixtureRoot = await mkdtemp(join(artifactRoot, 'startup-dependency-boundary-'));
        const nestedSandboxRoot = join(fixtureRoot, 'nested-sandbox');
        const regularRuntimeRoot = join(fixtureRoot, 'regular-runtime');
        const nestedRuntimeRoot = join(fixtureRoot, 'nested-runtime');

        try {
            await Promise.all(
                [nestedSandboxRoot, regularRuntimeRoot, nestedRuntimeRoot].map(path =>
                    mkdir(path, { recursive: true }),
                ),
            );
            await writeFile(join(nestedSandboxRoot, 'package.json'), '{"private":true}\n');
            await symlink(
                join(nestedSandboxRoot, 'missing-node-modules'),
                join(nestedSandboxRoot, 'node_modules'),
                'dir',
            );

            await linkRuntimeDependencies(regularRuntimeRoot, repositoryRoot);
            await linkRuntimeDependencies(nestedRuntimeRoot, nestedSandboxRoot);

            await expect(access(join(regularRuntimeRoot, 'node_modules', 'reflect-metadata'))).resolves.toBeUndefined();
            await expect(access(join(nestedRuntimeRoot, 'node_modules', 'reflect-metadata'))).resolves.toBeUndefined();
        } finally {
            await rm(fixtureRoot, { force: true, recursive: true });
        }
    });
});

const readSystemLog = async (session: ChildHarnessSession, process: 'Operator' | 'Service'): Promise<string> => {
    try {
        return await readFile(join(session.tempDirectory, 'logs', process, 'system.log'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return '';
        }
        throw error;
    }
};

const readServiceSystemLog = (session: ChildHarnessSession): Promise<string> => readSystemLog(session, 'Service');

afterEach(async () => {
    await Promise.all([...activeSessions].map(session => session.cleanup()));
    activeSessions.clear();
    await Promise.all([...activeServers].map(closeServer));
});

describe('startup smoke Service port retry', () => {
    it('retries once only after the failed attempt has completed its cleanup', async () => {
        const events: string[] = [];
        const initialFailure = new Error('synthetic startup timeout');
        let attempts = 0;

        const result = await retryConfirmedServiceAddressInUse(async () => {
            attempts += 1;
            events.push(`start:${attempts}`);
            try {
                if (attempts === 1) {
                    throw classifyServiceStartupFailure(
                        initialFailure,
                        'listen failure: EADDRINUSE synthetic-service-port',
                    );
                }
                return 'started';
            } finally {
                events.push(`cleanup:${attempts}`);
            }
        });

        expect(result).toBe('started');
        expect(events).toEqual(['start:1', 'cleanup:1', 'start:2', 'cleanup:2']);
    });

    it('stops after two confirmed address collisions and preserves the second failure', async () => {
        const events: string[] = [];
        const firstCause = new Error('synthetic first address collision');
        const secondCause = new Error('synthetic second address collision');
        const firstFailure = classifyServiceStartupFailure(firstCause, 'listen failure: EADDRINUSE first');
        const secondFailure = classifyServiceStartupFailure(secondCause, 'listen failure: EADDRINUSE second');
        let attempts = 0;

        await expect(
            retryConfirmedServiceAddressInUse(async () => {
                attempts += 1;
                events.push(`start:${attempts}`);
                try {
                    if (attempts === 1) {
                        throw firstFailure;
                    }
                    if (attempts === 2) {
                        throw secondFailure;
                    }
                    throw new Error('unexpected third startup attempt');
                } finally {
                    events.push(`cleanup:${attempts}`);
                }
            }),
        ).rejects.toBe(secondFailure);

        expect(secondFailure).toMatchObject({ cause: secondCause });
        expect(attempts).toBe(2);
        expect(events).toEqual(['start:1', 'cleanup:1', 'start:2', 'cleanup:2']);
    });

    it.each([
        {
            label: 'general startup failure',
            failure: new Error('synthetic product startup failure'),
            serviceLog: 'synthetic service log without a bind collision',
        },
        {
            label: 'unconfirmed error code',
            failure: Object.assign(new Error('synthetic unconfirmed collision'), { code: 'EADDRINUSE' }),
            serviceLog: 'synthetic service log without a bind collision',
        },
    ])('does not retry $label', async ({ failure, serviceLog }) => {
        const classified = classifyServiceStartupFailure(failure, serviceLog);
        let attempts = 0;

        await expect(
            retryConfirmedServiceAddressInUse(async () => {
                attempts += 1;
                throw classified;
            }),
        ).rejects.toBe(failure);
        expect(attempts).toBe(1);
    });
});

interface ReadyServiceContext {
    readonly servicePort: number;
    readonly session: ChildHarnessSession;
}

const runStartupSmokeAttempt = async (afterReady?: (context: ReadyServiceContext) => Promise<void>): Promise<void> => {
    const requestedTunerPaths: string[] = [];
    const mirakurunDocs = {
        swagger: '2.0',
        basePath: '/api',
        paths: {
            '/status': {
                parameters: [],
                get: { operationId: 'getStatus', parameters: [], tags: [] },
            },
            '/tuners': {
                parameters: [],
                get: { operationId: 'getTuners', parameters: [], tags: [] },
            },
        },
    };
    let tunerPort = 0;
    const tunerStub = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', loopbackUrl(tunerPort));
        requestedTunerPaths.push(`${requestUrl.pathname}${requestUrl.search}`);
        response.setHeader('content-type', 'application/json');
        if (requestUrl.pathname === '/api/docs') {
            response.end(JSON.stringify(mirakurunDocs));
            return;
        }
        if (requestUrl.pathname === '/api/status') {
            response.end(JSON.stringify({ version: 'synthetic' }));
            return;
        }
        if (requestUrl.pathname === '/api/tuners') {
            response.end('[]');
            return;
        }
        response.statusCode = 404;
        response.end('{}');
    });
    let session: ChildHarnessSession | undefined;

    try {
        tunerPort = await listenOnUnusedPort(tunerStub);
        const servicePort = await reserveUnusedPort();
        session = await createCompiledEntrypointSession({
            compiledEntrypoint: join(compiledSnapshot, 'index.js'),
            cwd: dirname(compiledSnapshot),
            detachedProcessGroup: process.platform !== 'win32',
            prepareRuntimeRoot: runtimeRoot =>
                writeSyntheticRuntimeRoot(runtimeRoot, compiledSnapshot, tunerPort, servicePort),
        });
        activeSessions.add(session);

        let serviceStatus: number | undefined;
        try {
            await waitFor(
                async () => {
                    try {
                        const response = await fetch(loopbackUrl(servicePort, '/api/docs'));
                        serviceStatus = response.status;
                        await response.arrayBuffer();
                        return response.ok;
                    } catch {
                        return false;
                    }
                },
                'Service HTTP /api/docs',
                () => ({
                    events: session?.events,
                    requestedTunerPaths,
                    stderr: session?.stderr,
                    stdout: session?.stdout,
                }),
            );
        } catch (error) {
            throw classifyServiceStartupFailure(error, await readServiceSystemLog(session));
        }

        expect(session.stdout).toContain('check db');
        expect(session.stdout).toMatch(/start service pid: \d+/u);
        expect(serviceStatus).toBeGreaterThanOrEqual(200);
        expect(serviceStatus).toBeLessThan(300);
        expect(requestedTunerPaths.some(path => path === '/api/docs')).toBe(false);
        expect(requestedTunerPaths.some(path => path.startsWith('/api/status'))).toBe(true);
        expect(requestedTunerPaths.some(path => path === '/api/tuners')).toBe(true);
        if (afterReady !== undefined) {
            await afterReady({ servicePort, session });
        }
    } finally {
        try {
            if (session !== undefined) {
                const cleanup: ChildHarnessCleanupEvidence = await session.cleanup();
                activeSessions.delete(session);
                expect(cleanup).toEqual({
                    remainingChildProcesses: 0,
                    remainingListeners: 0,
                    remainingTimers: 0,
                    remainingTempResources: 0,
                });
            }
        } finally {
            if (tunerStub.listening) {
                await closeServer(tunerStub);
            }
        }
    }

    expect(tunerStub.listening).toBe(false);
};

describe('compiled application runtime startup smoke', () => {
    it(
        'passes the dependency DB check, spawns Service, and serves its API docs with no residual resources',
        () => retryConfirmedServiceAddressInUse(runStartupSmokeAttempt),
        45_000,
    );

    it(
        'restarts a killed Service child, records the outage, and serves its API docs again',
        () =>
            retryConfirmedServiceAddressInUse(() =>
                runStartupSmokeAttempt(async ({ servicePort, session }) => {
                    const servicePids = (): number[] =>
                        [...session.stdout.matchAll(/start service pid: (\d+)/gu)].map(match => Number(match[1]));
                    expect(servicePids()).toHaveLength(1);
                    const [firstPid] = servicePids();

                    process.kill(firstPid, 'SIGKILL');

                    await waitFor(
                        async () => servicePids().length >= 2,
                        'a second Service child start after the kill',
                        () => ({ events: session.events, pids: servicePids(), stdout: session.stdout }),
                    );
                    const restartedPid = servicePids()[1];
                    expect(restartedPid).not.toBe(firstPid);
                    expect(() => process.kill(firstPid, 0)).toThrow(/ESRCH/u);

                    await waitFor(
                        async () => {
                            try {
                                const response = await fetch(loopbackUrl(servicePort, '/api/docs'));
                                await response.arrayBuffer();
                                return response.ok;
                            } catch {
                                return false;
                            }
                        },
                        'Service HTTP /api/docs after the Service child restart',
                        () => ({ events: session.events, pids: servicePids(), stdout: session.stdout }),
                    );
                    const systemLog = await readSystemLog(session, 'Operator');
                    expect(servicePids()).toEqual([firstPid, restartedPid]);
                    expect(systemLog).toContain('service process is down');
                    expect(systemLog).toContain('restart service');
                }),
            ),
        60_000,
    );
});
