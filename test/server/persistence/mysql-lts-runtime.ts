import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { posix } from 'node:path';

import { cleanupInOrder } from './harness';
import type { MysqlSchema } from './mysql-runtime';

export type OfficialMySqlLtsConfig = MysqlSchema['config'];

export interface OfficialMySqlLtsSchema {
    readonly config: OfficialMySqlLtsConfig;
    applySql(sql: string): Promise<string>;
    cleanup(): Promise<void>;
}

export interface OfficialMySqlLtsRuntime {
    readonly imageDigest: string;
    readonly imageTag: string;
    readonly mysqldArguments: readonly string[];
    createSchema(): Promise<OfficialMySqlLtsSchema>;
    cleanup(): Promise<void>;
}

export interface OfficialMySqlLtsProvisionDependencies {
    readonly docker?: (arguments_: readonly string[]) => Promise<string>;
    readonly onFixtureDiagnostic?: (diagnostic: OfficialMySqlLtsOwnershipInspectionDiagnostic) => void;
    readonly waitForDatabase?: (execute: (sql: string) => Promise<string>) => Promise<void>;
}

export interface OfficialMySqlLtsOwnershipInspectionDiagnostic {
    readonly containerName: string;
    readonly error: unknown;
    readonly lease: string;
    readonly name: 'OfficialMySqlLtsOwnershipInspectionDiagnostic';
}

const officialLtsImageTag = 'mysql:lts';
const loopbackHost = '127.0.0.1';
const fixtureLabel = 'epgstation.persistence.fixture';
const fixtureLabelValue = 'mysql-lts';
const leaseLabel = 'epgstation.persistence.lease';
const mysqldArguments = ['--innodb_use_native_aio=0'] as const;

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
                const detail = String(stderr ?? '').trim().slice(-400);
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
    reportDiagnostic: OfficialMySqlLtsProvisionDependencies['onFixtureDiagnostic'],
    lease: FixtureContainerLease,
    error: unknown,
): void => {
    try {
        const diagnosticResult: unknown = reportDiagnostic?.({
            containerName: lease.containerName,
            error,
            lease: lease.lease,
            name: 'OfficialMySqlLtsOwnershipInspectionDiagnostic',
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
    reportDiagnostic: OfficialMySqlLtsProvisionDependencies['onFixtureDiagnostic'],
): Promise<never> => {
    let owned: OwnedFixtureContainer | undefined;
    try {
        owned = await inspectOwnedFixtureContainer(lease, runDocker);
    } catch (inspectionError) {
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
                    Object.assign(new Error('The failed official MySQL LTS provision left a residual container'), {
                        containerName: lease.containerName,
                        lease: lease.lease,
                        name: 'OfficialMySqlLtsResidualContainerError',
                    }),
                );
            }
        } catch (residualInspectionError) {
            failures.push(residualInspectionError);
        }
        throw new AggregateError(failures, 'Official MySQL LTS provision and cleanup failed');
    }
    throw primaryError;
};

const executeSql = (
    runDocker: (arguments_: readonly string[]) => Promise<string>,
    containerName: string,
    rootAuth: string,
    sql: string,
    database?: string,
): Promise<string> => {
    const arguments_ = ['exec', '-e', `MYSQL_PWD=${rootAuth}`, containerName, 'mysql', '--protocol=tcp', '-h127.0.0.1', '-uroot', '-N'];
    if (database !== undefined) {
        arguments_.push(database);
    }
    arguments_.push('-e', sql);
    return runDocker(arguments_);
};

const waitForDatabase = async (execute: (sql: string) => Promise<string>): Promise<void> => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        try {
            await execute('SELECT 1');
            return;
        } catch {
            // Poll interval for the real condition (SELECT 1 succeeds) checked above; not a
            // fixed wait-then-assume delay.
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    throw new Error('The official MySQL LTS runtime did not become ready');
};

