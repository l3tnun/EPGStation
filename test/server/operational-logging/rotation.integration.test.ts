import 'reflect-metadata';

import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
    spawnCompiledChildScenario,
    type ChildHarnessCleanupEvidence,
    type ChildHarnessSession,
} from '../harness/child-process.js';

const execFileAsync = promisify(execFile);
const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

const reflectMetadataPath = require.resolve('reflect-metadata');
const loggerModelPath = join(compiledSnapshot, 'model', 'LoggerModel.js');
const operationalCategories = ['system', 'access', 'stream', 'encode'] as const;
const enospcAliveMarker = 'ALIVE_AFTER_ENOSPC';
const immediateExitMarker = 'IMMEDIATE_EXIT_LOG_MARKER';
const eaccesPrecheckMarker = 'APPENDER_PRECHECK:EACCES';
const sampleRoles = [
    {
        configPath: 'config/operatorLogConfig.sample.yml',
        dedicatedEncodeOutput: false,
        tokenPrefix: 'Operator',
    },
    {
        configPath: 'config/serviceLogConfig.sample.yml',
        dedicatedEncodeOutput: true,
        tokenPrefix: 'Service',
    },
    {
        configPath: 'config/epgUpdaterLogConfig.sample.yml',
        dedicatedEncodeOutput: false,
        tokenPrefix: 'EPGUpdater',
    },
] as const;

const childSource = String.raw`
require('reflect-metadata');
const { join } = require('node:path');
const compiledSnapshot = process.argv[1];
const configPath = process.argv[2];
const role = process.argv[3];
const LoggerModel = require(join(compiledSnapshot, 'model', 'LoggerModel.js')).default;
const log4js = require('log4js');

const model = new LoggerModel();
model.initialize(configPath);
const loggers = model.getLogger();
for (const category of ['system', 'access', 'stream', 'encode']) {
    loggers[category].info('ROLE_APPENDER_MARKER:' + role + ':' + category);
}
log4js.shutdown(error => {
    if (error) {
        console.error(error);
        process.exitCode = 1;
        return;
    }
    console.log('ROLE_APPENDER_SHUTDOWN_COMPLETE');
});
`;

const rotationChildSource = String.raw`
require('reflect-metadata');
const { join } = require('node:path');
const compiledSnapshot = process.argv[1];
const configPath = process.argv[2];
const markerCount = Number(process.argv[3]);
const LoggerModel = require(join(compiledSnapshot, 'model', 'LoggerModel.js')).default;
const log4js = require('log4js');

const model = new LoggerModel();
model.initialize(configPath);
for (let index = 0; index < markerCount; index += 1) {
    const marker = index.toString(10).padStart(3, '0');
    model.getLogger().system.info('ROTATION_MARKER:' + marker + ':' + 'x'.repeat(300));
}
log4js.shutdown(error => {
    if (error) {
        console.error(error);
        process.exitCode = 1;
        return;
    }
    console.log('ROTATION_SHUTDOWN_COMPLETE');
});
`;

const fileConfigurationSource = (filename: string): string =>
    JSON.stringify({
        appenders: {
            file: { type: 'file', filename },
        },
        categories: {
            default: { appenders: ['file'], level: 'info' },
            system: { appenders: ['file'], level: 'info' },
        },
    });

const enospcScenarioSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { symlinkSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const originalStderrWrite = process.stderr.write.bind(process.stderr);
let enospcObserved = false;
process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const result = originalStderrWrite(chunk, ...(args as []));
    if (!enospcObserved && String(chunk).includes('ENOSPC')) {
        enospcObserved = true;
        process.send?.({ type: 'enospc-observed' });
    }
    return result;
}) as typeof process.stderr.write;
const hotFilePath = join(__dirname, 'full-device.log');
const configPath = join(__dirname, 'full-device.yml');
symlinkSync('/dev/full', hotFilePath);
writeFileSync(configPath, ${JSON.stringify(fileConfigurationSource('__HOT_FILE_PATH__'))}.replace('__HOT_FILE_PATH__', hotFilePath), 'utf8');
const model = new LoggerModel();
model.initialize(configPath);
process.on('message', (message: unknown) => {
    if ((message as { type?: string }).type !== 'controlled-exit') return;
    process.stdout.write(${JSON.stringify(`${enospcAliveMarker}\n`)}, () => process.exit(0));
});
model.getLogger().system.info('ENOSPC_LOG_MARKER');
`;

const immediateExitScenarioSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const hotFilePath = join(__dirname, 'immediate-exit.log');
const configPath = join(__dirname, 'immediate-exit.yml');
writeFileSync(configPath, ${JSON.stringify(fileConfigurationSource('__HOT_FILE_PATH__'))}.replace('__HOT_FILE_PATH__', hotFilePath), 'utf8');
const model = new LoggerModel();
model.initialize(configPath);
model.getLogger().system.info(${JSON.stringify(immediateExitMarker)});
process.exit(0);
`;

