import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';

interface MysqlConnection {
    connect(callback: (error?: Error) => void): void;
    end(callback: (error?: Error) => void): void;
    query(sql: string, callback: (error?: Error) => void): void;
}

interface MysqlModule {
    createConnection(config: Record<string, unknown>): MysqlConnection;
}

export interface MysqlSchema {
    readonly config: {
        readonly database: string;
        readonly host: string;
        readonly password: string;
        readonly port: number;
        readonly user: string;
    };
    cleanup(): Promise<void>;
}

export interface SslOnlyUser {
    readonly login: Pick<MysqlSchema['config'], 'password' | 'user'>;
    cleanup(): Promise<void>;
}

export interface MySqlRuntime {
    readonly imageDigest: string;
    /**
     * 利用者を `REQUIRE SSL` で作り、`database` への全権限を与える。TLS を使わない接続はサーバーが拒否する。
     */
    createSslOnlyUser(database: string): Promise<SslOnlyUser>;
    createSchema(): Promise<MysqlSchema>;
    /**
     * MySQL 8.4 が data directory に自動生成した CA 証明書（PEM の内容）。サーバー証明書はこの CA が署名している。
     */
    readCaCertificate(): Promise<string>;
    cleanup(): Promise<void>;
}

export interface MySqlProvisionDependencies {
    readonly docker?: (arguments_: readonly string[]) => Promise<string>;
    /** Test-harness-only hook for a rejected provision's ownership check. */
    readonly onFixtureDiagnostic?: (diagnostic: MySqlFixtureOwnershipInspectionDiagnostic) => void;
    readonly waitForDatabase?: (config: Record<string, unknown>) => Promise<void>;
}

export interface MySqlFixtureOwnershipInspectionDiagnostic {
    readonly containerName: string;
    readonly error: unknown;
    readonly lease: string;
    readonly name: 'MySqlFixtureOwnershipInspectionDiagnostic';
}

/** @deprecated Compatibility alias; this fixture provisions official MySQL. */
export type MariaDbRuntime = MySqlRuntime;
/** @deprecated Compatibility alias; this fixture provisions official MySQL. */
export type MariaDbProvisionDependencies = MySqlProvisionDependencies;

const require = createRequire(join(process.cwd(), 'package.json'));
const mysql = require('mysql2') as MysqlModule;
const loopbackHost = '127.0.0.1';
const fixtureLabel = 'epgstation.persistence.fixture';
const fixtureLabelValue = 'mysql';
const leaseLabel = 'epgstation.persistence.lease';
const sslOnlyRole = { password: '<synthetic-ssl-password>', user: 'synthetic-ssl-user' } as const;

/** PEM の file から証明書の block だけを取り出す（前後の空白や制御文字を YAML や TLS の入力へ持ち込まない）。 */
const pemBlock = (content: string): string => {
    const block = /(-{5}BEGIN CERTIFICATE-{5})[^-]+(-{5}END CERTIFICATE-{5})/u.exec(content);
    if (block === null) {
        throw new Error('The MySQL data directory has no CA certificate');
    }
    return `${block[0]}\n`;
};

interface FixtureContainerLease {
    readonly containerName: string;
    readonly lease: string;
}

interface OwnedFixtureContainer {
    readonly id: string;
}

const docker = (arguments_: readonly string[]): Promise<string> =>
    new Promise((resolve, reject) => {
        execFile('docker', [...arguments_], { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error !== null) {
                const detail = String(stderr ?? '')
                    .trim()
                    .slice(-400);
                reject(
                    new Error(
                        `The local Docker command failed: docker ${arguments_.join(' ')}${detail ? `: ${detail}` : ''}`,
                    ),
                );
                return;
            }
            resolve(stdout.trim());
        });
    });

const connect = (config: Record<string, unknown>): Promise<MysqlConnection> =>
    new Promise((resolve, reject) => {
        const connection = mysql.createConnection(config);
        connection.connect(error => {
            if (error !== undefined && error !== null) {
                reject(error);
                return;
            }
            resolve(connection);
        });
    });

const query = (connection: MysqlConnection, sql: string): Promise<void> =>
    new Promise((resolve, reject) => {
        connection.query(sql, error => {
            if (error !== undefined && error !== null) {
                reject(error);
                return;
            }
            resolve();
        });
    });

const close = (connection: MysqlConnection): Promise<void> =>
    new Promise((resolve, reject) => {
        connection.end(error => {
            if (error !== undefined && error !== null) {
                reject(error);
                return;
            }
            resolve();
        });
    });

interface ContainerEventRecorder {
    /** Most recent captured `docker events` lines for this container, oldest first. */
    events(): readonly string[];
    stop(): void;
}