export async function provisionOfficialMySqlLts(
    dependencies: OfficialMySqlLtsProvisionDependencies = {},
): Promise<OfficialMySqlLtsRuntime> {
    const runDocker = dependencies.docker ?? docker;
    const awaitDatabase = dependencies.waitForDatabase ?? waitForDatabase;
    const imageDigest = await runDocker(['image', 'inspect', officialLtsImageTag, '--format', '{{index .RepoDigests 0}}']);
    if (!imageDigest.startsWith('mysql@sha256:')) {
        throw new Error('The official MySQL LTS image has no repository digest');
    }

    const leaseToken = randomBytes(12).toString('hex');
    const lease: FixtureContainerLease = {
        containerName: `epgstation-persistence-lts-${leaseToken}`,
        lease: leaseToken,
    };
    const rootAuth = `test-${randomBytes(24).toString('hex')}`;
    const mysqldVolume = posix.join('/', 'var', 'lib', 'mysql');
    let ownsContainer = false;
    try {
        ownsContainer = true;
        await runDocker([
            'run',
            '--detach',
            '--rm',
            '--name',
            lease.containerName,
            '--label',
            `${fixtureLabel}=${fixtureLabelValue}`,
            '--label',
            `${leaseLabel}=${lease.lease}`,
            '--publish',
            [loopbackHost, '', '3306'].join(':'),
            '--tmpfs',
            `${mysqldVolume}:rw,nosuid,nodev,size=512m`,
            '--env',
            `MYSQL_ROOT_PASSWORD=${rootAuth}`,
            imageDigest,
            ...mysqldArguments,
        ]);
        const published = await runDocker(['port', lease.containerName, '3306/tcp']);
        const port = Number.parseInt(published.slice(published.lastIndexOf(':') + 1), 10);
        if (!Number.isSafeInteger(port) || port <= 0) {
            throw new Error('The official MySQL LTS runtime returned an invalid loopback port');
        }
        const executeRootSql = (sql: string, database?: string): Promise<string> =>
            executeSql(runDocker, lease.containerName, rootAuth, sql, database);
        await awaitDatabase(sql => executeRootSql(sql));

        return {
            imageDigest,
            imageTag: officialLtsImageTag,
            mysqldArguments,
            createSchema: async () => {
                const database = 'synthetic-mysql-schema';
                await executeRootSql(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
                await executeRootSql(
                    "CREATE USER 'synthetic-mysql-user'@'%' IDENTIFIED BY '<synthetic-mysql-password>'",
                );
                await executeRootSql(
                    `GRANT ALL PRIVILEGES ON \`${database}\`.* TO 'synthetic-mysql-user'@'%'`,
                );
                const config = {
                    database,
                    host: loopbackHost,
                    user: 'synthetic-mysql-user',
                    password: '<synthetic-mysql-password>',
                } as OfficialMySqlLtsConfig;
                (config as Record<string, string | number>).port = port;
                return {
                    config,
                    applySql: (sql: string) => executeRootSql(sql, database),
                    cleanup: async () => {
                        await executeRootSql(`DROP DATABASE IF EXISTS \`${database}\``);
                    },
                };
            },
            cleanup: async () => {
                const owned = await inspectOwnedFixtureContainer(lease, runDocker);
                if (owned === undefined) {
                    throw Object.assign(
                        new Error('The official MySQL LTS fixture container no longer matches its ownership lease'),
                        {
                            containerName: lease.containerName,
                            lease: lease.lease,
                            name: 'OfficialMySqlLtsFixtureOwnershipError',
                        },
                    );
                }
                await runDocker(['rm', '--force', owned.id]);
            },
        };
    } catch (error) {
        if (ownsContainer) {
            return throwProvisionFailure(error, lease, runDocker, dependencies.onFixtureDiagnostic);
        }
        throw error;
    }
}

export interface OfficialMySqlLtsSessionCleanup {
    readonly operator?: { closeConnection(): Promise<void> };
    readonly source?: { readonly isInitialized: boolean };
    readonly schema?: { cleanup(): Promise<void> };
    readonly runtime?: { cleanup(): Promise<void> };
}

export async function cleanupOfficialMySqlLtsSession(session: OfficialMySqlLtsSessionCleanup): Promise<void> {
    await cleanupInOrder([
        async () => {
            if (session.source?.isInitialized === true && session.operator !== undefined) {
                await session.operator.closeConnection();
            }
        },
        async () => {
            if (session.schema !== undefined) {
                await session.schema.cleanup();
            }
        },
        async () => {
            if (session.runtime !== undefined) {
                await session.runtime.cleanup();
            }
        },
    ]);
}

const quoteMysqlIdentifier = (value: string): string => `\`${value.replace(/`/g, '``')}\``;

const stabilizeCreateTable = (createTable: string): string =>
    createTable.replace(/AUTO_INCREMENT=\d+/gu, 'AUTO_INCREMENT=N');

export async function captureOfficialMySqlLtsSchemaSnapshot(
    applySql: (sql: string) => Promise<string>,
): Promise<string> {
    const tablesRaw = await applySql(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    );
    const tables = tablesRaw
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    const creates: string[] = [];
    for (const table of tables) {
        creates.push(stabilizeCreateTable(await applySql(`SHOW CREATE TABLE ${quoteMysqlIdentifier(table)}`)));
    }
    return creates.join('\n');
}