const eaccesScenarioSource = `
require(${JSON.stringify(reflectMetadataPath)});
const { chmodSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const LoggerModel = require(${JSON.stringify(loggerModelPath)}).default;
const blockedDirectory = join(__dirname, 'blocked-appender');
const hotFilePath = join(blockedDirectory, 'blocked.log');
const configPath = join(__dirname, 'blocked-appender.yml');
mkdirSync(blockedDirectory);
writeFileSync(configPath, ${JSON.stringify(fileConfigurationSource('__HOT_FILE_PATH__'))}.replace('__HOT_FILE_PATH__', hotFilePath), 'utf8');
chmodSync(configPath, 0o644);
chmodSync(blockedDirectory, 0o555);
if (typeof process.getuid === 'function' && process.getuid() === 0) {
    chmodSync(__dirname, 0o755);
    process.setgid?.(65534);
    process.setuid?.(65534);
}
try {
    writeFileSync(hotFilePath, 'precheck', 'utf8');
    throw new Error('Expected the appender destination to reject writes');
} catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EACCES') throw error;
    process.stdout.write(${JSON.stringify(`${eaccesPrecheckMarker}\n`)});
}
new LoggerModel().initialize(configPath);
process.stdout.write('BUSINESS_REACHED\\n');
`;

const readIfPresent = async (filePath: string): Promise<string> => {
    try {
        return await readFile(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return '';
        }
        throw error;
    }
};

const cleanupSession = async (session: ChildHarnessSession): Promise<ChildHarnessCleanupEvidence> => {
    const evidence = await session.cleanup();
    await expect(access(session.tempDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(session.compiledEntrypoint)).rejects.toMatchObject({ code: 'ENOENT' });
    return evidence;
};

const expectCleanedSession = (evidence: ChildHarnessCleanupEvidence | undefined): void => {
    expect(evidence).toEqual({
        remainingChildProcesses: 0,
        remainingListeners: 0,
        remainingTimers: 0,
        remainingTempResources: 0,
    });
};

describe('role logging sample integration', () => {
    it.each(sampleRoles)('[OL-ROT-ROLE-APPENDER] applies actual appenders from $configPath', async role => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-role-logging-'));
        const configPath = join(temporaryDirectory, basename(role.configPath));
        const fileByCategory = Object.fromEntries(
            operationalCategories.map(category => [category, join(temporaryDirectory, `${category}.log`)]),
        ) as Record<(typeof operationalCategories)[number], string>;

        try {
            let sample = await readFile(resolve(role.configPath), 'utf8');
            for (const category of operationalCategories) {
                const token = `%${role.tokenPrefix}${category[0].toUpperCase()}${category.slice(1)}%`;
                sample = sample.replace(token, fileByCategory[category]);
            }
            await writeFile(configPath, sample, 'utf8');

            const result = await execFileAsync(
                process.execPath,
                ['-e', childSource, compiledSnapshot, configPath, role.tokenPrefix],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    killSignal: 'SIGKILL',
                    timeout: 10_000,
                },
            );

            expect(result.stderr).toBe('');
            expect(result.stdout).toContain('ROLE_APPENDER_SHUTDOWN_COMPLETE');
            for (const category of ['system', 'access', 'stream'] as const) {
                expect(await readFile(fileByCategory[category], 'utf8')).toContain(
                    `ROLE_APPENDER_MARKER:${role.tokenPrefix}:${category}`,
                );
            }
            const encodeOutput = await readIfPresent(fileByCategory.encode);
            expect(encodeOutput.includes(`ROLE_APPENDER_MARKER:${role.tokenPrefix}:encode`)).toBe(
                role.dedicatedEncodeOutput,
            );
            expect(result.stdout).toContain(`ROLE_APPENDER_MARKER:${role.tokenPrefix}:encode`);
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    });
});