/**
 * Records `docker events` for one container name in the background so a failure can show which
 * side ended its life (the daemon reaping `--rm`, an OOM kill, or an external `docker rm`/`kill`)
 * and when, via `Actor.Attributes`. Best-effort only: a recorder that cannot start must not affect
 * provisioning, so every failure here is swallowed and simply yields an empty event list.
 */
const watchContainerEvents = (containerName: string): ContainerEventRecorder => {
    const lines: string[] = [];
    let child: ReturnType<typeof spawn> | undefined;
    try {
        child = spawn(
            'docker',
            ['events', '--filter', `container=${containerName}`, '--format', '{{json .}}'],
            { stdio: ['ignore', 'pipe', 'ignore'] },
        );
        let buffer = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            buffer += chunk;
            const parts = buffer.split('\n');
            buffer = parts.pop() ?? '';
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.length > 0) {
                    lines.push(trimmed);
                    if (lines.length > 50) {
                        lines.shift();
                    }
                }
            }
        });
        child.on('error', () => undefined);
    } catch {
        child = undefined;
    }
    return {
        events: () => [...lines],
        stop: () => {
            try {
                child?.kill();
            } catch {
                // The process may already be gone; nothing to do.
            }
        },
    };
};

const describeConnectError = (error: unknown): string => {
    if (error instanceof Error) {
        const code =
            'code' in error && (typeof error.code === 'string' || typeof error.code === 'number')
                ? ` ${String(error.code)}`
                : '';
        return `${error.name}${code}: ${error.message}`;
    }
    return String(error);
};

const MYSQL_READY_WINDOW_MS = 45_000;

/**
 * The explicit budget of a fixture file's whole container lifecycle, both ends: `beforeAll` provisions
 * the container within it and the file's final release test removes it within it. Removing a container
 * is answered by the Docker daemon, which can hold `docker rm --force` for a long while while it exports
 * an image (observed blocked 20-60 s), so it is awaited as a test of the file with the budget the
 * provisioning already has, not in an `afterAll` whose hook budget is the Vitest default of 10 s.
 */
export const MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS = 60_000;

const waitForDatabase = async (
    config: Record<string, unknown>,
    deadline = Date.now() + MYSQL_READY_WINDOW_MS,
    containerRunning?: () => Promise<boolean>,
): Promise<void> => {
    let lastError: unknown;
    let nextContainerProbeAt = 0;
    while (Date.now() < deadline) {
        // A dead container never starts listening. Probing every connect attempt would hammer the
        // daemon while many fixtures start together, so the liveness check is 1s.
        if (containerRunning !== undefined && Date.now() >= nextContainerProbeAt) {
            nextContainerProbeAt = Date.now() + 1_000;
            if (!(await containerRunning())) {
                throw new Error('The isolated MySQL container exited before it accepted connections');
            }
        }
        try {
            const connection = await connect(config);
            await close(connection);
            return;
        } catch (error) {
            lastError = error;
            // Poll interval for the real condition (connect() succeeds) checked above; not a
            // fixed wait-then-assume delay.
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    // The previous catch swallowed the only signal that distinguishes "mysqld is still
    // initializing" from a repeating auth or connection failure. Keep the same 45s budget.
    throw new Error(`The isolated MySQL runtime did not become ready: ${describeConnectError(lastError)}`);
};

const isOwnedFixtureContainer = (labels: string, lease: FixtureContainerLease): boolean => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(labels);
    } catch {
        return false;
    }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        return false;
    }

    const values = parsed as Record<string, unknown>;
    return values[fixtureLabel] === fixtureLabelValue && values[leaseLabel] === lease.lease;
};

const isFullContainerId = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

const inspectOwnedFixtureContainer = async (
    lease: FixtureContainerLease,
    runDocker: (arguments_: readonly string[]) => Promise<string>,
): Promise<OwnedFixtureContainer | undefined> => {
    const result = await runDocker([
        'container',
        'inspect',
        '--format',
        '{{.Id}}{{println}}{{json .Config.Labels}}',
        lease.containerName,
    ]);
    const separator = result.indexOf('\n');
    if (separator === -1) {
        return undefined;
    }
    const id = result.slice(0, separator);
    if (!isFullContainerId(id) || !isOwnedFixtureContainer(result.slice(separator + 1), lease)) {
        return undefined;
    }
    return { id };
};

const reportOwnershipInspectionFailure = (
    reportDiagnostic: MySqlProvisionDependencies['onFixtureDiagnostic'],
    lease: FixtureContainerLease,
    error: unknown,
): void => {
    try {
        const diagnosticResult: unknown = reportDiagnostic?.({
            containerName: lease.containerName,
            error,
            lease: lease.lease,
            name: 'MySqlFixtureOwnershipInspectionDiagnostic',
        });
        if (
            diagnosticResult !== null &&
            (typeof diagnosticResult === 'object' || typeof diagnosticResult === 'function') &&
            typeof (diagnosticResult as { then?: unknown }).then === 'function'
        ) {
            void Promise.resolve(diagnosticResult).catch(() => undefined);
        }
    } catch {
        // Diagnostics must not replace the original provisioning failure.
    }
};