describe('configured file rotation integration', () => {
    it('[OL-ROT-CAPACITY] rolls at capacity and retains configured backups', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'epgstation-log-rotation-'));
        const configPath = join(temporaryDirectory, 'rotation.yml');
        const hotFileName = 'rotation.log';
        const hotFilePath = join(temporaryDirectory, hotFileName);
        const maxLogSize = 1_024;
        const backups = 2;
        const markerCount = 8;
        const configuration = `appenders:
  rotation:
    type: file
    filename: "${hotFilePath}"
    maxLogSize: ${maxLogSize}
    backups: ${backups}
    pattern: "-yyyy-MM-dd"
    layout:
      type: pattern
      pattern: "%m"
categories:
  default:
    appenders:
      - rotation
    level: info
  system:
    appenders:
      - rotation
    level: info
`;

        try {
            await writeFile(configPath, configuration, 'utf8');
            const result = await execFileAsync(
                process.execPath,
                ['-e', rotationChildSource, compiledSnapshot, configPath, markerCount.toString(10)],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    killSignal: 'SIGKILL',
                    timeout: 10_000,
                },
            );

            expect(result.stderr).toBe('');
            expect(result.stdout).toContain('ROTATION_SHUTDOWN_COMPLETE');
            const logFileNames = (await readdir(temporaryDirectory))
                .filter(fileName => fileName === hotFileName || fileName.startsWith(`${hotFileName}.`))
                .sort();
            const rotatedFileNames = logFileNames.filter(fileName => fileName !== hotFileName);

            expect(logFileNames).toContain(hotFileName);
            expect(logFileNames.length).toBeGreaterThan(1);
            expect(logFileNames.length).toBeLessThanOrEqual(backups + 1);
            expect(rotatedFileNames.length).toBeLessThanOrEqual(backups);
            for (const rotatedFileName of rotatedFileNames) {
                expect(rotatedFileName).toMatch(/^rotation\.log\.-\d{4}-\d{2}-\d{2}\.[1-9]\d*$/u);
            }

            const combinedOutput = (
                await Promise.all(logFileNames.map(fileName => readFile(join(temporaryDirectory, fileName), 'utf8')))
            ).join('');
            for (let index = 0; index < markerCount; index += 1) {
                expect(combinedOutput).toContain(`ROTATION_MARKER:${index.toString(10).padStart(3, '0')}:`);
            }
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    });
});

describe('logging appender failure delivery on Linux file devices', () => {
    it('delivers an actual EACCES appender-open failure without creating a fallback file', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'linux-eacces-appender',
            source: eaccesScenarioSource,
        });
        const blockedDirectory = join(session.tempDirectory, 'blocked-appender');
        const blockedLogPath = join(blockedDirectory, 'blocked.log');

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
            await expect(access(blockedLogPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await chmod(blockedDirectory, 0o700).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            });
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 1, signal: null }));
        expect(session.stdout).toContain(eaccesPrecheckMarker);
        expect(session.stdout).not.toContain('BUSINESS_REACHED');
        expect(session.stderr).toContain('log file parse error');
        expectCleanedSession(cleanupEvidence);
    });

    it('reports ENOSPC while the process remains alive until the test performs a controlled exit', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'linux-dev-full-appender',
            source: enospcScenarioSource,
        });

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            const observedEvent = await session.waitForEvent('message');
            expect(observedEvent).toMatchObject({
                type: 'message',
                message: { type: 'enospc-observed' },
            });
            expect(session.stderr).toContain('ENOSPC');
            expect(session.events.some(event => event.type === 'exit' || event.type === 'close')).toBe(false);
            session.child.send({ type: 'controlled-exit' });
            await session.waitForClose();
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.stderr).toContain('ENOSPC');
        expect(session.stdout).toContain(enospcAliveMarker);
        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        const messageSequence = session.events.find(
            event => event.type === 'message' && (event.message as { type?: string }).type === 'enospc-observed',
        )?.sequence;
        const exitSequence = session.events.find(event => event.type === 'exit')?.sequence;
        expect(messageSequence).toBeTypeOf('number');
        expect(exitSequence).toBeTypeOf('number');
        expect(messageSequence as number).toBeLessThan(exitSequence as number);
        expectCleanedSession(cleanupEvidence);
    });

    it('records the narrow runtime result that an immediate controlled exit leaves the hot file empty', async () => {
        const session = await spawnCompiledChildScenario({
            name: 'immediate-exit-unflushed-log',
            source: immediateExitScenarioSource,
        });
        const hotFilePath = join(session.tempDirectory, 'immediate-exit.log');

        let cleanupEvidence: ChildHarnessCleanupEvidence | undefined;
        try {
            await session.waitForClose();
            expect(await readFile(hotFilePath, 'utf8')).toBe('');
            expect((await stat(hotFilePath)).size).toBe(0);
        } finally {
            cleanupEvidence = await cleanupSession(session);
        }

        expect(session.events).toContainEqual(expect.objectContaining({ type: 'exit', code: 0, signal: null }));
        expect(session.stdout).not.toContain(immediateExitMarker);
        expect(session.stderr).toBe('');
        expectCleanedSession(cleanupEvidence);
    });
});