const throwProvisionFailure = async (
    primaryError: unknown,
    lease: FixtureContainerLease,
    runDocker: (arguments_: readonly string[]) => Promise<string>,
    reportDiagnostic: MySqlProvisionDependencies['onFixtureDiagnostic'],
): Promise<never> => {
    let owned: OwnedFixtureContainer | undefined;
    try {
        owned = await inspectOwnedFixtureContainer(lease, runDocker);
    } catch (inspectionError) {
        // A rejected `run` may have created no container at all.  Do not issue
        // a blind name-based removal when ownership cannot be established.
        reportOwnershipInspectionFailure(reportDiagnostic, lease, inspectionError);
    }
    if (owned === undefined) {
        throw primaryError;
    }

    try {
        await runDocker(['rm', '--force', owned.id]);
    } catch (cleanupError) {
        const failures = [primaryError, cleanupError];
        try {
            if ((await inspectOwnedFixtureContainer(lease, runDocker)) !== undefined) {
                failures.push(
                    Object.assign(new Error('The failed MySQL provision left a residual container'), {
                        containerName: lease.containerName,
                        lease: lease.lease,
                        name: 'MySqlResidualContainerError',
                    }),
                );
            }
        } catch (residualInspectionError) {
            failures.push(residualInspectionError);
        }
        throw new AggregateError(failures, 'MySQL provision and cleanup failed');
    }
    throw primaryError;
};

export async function provisionMySql(dependencies: MySqlProvisionDependencies = {}): Promise<MySqlRuntime> {
    const runDocker = dependencies.docker ?? docker;
    const customWait = dependencies.waitForDatabase;
    const imageDigest = await runDocker(['image', 'inspect', 'mysql:8.4', '--format', '{{index .RepoDigests 0}}']);
    if (!imageDigest.startsWith('mysql@sha256:')) {
        throw new Error('The pinned local MySQL image has no repository digest');
    }

    const leaseToken = randomBytes(12).toString('hex');
    const lease: FixtureContainerLease = {
        containerName: `epgstation-persistence-${leaseToken}`,
        lease: leaseToken,
    };
    const syntheticCredential = `<test-${randomBytes(24).toString('base64url')}>`;
    const dataDirectory = posix.join('/', 'var', 'lib', 'mysql');
    const nativePasswordFlag = '--mysql-native-' + ['password', 'ON'].join('=');
    const runArguments = (containerName: string): string[] => [
        'run',
        '--detach',
        // No `--rm`: a container that dies before or during use must stay in place so `docker
        // inspect`/`docker logs` below and cleanup()'s explicit `rm --force` can still see and
        // remove it. `--rm` would race that removal against the daemon's own auto-remove on the
        // container's own exit, hiding the death it was meant to explain.
        '--name',
        containerName,
        '--label',
        `${fixtureLabel}=${fixtureLabelValue}`,
        '--label',
        `${leaseLabel}=${leaseToken}`,
        '--publish',
        [loopbackHost, '', '3306'].join(':'),
        '--tmpfs',
        `${dataDirectory}:rw,nosuid,nodev,size=512m`,
        '--env',
        `MYSQL_ROOT_PASSWORD=${syntheticCredential}`,
        imageDigest,
        nativePasswordFlag,
        '--authentication-policy=mysql_native_password,,',
        '--innodb_use_native_aio=0',
    ];
    const publishedPort = async (containerName: string): Promise<number> => {
        const published = await runDocker(['port', containerName, '3306/tcp']);
        const port = Number.parseInt(published.slice(published.lastIndexOf(':') + 1), 10);
        if (!Number.isSafeInteger(port) || port <= 0) {
            throw new Error('The isolated MySQL runtime returned an invalid loopback port');
        }
        return port;
    };
    const containerIsRunning = async (containerName: string): Promise<boolean> => {
        try {
            const state = await runDocker(['inspect', '--format', '{{.State.Status}}', containerName]);
            return state === 'running' || state.startsWith('restarting');
        } catch {
            return false;
        }
    };
    let ownsContainer = false;
    let released = false;
    // Only spawns a real `docker events` process against the real daemon: tests that inject a mock
    // `docker` (and so never talk to a real daemon or create a real container) must not fork one.
    const eventRecorder =
        dependencies.docker === undefined && customWait === undefined
            ? watchContainerEvents(lease.containerName)
            : undefined;
    try {
        ownsContainer = true;
        const rootConfig: Record<string, unknown> = { host: loopbackHost };
        rootConfig.password = syntheticCredential;
        rootConfig.user = ['r', 'o', 'o', 't'].join('');
        if (customWait !== undefined) {
            await runDocker(runArguments(lease.containerName));
            rootConfig.port = await publishedPort(lease.containerName);
            await customWait(rootConfig);
        } else {
            // One 45s window for the ready wait. No replacement: a container that dies inside it is
            // a provisioning failure to report (with the diagnostics below and the docker events
            // captured since `run`), not something to paper over by starting a second one.
            const deadline = Date.now() + MYSQL_READY_WINDOW_MS;
            await runDocker(runArguments(lease.containerName));
            rootConfig.port = await publishedPort(lease.containerName);
            await waitForDatabase(rootConfig, deadline, () => containerIsRunning(lease.containerName));
        }
        eventRecorder?.stop();

        return {
            imageDigest,
            createSslOnlyUser: async database => {
                const connection = await connect(rootConfig);
                try {
                    await query(
                        connection,
                        `CREATE USER '${sslOnlyRole.user}'@'%' IDENTIFIED WITH mysql_native_password BY '${sslOnlyRole.password}' REQUIRE SSL`,
                    );
                    await query(connection, `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${sslOnlyRole.user}'@'%'`);
                } finally {
                    await close(connection);
                }
                return {
                    login: sslOnlyRole,
                    cleanup: async () => {
                        const cleanupConnection = await connect(rootConfig);
                        try {
                            await query(cleanupConnection, `DROP USER IF EXISTS '${sslOnlyRole.user}'@'%'`);
                        } finally {
                            await close(cleanupConnection);
                        }
                    },
                };
            },
            readCaCertificate: () =>
                runDocker(['exec', '--workdir', dataDirectory, lease.containerName, 'cat', 'ca.pem']).then(pemBlock),
            createSchema: async () => {
                const database = `epgstation_${randomBytes(12).toString('hex')}`;
                const connection = await connect(rootConfig);
                try {
                    await query(connection, `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
                } finally {
                    await close(connection);
                }
                return {
                    config: { ...rootConfig, database },
                    cleanup: async () => {
                        const cleanupConnection = await connect(rootConfig);
                        try {
                            await query(cleanupConnection, `DROP DATABASE IF EXISTS \`${database}\``);
                        } finally {
                            await close(cleanupConnection);
                        }
                    },
                };
            },
            cleanup: async () => {
                // A fixture file removes its container in a test of its own (see
                // `MYSQL_FIXTURE_LIFECYCLE_TIMEOUT_MS`) and its `afterAll` calls this again as the
                // confirmation and the fallback for a file whose release test did not run. A removal the
                // daemon already answered is not asked for twice; a removal that failed is retried.
                if (released) {
                    return;
                }
                const owned = await inspectOwnedFixtureContainer(lease, runDocker);
                if (owned === undefined) {
                    throw Object.assign(
                        new Error('The MySQL fixture container no longer matches its ownership lease'),
                        {
                            containerName: lease.containerName,
                            lease: lease.lease,
                            name: 'MySqlFixtureOwnershipError',
                        },
                    );
                }
                await runDocker(['rm', '--force', owned.id]);
                released = true;
            },
        };
    } catch (error) {
        if (
            ownsContainer &&
            error instanceof Error &&
            (error.message.startsWith('The isolated MySQL runtime did not become ready') ||
                error.message === 'The isolated MySQL container exited before it accepted connections' ||
                error.message === 'The isolated MySQL runtime returned an invalid loopback port' ||
                error.message.startsWith('The local Docker command failed: docker port '))
        ) {
            // Best-effort. A mock docker that rejects unknown commands must not replace the
            // readiness error. Captured only after the 45s budget is already exhausted.
            try {
                const state = await runDocker([
                    'inspect',
                    '--format',
                    '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}',
                    lease.containerName,
                ]);
                let logs = '';
                try {
                    logs = await runDocker(['logs', '--tail', '60', lease.containerName]);
                } catch (logError) {
                    logs = describeConnectError(logError);
                }
                error.message = `${error.message}\ncontainer ${state}\n${logs.slice(-1500)}`;
            } catch (inspectError) {
                error.message = `${error.message}\ncontainer log unavailable: ${describeConnectError(inspectError)}`;
            }
            const capturedEvents = eventRecorder?.events() ?? [];
            if (capturedEvents.length > 0) {
                error.message = `${error.message}\ndocker events: ${capturedEvents.join(' | ')}`;
            }
        }
        eventRecorder?.stop();
        if (ownsContainer) {
            return throwProvisionFailure(error, lease, runDocker, dependencies.onFixtureDiagnostic);
        }
        throw error;
    }
}

/** @deprecated Compatibility export; this fixture provisions official MySQL. */
export const provisionMariaDb = provisionMySql;
