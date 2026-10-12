import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as apid from '../../../api';
import type IEncodeEvent from '../../../src/model/event/IEncodeEvent';
import type { FinishEncodeInfo } from '../../../src/model/event/IEncodeEvent';
import type { ManagedProcessHandle } from '../../../src/model/service/encode/IEncodeProcessManageModel';
import type { EncodeOption, EncodeProgressInfo } from '../../../src/model/service/encode/IEncoderModel';
import { createDeferred, type Deferred } from '../harness/async';

interface SyntheticEncoder {
    cancel: ReturnType<typeof vi.fn>;
    finish(isError: boolean, outputFilePath: string | null): void;
    finishCallback: ((isError: boolean, outputFilePath: string | null) => void) | null;
    getEncodeId: ReturnType<typeof vi.fn>;
    getEncodeOption: ReturnType<typeof vi.fn>;
    getProgressInfo: ReturnType<typeof vi.fn>;
    option: EncodeOption | null;
    setOnFinish: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
}

interface EncodeManageRuntime {
    admissionReservations: number;
    encodeQueueLimit: number;
    idCnt: number;
    runningQueue: SyntheticEncoder[];
    getEncodeInfo(): {
        runningQueue: Array<{ id: number; mode: string; recordedId: number; percent?: number; log?: string }>;
        waitQueue: Array<{ id: number; mode: string; recordedId: number }>;
    };
    push(option: apid.AddEncodeProgramOption): Promise<number>;
    cancel(id: apid.EncodeId): Promise<void>;
    cancelEncodeByRecordedId(id: apid.RecordedId): Promise<void>;
    getQueuedAndRunningRecordedIds():
        | { status: 'known'; recordedIds: ReadonlySet<apid.RecordedId> }
        | { status: 'unknown' };
}

interface EncodeManageConstructor {
    new (...dependencies: unknown[]): EncodeManageRuntime;
}

interface EncoderRuntime {
    cancel(): Promise<void>;
    childProcess: SyntheticChild | null;
    getEncodeId(): number | null;
    getProgressInfo(): EncodeProgressInfo | null;
    setOnFinish(callback: (isError: boolean, outputFilePath: string | null) => void): void;
    setOption(option: EncodeOption): void;
    start(): Promise<void>;
    timerId: NodeJS.Timeout | null;
}

interface EncoderConstructor {
    new (...dependencies: unknown[]): EncoderRuntime;
}

interface FileManagerRuntime {
    usedFileNameIndex: Record<string, boolean>;
    getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string>;
    release(filePath: string): void;
}

interface FileManagerConstructor {
    new (): FileManagerRuntime;
}

interface SyntheticChild extends EventEmitter {
    exitCode: number | null;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: EventEmitter | null;
    stdin: null;
    stdout: EventEmitter | null;
}

interface EncodeFinishRuntime {
    finishEncode(info: FinishEncodeInfo): Promise<void>;
    set(): void;
}

interface EncodeFinishConstructor {
    new (...dependencies: unknown[]): EncodeFinishRuntime;
}

interface EncodeApiRuntime {
    getAll(isHalfWidth: boolean): Promise<apid.EncodeInfo>;
}

interface EncodeApiConstructor {
    new (...dependencies: unknown[]): EncodeApiRuntime;
}

interface ConfigApiRuntime {
    getConfig(isSecure: boolean): Promise<Record<string, unknown>>;
}

interface ConfigApiConstructor {
    new (...dependencies: unknown[]): ConfigApiRuntime;
}

interface EncodeEventConstructor {
    new (...dependencies: unknown[]): IEncodeEvent;
}

interface IPCServerRuntime {
    register(child: EventEmitter & { send: ReturnType<typeof vi.fn> }): void;
    setEncode(option: apid.AddEncodeProgramOption): void;
}

interface IPCServerConstructor {
    new (...dependencies: unknown[]): IPCServerRuntime;
}

interface QueueCheckHandle {
    executionId: string;
    lease: Deferred<string>;
    settled: Deferred<void>;
}

interface RecordedResourceUsePort {
    acquire(recordedId: apid.RecordedId, kind: 'encoding'): Promise<{ token: object }>;
    release(token: object): Promise<void>;
}

interface EncodeFinishSettlementPort {
    finishEncode(info: FinishEncodeInfo): Promise<void>;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const EncodeManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeManageModel.js')) as {
        default: EncodeManageConstructor;
    }
).default;
const EncoderModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncoderModel.js')) as {
        default: EncoderConstructor;
    }
).default;
const EncodeFileManageModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFileManageModel.js')) as {
        default: FileManagerConstructor;
    }
).default;
const ProcessUtil = (
    require(join(compiledSnapshot, 'util', 'ProcessUtil.js')) as {
        default: {
            ROOT_PATH: string;
            kill(child: SyntheticChild): Promise<void>;
            parseCmdStr(command: string): { args: string[]; bin: string };
        };
    }
).default;
const EncodeApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'encode', 'EncodeApiModel.js')) as {
        default: EncodeApiConstructor;
    }
).default;
const ConfigApiModel = (
    require(join(compiledSnapshot, 'model', 'api', 'config', 'ConfigApiModel.js')) as {
        default: ConfigApiConstructor;
    }
).default;
const EncodeEvent = (
    require(join(compiledSnapshot, 'model', 'event', 'EncodeEvent.js')) as { default: EncodeEventConstructor }
).default;
const EncodeFinishModel = (
    require(join(compiledSnapshot, 'model', 'service', 'encode', 'EncodeFinishModel.js')) as {
        default: EncodeFinishConstructor;
    }
).default;
const IPCServer = (require(join(compiledSnapshot, 'model', 'ipc', 'IPCServer.js')) as { default: IPCServerConstructor })
    .default;
const Util = (
    require(join(compiledSnapshot, 'util', 'Util.js')) as {
        default: { sleep(milliseconds: number): Promise<void> };
    }
).default;

const addOption = (overrides: Partial<apid.AddEncodeProgramOption> = {}): apid.AddEncodeProgramOption => ({
    directory: 'synthetic-subdirectory',
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 41,
    removeOriginal: true,
    sourceVideoFileId: 43,
    ...overrides,
});

describe('Tasks 4.1 and 5.1 characterization', () => {
    it('[EN-SPEC-R4-3-5] accepts only complete progress records and emits once per accepted update', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();

        expect(fixture.model.getProgressInfo()).toBeNull();
        for (const line of [
            'not-json',
            JSON.stringify({ type: 'status', percent: 10, log: 'wrong type' }),
            JSON.stringify({ type: 'progress', log: 'missing percent' }),
            JSON.stringify({ type: 'progress', percent: 20 }),
            JSON.stringify({ type: 'progress', percent: '30', log: 'wrong percent type' }),
            JSON.stringify({ type: 'progress', percent: 30, log: 4 }),
        ]) {
            fixture.stdout.emit('data', `${line}\n`);
        }

        expect(fixture.model.getProgressInfo()).toBeNull();
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).not.toHaveBeenCalled();

        fixture.stdout.emit('data', `${JSON.stringify({ type: 'progress', percent: 0, log: '' })}\n`);
        fixture.stdout.emit(
            'data',
            `${JSON.stringify({ type: 'progress', percent: 100, log: 'synthetic complete' })}\n`,
        );

        expect(fixture.model.getProgressInfo()).toEqual({ percent: 100, log: 'synthetic complete' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledTimes(2);
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-FRAMING] preserves complete chunks and frames split and newline-delimited progress', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        const progressAtNotification: Array<EncodeProgressInfo | null> = [];
        fixture.encodeEvent.emitUpdateEncodeProgress.mockImplementation(() => {
            progressAtNotification.push(fixture.model.getProgressInfo());
        });
        fixture.stdout.emit('data', JSON.stringify({ type: 'progress', percent: 11, log: 'complete chunk' }));
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 11, log: 'complete chunk' });
        expect(progressAtNotification).toEqual([{ percent: 11, log: 'complete chunk' }]);

        const line = JSON.stringify({ type: 'progress', percent: 47, log: 'split progress' });
        const splitAt = Math.floor(line.length / 2);

        fixture.stdout.emit('data', line.slice(0, splitAt));
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 11, log: 'complete chunk' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();

        fixture.stdout.emit('data', `${line.slice(splitAt)}\n`);
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 47, log: 'split progress' });
        expect(progressAtNotification).toEqual([
            { percent: 11, log: 'complete chunk' },
            { percent: 47, log: 'split progress' },
        ]);

        fixture.stdout.emit(
            'data',
            [
                JSON.stringify({ type: 'progress', percent: 63, log: 'before invalid' }),
                'invalid progress',
                JSON.stringify({ type: 'progress', percent: 79, log: 'after invalid' }),
                '',
            ].join('\n'),
        );
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 79, log: 'after invalid' });
        expect(progressAtNotification).toEqual([
            { percent: 11, log: 'complete chunk' },
            { percent: 47, log: 'split progress' },
            { percent: 63, log: 'before invalid' },
            { percent: 79, log: 'after invalid' },
        ]);
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-UTF8] preserves a progress log split inside a UTF-8 character', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        const record = Buffer.from(JSON.stringify({ type: 'progress', percent: 52, log: '進捗を取得' }), 'utf8');
        const multibyteStart = record.indexOf(Buffer.from('進', 'utf8'));
        expect(multibyteStart).toBeGreaterThanOrEqual(0);

        fixture.stdout.emit('data', record.subarray(0, multibyteStart + 1));
        fixture.stdout.emit('data', record.subarray(multibyteStart + 1, multibyteStart + 2));
        fixture.stdout.emit('data', record.subarray(multibyteStart + 2));

        expect(fixture.model.getProgressInfo()).toEqual({ percent: 52, log: '進捗を取得' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-RESYNC] discards an unterminated malformed chunk before a complete valid event', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();

        fixture.stdout.emit('data', Buffer.from('not-json'));
        fixture.stdout.emit(
            'data',
            new Uint8Array(Buffer.from(JSON.stringify({ type: 'progress', percent: 68, log: 'resynchronized' }))),
        );

        expect(fixture.model.getProgressInfo()).toEqual({ percent: 68, log: 'resynchronized' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-RESYNC-PENDING-UTF8] discards a pending malformed byte before a complete valid event', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        const progress = { type: 'progress', percent: 69, log: 'after pending byte' };

        fixture.stdout.emit('data', Buffer.concat([Buffer.from('not-json'), Buffer.from([0xe9])]));
        fixture.stdout.emit('data', Buffer.from(JSON.stringify(progress)));

        expect(fixture.model.getProgressInfo()).toEqual({ percent: 69, log: 'after pending byte' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-RESYNC-PENDING-CARRY] preserves a trailing UTF-8 byte after resynchronizing', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        const firstRecord = Buffer.from(JSON.stringify({ type: 'progress', percent: 70, log: 'first record' }) + '\n');
        const secondRecord = Buffer.from(JSON.stringify({ type: 'progress', percent: 71, log: '進捗を取得' }), 'utf8');
        const multibyteStart = secondRecord.indexOf(Buffer.from('進', 'utf8'));
        expect(multibyteStart).toBeGreaterThanOrEqual(0);

        fixture.stdout.emit('data', Buffer.concat([Buffer.from('not-json'), Buffer.from([0xe9])]));
        fixture.stdout.emit('data', Buffer.concat([firstRecord, secondRecord.subarray(0, multibyteStart + 1)]));
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 70, log: 'first record' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();

        fixture.stdout.emit('data', secondRecord.subarray(multibyteStart + 1));
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 71, log: '進捗を取得' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledTimes(2);
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-3-5-LISTENER-GUARD] swallows an exception thrown while parsing a stdout chunk', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();

        // updateEncodingProgressInfo は `Buffer.from(data)` から始まる。stdout の 'data' listener は
        // 通常 Buffer/string しか受け取らないが、`null` のような Buffer.from が拒否する値が来た場合に
        // TypeError が listener 内の try/catch (EncoderModel.ts の updateEncodingProgressInfo 呼び出し
        // 直後) で握りつぶされ、以降の progress 解析が壊れないことを確かめる。
        expect(() => fixture.stdout.emit('data', null)).not.toThrow();
        expect(fixture.model.getProgressInfo()).toBeNull();
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).not.toHaveBeenCalled();

        fixture.stdout.emit('data', JSON.stringify({ type: 'progress', percent: 42, log: 'after guarded throw' }));
        expect(fixture.model.getProgressInfo()).toEqual({ percent: 42, log: 'after guarded throw' });
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R3-5-R5-2-DUPLICATE] settles duplicate terminal events and production listeners once', async () => {
        vi.useFakeTimers();
        const fixture = await makeEncoderFixture({ progressStream: true, stderrStream: true });
        const release = vi.spyOn(fixture.fileManager, 'release');
        const finish = vi.fn();
        fixture.model.setOnFinish(finish);
        await fixture.model.start();

        expect(fixture.child.listenerCount('exit')).toBe(1);
        expect(fixture.stdout.listenerCount('data')).toBe(1);
        expect(fixture.stderr.listenerCount('data')).toBe(1);
        fixture.stderr.emit('data', 'synthetic stderr');
        expect(fixture.log.encode.debug).toHaveBeenCalledWith('synthetic stderr');
        fixture.child.exitCode = 0;
        fixture.child.emit('exit', 0, null);
        fixture.child.emit('exit', 0, null);

        expect(release).toHaveBeenCalledOnce();
        expect(finish).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(fixture.child.listenerCount('exit')).toBe(0);
        expect(fixture.stdout.listenerCount('data')).toBe(0);
        expect(fixture.stderr.listenerCount('data')).toBe(0);
    });

    it('[EN-SPEC-R3-5-R5-2-IMMEDIATE] settles a child that exited before its exit listener was observed', async () => {
        vi.useFakeTimers();
        const fixture = await makeEncoderFixture({ immediateExitCode: 0 });
        const finish = vi.fn();
        fixture.model.setOnFinish(finish);

        await fixture.model.start();
        expect(finish).toHaveBeenCalledOnce();
        expect(fixture.child.listenerCount('exit')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        fixture.child.emit('exit', 0, null);
        expect(finish).toHaveBeenCalledOnce();
    });

    it('[EN-SPEC-R7-1-5] deletes an abnormal owned output, keeps a normal output, and ignores null output', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);

        const abnormal = await makeEncoderFixture();
        await abnormal.model.start();
        const abnormalOutput = (abnormal.create.mock.calls[0][0] as { output: string }).output;
        await writeFile(abnormalOutput, 'partial output');
        const abnormalFinish = waitForFinish(abnormal.model);
        abnormal.child.emit('exit', 1, null);
        await expect(abnormalFinish).resolves.toEqual({ isError: true, output: abnormalOutput });
        await expect(access(abnormalOutput)).rejects.toThrow();
        expect(abnormal.fileManager.usedFileNameIndex).toEqual({});

        const normal = await makeEncoderFixture();
        await normal.model.start();
        const normalOutput = (normal.create.mock.calls[0][0] as { output: string }).output;
        await writeFile(normalOutput, 'completed output');
        const normalFinish = waitForFinish(normal.model);
        normal.child.emit('exit', 0, null);
        await expect(normalFinish).resolves.toEqual({ isError: false, output: normalOutput });
        await expect(access(normalOutput)).resolves.toBeUndefined();
        expect(normal.fileManager.usedFileNameIndex).toEqual({});

        const noOutput = await makeEncoderFixture({ encode: [{ cmd: '%NODE%', name: 'synthetic-mode' }] });
        await noOutput.model.start();
        const noOutputFinish = waitForFinish(noOutput.model);
        noOutput.child.emit('exit', 1, null);
        await expect(noOutputFinish).resolves.toEqual({ isError: true, output: null });
        expect(noOutput.fileManager.usedFileNameIndex).toEqual({});
    });

    it('[EN-SPEC-R5-2-R3-5] joins explicit and deadline cancellation through one managed stop until terminal', async () => {
        vi.useFakeTimers();
        const beforeStart = await makeEncoderFixture();
        await beforeStart.model.cancel();
        expect(beforeStart.createManaged).not.toHaveBeenCalled();
        expect(beforeStart.requestStop).not.toHaveBeenCalled();

        const stopResult = createDeferred<{ status: 'requested'; sentSignals: ['SIGINT'] }>();
        const fixture = await makeEncoderFixture({
            encode: [{ cmd: '%NODE%', name: 'synthetic-mode', rate: 3 }],
            stopResult,
        });
        const directKill = vi.spyOn(ProcessUtil, 'kill').mockResolvedValue(undefined);
        const finish = vi.fn();
        fixture.model.setOnFinish(finish);
        await fixture.model.start();

        const explicit = fixture.model.cancel();
        const duplicate = fixture.model.cancel();
        await vi.advanceTimersByTimeAsync(75);

        expect(fixture.createManaged).toHaveBeenCalledOnce();
        expect(fixture.requestStop).toHaveBeenCalledOnce();
        expect(fixture.requestStop).toHaveBeenCalledWith(fixture.handle);
        expect(directKill).not.toHaveBeenCalled();
        expect(fixture.model.childProcess).toBe(fixture.child);
        expect(finish).not.toHaveBeenCalled();

        stopResult.resolve({ status: 'requested', sentSignals: ['SIGINT'] });
        await Promise.all([explicit, duplicate]);
        expect(fixture.model.childProcess).toBe(fixture.child);
        expect(finish).not.toHaveBeenCalled();

        fixture.child.emit('exit', null, 'SIGINT');
        await Promise.resolve();
        expect(finish).toHaveBeenCalledOnce();
        expect(fixture.model.childProcess).toBeNull();
    });

    it('[EN-SPEC-R6-1-3-5-7-8] reflects successful results before optional source deletion and completion', async () => {
        const output = makeFinishFixture();
        await output.finish(finishInfo({ removeOriginal: true }));
        expect(output.calls).toEqual(['add:synthetic-output.mp4', 'delete:43', 'ui', 'complete:41:701:synthetic-mode']);

        const noOutput = makeFinishFixture();
        await noOutput.finish(finishInfo({ filePath: null, fullOutputPath: null, removeOriginal: false }));
        expect(noOutput.calls).toEqual(['size:43', 'ui', 'complete:41:null:synthetic-mode']);

        for (const partialOutput of [
            { filePath: null, fullOutputPath: 'synthetic-output.mp4' },
            { filePath: 'synthetic-output.mp4', fullOutputPath: null },
        ]) {
            const partial = makeFinishFixture();
            await partial.finish(finishInfo({ ...partialOutput, removeOriginal: false }));
            expect(partial.calls).toEqual(['size:43', 'ui', 'complete:41:null:synthetic-mode']);
        }

        const queue = makeManage(1, 4);
        const completed: FinishEncodeInfo[] = [];
        queue.event.setFinishEncode(info => completed.push(info));
        await queue.manage.push(addOption({ recordedId: 71, sourceVideoFileId: 7001 }));
        await queue.manage.push(addOption({ recordedId: 72, sourceVideoFileId: 7001 }));
        await queue.settleCurrentChecks();
        queue.encoders[0].finish(false, 'synthetic-output.mp4');
        await flushEventLoop();
        expect(completed).toHaveLength(1);
        expect(completed[0].removeOriginal).toBe(false);
        queue.encoders[1].finish(true, null);
        await queue.cleanup();
        expectCleanFixture(queue);
    });

    it('[EN-SPEC-R6-3-5] suppresses deletion for a running sibling but permits an unrelated running source', async () => {
        const sameSource = makeManage(2, 4);
        const sameSourceCompleted: FinishEncodeInfo[] = [];
        sameSource.event.setFinishEncode(info => sameSourceCompleted.push(info));
        await sameSource.manage.push(addOption({ recordedId: 81, sourceVideoFileId: 8001 }));
        await sameSource.manage.push(addOption({ recordedId: 82, sourceVideoFileId: 8001 }));
        await sameSource.settleCurrentChecks();
        expect(sameSource.manage.getEncodeInfo()).toMatchObject({
            runningQueue: [{ id: 1 }, { id: 2 }],
            waitQueue: [],
        });
        sameSource.encoders[0].finish(false, 'same-source-output.mp4');
        await flushEventLoop();
        expect(sameSourceCompleted).toHaveLength(1);
        expect(sameSourceCompleted[0].removeOriginal).toBe(false);
        sameSource.encoders[1].finish(true, null);
        await sameSource.cleanup();
        expectCleanFixture(sameSource);

        const unrelatedSource = makeManage(2, 4);
        const unrelatedCompleted: FinishEncodeInfo[] = [];
        unrelatedSource.event.setFinishEncode(info => unrelatedCompleted.push(info));
        await unrelatedSource.manage.push(addOption({ recordedId: 91, sourceVideoFileId: 9001 }));
        await unrelatedSource.manage.push(addOption({ recordedId: 92, sourceVideoFileId: 9002 }));
        await unrelatedSource.settleCurrentChecks();
        expect(unrelatedSource.manage.getEncodeInfo()).toMatchObject({
            runningQueue: [{ id: 1 }, { id: 2 }],
            waitQueue: [],
        });
        unrelatedSource.encoders[0].finish(false, 'unrelated-source-output.mp4');
        await flushEventLoop();
        expect(unrelatedCompleted).toHaveLength(1);
        expect(unrelatedCompleted[0].removeOriginal).toBe(true);
        unrelatedSource.encoders[1].finish(true, null);
        await unrelatedSource.cleanup();
        expectCleanFixture(unrelatedSource);
    });

    it('[EN-SPEC-R6-1-5-7] waits for result registration and preserves its payload and effect order', async () => {
        const fixture = makeFinishFixture();
        const registration = createDeferred<number>();
        fixture.addVideoFile.mockImplementationOnce(info => {
            fixture.calls.push('add:deferred');
            return registration.promise;
        });

        const finishing = fixture.finish(finishInfo({ removeOriginal: true }));
        await Promise.resolve();
        expect(fixture.addVideoFile).toHaveBeenCalledWith({
            recordedId: 41,
            parentDirectoryName: 'synthetic-parent',
            type: 'encoded',
            name: 'synthetic-mode',
            filePath: 'synthetic-output.mp4',
        });
        expect(fixture.calls).toEqual(['add:deferred']);
        expect(fixture.deleteVideoFile).not.toHaveBeenCalled();
        expect(fixture.notifyClient).not.toHaveBeenCalled();
        expect(fixture.emitFinishEncode).not.toHaveBeenCalled();

        registration.resolve(702);
        await finishing;
        expect(fixture.calls).toEqual(['add:deferred', 'delete:43', 'ui', 'complete:41:702:synthetic-mode']);
    });

    it('[EN-SPEC-R6-4-5-6-7] keeps the source and completes with null when result reflection fails', async () => {
        const registrationFailure = new Error('synthetic registration failure');
        const output = makeFinishFixture();
        output.addVideoFile.mockImplementationOnce(async info => {
            output.calls.push(`add:${info.filePath}`);
            throw registrationFailure;
        });

        await output.finish(finishInfo({ removeOriginal: true }));

        expect(output.calls).toEqual(['add:synthetic-output.mp4', 'ui', 'complete:41:null:synthetic-mode']);
        expect(output.deleteVideoFile).not.toHaveBeenCalled();
        expect(output.logError).toHaveBeenCalledWith('finish encode error');
        expect(output.logError).toHaveBeenCalledWith(registrationFailure);

        const sizeFailure = new Error('synthetic size update failure');
        const noOutput = makeFinishFixture();
        noOutput.updateVideoFileSize.mockImplementationOnce(async id => {
            noOutput.calls.push(`size:${id}`);
            throw sizeFailure;
        });

        await noOutput.finish(finishInfo({ filePath: null, fullOutputPath: null, removeOriginal: true }));

        expect(noOutput.calls).toEqual(['size:43', 'ui', 'complete:41:null:synthetic-mode']);
        expect(noOutput.deleteVideoFile).not.toHaveBeenCalled();
        expect(noOutput.logError).toHaveBeenCalledWith('finish encode error');
        expect(noOutput.logError).toHaveBeenCalledWith(sizeFailure);
    });
});

const makeEncoder = (progress: EncodeProgressInfo | null = null): SyntheticEncoder => {
    const encoder: SyntheticEncoder = {
        cancel: vi.fn(async () => undefined),
        finish: (isError, outputFilePath) => {
            const callback = encoder.finishCallback;
            if (callback === null) return;
            encoder.finishCallback = null;
            callback(isError, outputFilePath);
        },
        finishCallback: null,
        getEncodeId: vi.fn(() => encoder.option?.encodeId ?? null),
        getEncodeOption: vi.fn(() => encoder.option),
        getProgressInfo: vi.fn(() => progress),
        option: null,
        setOnFinish: vi.fn(callback => {
            encoder.finishCallback = callback;
        }),
        setOption: vi.fn((option: EncodeOption) => {
            encoder.option = option;
        }),
        start: vi.fn(async () => undefined),
    };
    return encoder;
};

const flushEventLoop = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
};

const ENCODE_ENV_KEYS = [
    'RECORDEDID',
    'INPUT',
    'OUTPUT',
    'DIR',
    'SUBDIR',
    'FFMPEG',
    'FFPROBE',
    'NAME',
    'HALF_WIDTH_NAME',
    'DESCRIPTION',
    'HALF_WIDTH_DESCRIPTION',
    'EXTENDED',
    'HALF_WIDTH_EXTENDED',
    'VIDEOTYPE',
    'VIDEORESOLUTION',
    'VIDEOSTREAMCONTENT',
    'VIDEOCOMPONENTTYPE',
    'AUDIOSAMPLINGRATE',
    'AUDIOCOMPONENTTYPE',
    'CHANNELID',
    'CHANNELNAME',
    'HALF_WIDTH_CHANNELNAME',
    'GENRE1',
    'SUBGENRE1',
    'GENRE2',
    'SUBGENRE2',
    'GENRE3',
    'SUBGENRE3',
    'START_AT',
    'END_AT',
    'DROPLOG_ID',
    'DROPLOG_PATH',
    'ERROR_CNT',
    'DROP_CNT',
    'SCRAMBLING_CNT',
] as const;

const temporaryRoots = new Set<string>();

const makeChild = (withStdout = false, withStderr = false): SyntheticChild => {
    const child = new EventEmitter() as SyntheticChild;
    child.exitCode = null;
    child.pid = 73_001;
    child.signalCode = null;
    child.stderr = withStderr ? new EventEmitter() : null;
    child.stdin = null;
    child.stdout = withStdout ? new EventEmitter() : null;
    return child;
};

const makeRecorded = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    audioComponentType: 0,
    audioSamplingRate: 48_000,
    channelId: 503,
    description: null,
    dropLogFile: {
        dropCnt: 0,
        errorCnt: 7,
        filePath: 'drop-log.json',
        id: 509,
        scramblingCnt: 11,
    },
    duration: 25,
    endAt: 1_900,
    extended: null,
    genre1: 0,
    genre2: null,
    genre3: 15,
    halfWidthDescription: null,
    halfWidthExtended: null,
    halfWidthName: 'half width name',
    id: 501,
    name: 'Synthetic recording',
    startAt: 1_000,
    subGenre1: 1,
    subGenre2: null,
    subGenre3: 0,
    videoComponentType: 179,
    videoResolution: null,
    videoStreamContent: 1,
    videoType: null,
    ...overrides,
});

const makeEncoderFixture = async (
    options: {
        directory?: string;
        createError?: Error;
        encode?: Array<Record<string, unknown>>;
        inputExists?: boolean;
        parentExists?: boolean;
        recorded?: Record<string, unknown> | null;
        video?: Record<string, unknown> | null;
        channel?: Record<string, unknown> | null;
        immediateExitCode?: number;
        progressStream?: boolean;
        stderrStream?: boolean;
        stopResult?: Deferred<{ status: 'requested'; sentSignals: ['SIGINT'] }>;
    } = {},
) => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-contract-'));
    temporaryRoots.add(root);
    const inputPath = join(root, options.inputExists === false ? 'missing-input.ts' : 'input.ts');
    if (options.inputExists !== false) await writeFile(inputPath, 'synthetic input');
    const outputRoot = join(root, 'output');
    const child = makeChild(options.progressStream === true, options.stderrStream === true);
    const startProcess = async () => {
        if (options.createError !== undefined) throw options.createError;
        if (options.immediateExitCode !== undefined) child.exitCode = options.immediateExitCode;
        return child;
    };
    const legacyCreate = vi.fn(startProcess);
    const handle = {} as ManagedProcessHandle;
    const createManaged = vi.fn(async () => ({ child: await startProcess(), handle }));
    const requestStop = vi.fn(() =>
        options.stopResult === undefined
            ? Promise.resolve({ status: 'requested' as const, sentSignals: ['SIGINT'] as ['SIGINT'] })
            : options.stopResult.promise,
    );
    const fileManager = new EncodeFileManageModel();
    const recorded = options.recorded === undefined ? makeRecorded() : options.recorded;
    const channel =
        options.channel === undefined
            ? { halfWidthName: 'half channel', id: 503, name: 'Channel name' }
            : options.channel;
    const config = {
        encode:
            options.encode === undefined
                ? [
                      {
                          cmd: '%NODE% %INPUT% %OUTPUT%',
                          name: 'synthetic-mode',
                          rate: 3,
                          suffix: '.mp4',
                      },
                  ]
                : options.encode,
        ffmpeg: join(root, 'ffmpeg'),
        ffprobe: join(root, 'ffprobe'),
    };
    const log = { encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } };
    const encodeEvent = {
        emitAddEncode: vi.fn(),
        emitCancelEncode: vi.fn(),
        emitErrorEncode: vi.fn(),
        emitFinishEncode: vi.fn(),
        emitUpdateEncodeProgress: vi.fn(),
    };
    const model = new EncoderModel(
        { getLogger: () => log },
        { getConfig: () => config },
        { create: legacyCreate, createManaged, requestStop },
        fileManager,
        { findId: vi.fn(async () => (options.video === undefined ? { id: 502 } : options.video)) },
        { findId: vi.fn(async () => recorded) },
        { findId: vi.fn(async () => channel) },
        {
            getFullFilePathFromId: vi.fn(async () => inputPath),
            getInfo: vi.fn(async () => (options.progressStream === true ? { duration: 25 } : null)),
            getParentDirPath: vi.fn(() => (options.parentExists === false ? null : outputRoot)),
        },
        encodeEvent,
        { formatFilePathString: vi.fn(async (directory: string) => directory) },
    );
    model.setOption({
        encodeId: 701,
        mode: 'synthetic-mode',
        parentDir: 'synthetic-parent',
        recordedId: 501,
        removeOriginal: false,
        sourceVideoFileId: 502,
        ...(options.directory === undefined ? {} : { directory: options.directory }),
    });
    if (options.progressStream === true && child.stdout === null) throw new Error('Progress stream was not created');
    if (options.stderrStream === true && child.stderr === null) throw new Error('Stderr stream was not created');
    return {
        child,
        config,
        create: createManaged,
        createManaged,
        encodeEvent,
        fileManager,
        inputPath,
        handle,
        log,
        model,
        outputRoot,
        root,
        requestStop,
        stderr: child.stderr as EventEmitter,
        stdout: child.stdout as EventEmitter,
    };
};

const finishInfo = (overrides: Partial<FinishEncodeInfo> = {}): FinishEncodeInfo => ({
    filePath: 'synthetic-output.mp4',
    fullOutputPath: 'synthetic-output.mp4',
    mode: 'synthetic-mode',
    parentDirName: 'synthetic-parent',
    recordedId: 41,
    removeOriginal: false,
    videoFileId: 43,
    ...overrides,
});

const makeFinishFixture = () => {
    const calls: string[] = [];
    const logError = vi.fn();
    const encodeEvent = {
        setAddEncode: vi.fn(),
        setCancelEncode: vi.fn(),
        setErrorEncode: vi.fn(),
        setFinishEncode: vi.fn(),
        setUpdateEncodeProgress: vi.fn(),
    };
    const notifyClient = vi.fn(() => calls.push('ui'));
    const emitFinishEncode = vi.fn(async (info: { mode: string; recordedId: number; videoFileId: number | null }) => {
        calls.push(`complete:${info.recordedId}:${String(info.videoFileId)}:${info.mode}`);
    });
    const addVideoFile = vi.fn(async (info: { filePath: string }) => {
        calls.push(`add:${info.filePath}`);
        return 701;
    });
    const deleteVideoFile = vi.fn(async (id: number) => calls.push(`delete:${id}`));
    const updateVideoFileSize = vi.fn(async (id: number) => calls.push(`size:${id}`));
    const model = new EncodeFinishModel(
        { getLogger: () => ({ encode: { error: logError } }) },
        { notifyClient, notifyUpdateEncodeProgress: vi.fn() },
        {
            encodeEvent: {
                emitFinishEncode,
            },
            recorded: {
                addVideoFile,
                deleteVideoFile,
                updateVideoFileSize,
            },
        },
        encodeEvent,
    );
    model.set();
    return {
        addVideoFile,
        calls,
        deleteVideoFile,
        emitFinishEncode,
        finish: (info: FinishEncodeInfo): Promise<void> => model.finishEncode(info),
        logError,
        notifyClient,
        updateVideoFileSize,
    };
};

const settleEncoder = async (fixture: Awaited<ReturnType<typeof makeEncoderFixture>>, code = 0): Promise<void> => {
    fixture.child.exitCode = code;
    fixture.child.emit('exit', code, null);
    await Promise.resolve();
};

const waitForFinish = (model: EncoderRuntime): Promise<{ isError: boolean; output: string | null }> =>
    new Promise(resolve => {
        model.setOnFinish((isError, output) => resolve({ isError, output }));
    });

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all([...temporaryRoots].map(root => rm(root, { force: true, recursive: true })));
    temporaryRoots.clear();
});

const makeManage = (
    concurrentEncodeNum: number,
    ...arguments_:
        | []
        | [unknown]
        | [unknown, RecordedResourceUsePort]
        | [unknown, RecordedResourceUsePort, EncodeFinishSettlementPort]
) => {
    const queueLimit = arguments_[0];
    const recordedResourceUse = arguments_[1] ?? {
        acquire: vi.fn(async () => ({ token: {} })),
        release: vi.fn(async () => undefined),
    };
    const encodeFinish = arguments_[2];
    const checkHandles: QueueCheckHandle[] = [];
    const activeExecutions = new Set<string>();
    let executionCall = 0;
    const execution = {
        getExecution: vi.fn(() => {
            executionCall += 1;
            const executionId = `synthetic-execution-${executionCall}`;
            if (executionCall % 2 === 1) {
                activeExecutions.add(executionId);
                return Promise.resolve(executionId);
            }
            const handle = { executionId, lease: createDeferred<string>(), settled: createDeferred<void>() };
            checkHandles.push(handle);
            return handle.lease.promise.then(() => {
                activeExecutions.add(executionId);
                return executionId;
            });
        }),
        unLockExecution: vi.fn((executionId: string) => {
            activeExecutions.delete(executionId);
            checkHandles.find(handle => handle.executionId === executionId)?.settled.resolve(undefined);
        }),
    };
    const encoders: SyntheticEncoder[] = [];
    const provider = vi.fn(async () => {
        const encoder = makeEncoder();
        encoders.push(encoder);
        return encoder;
    });
    const logger = {
        encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { error: vi.fn() },
    };
    const event = new EncodeEvent({ getLogger: () => logger });
    const config: Record<string, unknown> = { concurrentEncodeNum };
    if (arguments_.length >= 1) config.encodeQueueLimit = queueLimit;
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        { getConfig: () => config },
        execution,
        provider,
        event,
        recordedResourceUse,
        encodeFinish,
    );
    const manageEmitter = (manage as unknown as { listener: EventEmitter }).listener;
    const eventEmitter = (event as unknown as { emitter: EventEmitter }).emitter;

    const settleCurrentChecks = async (): Promise<void> => {
        const pending = checkHandles.filter(handle => handle.lease.state().status === 'pending');
        for (const handle of pending) handle.lease.resolve(handle.executionId);
        await Promise.all(pending.map(handle => handle.settled.promise));
    };
    const resources = () => ({
        activeExecutions: activeExecutions.size,
        finishCallbacks: encoders.filter(encoder => encoder.finishCallback !== null).length,
        pendingChecks: checkHandles.filter(handle => handle.lease.state().status === 'pending').length,
        unsettledChecks: checkHandles.filter(handle => handle.settled.state().status === 'pending').length,
    });
    const cleanup = async (): Promise<void> => {
        for (let attempt = 0; attempt < encoders.length + 4; attempt += 1) {
            await settleCurrentChecks();
            for (const encoder of encoders) encoder.finish(true, null);
            await flushEventLoop();
            const queue = manage.getEncodeInfo();
            if (
                queue.runningQueue.length === 0 &&
                queue.waitQueue.length === 0 &&
                Object.values(resources()).every(count => count === 0)
            ) {
                manageEmitter.removeAllListeners();
                eventEmitter.removeAllListeners();
                return;
            }
        }
        throw new Error(`Encoding fixture cleanup did not settle: ${JSON.stringify(resources())}`);
    };

    const listenerCount = (): number =>
        manageEmitter.eventNames().reduce((total, name) => total + manageEmitter.listenerCount(name), 0) +
        eventEmitter.eventNames().reduce((total, name) => total + eventEmitter.listenerCount(name), 0);

    return {
        checkHandles,
        cleanup,
        config,
        encoders,
        event,
        execution,
        logger,
        listenerCount,
        manage,
        provider,
        recordedResourceUse,
        resources,
        settleCurrentChecks,
    };
};

const expectCleanFixture = (fixture: ReturnType<typeof makeManage>): void => {
    expect(fixture.resources()).toEqual({
        activeExecutions: 0,
        finishCallbacks: 0,
        pendingChecks: 0,
        unsettledChecks: 0,
    });
    expect(fixture.listenerCount()).toBe(0);
};

describe('canonical primary R1-R7 contracts', () => {
    it('[EN-SPEC-R1-1] appends a complete request to the waiting queue', async () => {
        const fixture = makeManage(1);
        const request = addOption({ recordedId: 101 });

        await expect(fixture.manage.push(request)).resolves.toBe(1);
        expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([{ id: 1, mode: request.mode, recordedId: 101 }]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-3] returns the first positive in-memory identifier', async () => {
        const fixture = makeManage(1);

        await expect(fixture.manage.push(addOption())).resolves.toBe(1);
        expect(fixture.manage.getEncodeInfo().waitQueue.map(item => item.id)).toEqual([1]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-5] notifies exactly once after accepting a request', async () => {
        const fixture = makeManage(1);
        const added: number[] = [];
        fixture.event.setAddEncode(id => added.push(id));

        await fixture.manage.push(addOption());
        expect(added).toEqual([1]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-6] uses the omitted queue-limit default and releases fixture listeners', () => {
        const fixture = makeManage(1);

        expect(fixture.manage.encodeQueueLimit).toBe(1024);
        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-8] keeps the pending admission plus waiting queue within the limit', async () => {
        const fixture = makeManage(1, 1);
        const accepted = fixture.manage.push(addOption({ recordedId: 108 }));

        await expect(fixture.manage.push(addOption({ recordedId: 109 }))).rejects.toThrow('EncodeQueueIsFull');
        await expect(accepted).resolves.toBe(1);
        expect(fixture.manage.getEncodeInfo().waitQueue).toHaveLength(1);
        expect(
            fixture.manage.admissionReservations + fixture.manage.getEncodeInfo().waitQueue.length,
        ).toBeLessThanOrEqual(1);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-9] rejects only the full-queue request before creating another job or notification', async () => {
        const fixture = makeManage(1, 1);
        const added: number[] = [];
        fixture.event.setAddEncode(id => added.push(id));

        await fixture.manage.push(addOption({ recordedId: 109 }));
        await expect(fixture.manage.push(addOption({ recordedId: 110 }))).rejects.toThrow('EncodeQueueIsFull');
        expect(fixture.provider).toHaveBeenCalledOnce();
        expect(added).toEqual([1]);
        expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([{ id: 1, mode: 'synthetic-mode', recordedId: 109 }]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-10] retains the startup queue-limit snapshot until a new instance starts', () => {
        const fixture = makeManage(1, 1);
        fixture.config.encodeQueueLimit = 2;
        const restarted = makeManage(1, fixture.config.encodeQueueLimit);

        expect(fixture.manage.encodeQueueLimit).toBe(1);
        expect(restarted.manage.encodeQueueLimit).toBe(2);
        for (const current of [fixture, restarted]) {
            (current.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (current.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
            expectCleanFixture(current);
        }
    });

    it('[EN-SPEC-R2-1] starts waiting requests in FIFO order', async () => {
        const fixture = makeManage(1, 4);
        const starts: number[] = [];
        await fixture.manage.push(addOption({ recordedId: 201 }));
        await fixture.manage.push(addOption({ recordedId: 202 }));
        fixture.encoders.forEach(encoder =>
            encoder.start.mockImplementation(async () => starts.push(encoder.option!.encodeId)),
        );

        await fixture.settleCurrentChecks();
        expect(fixture.manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 1 }], waitQueue: [{ id: 2 }] });
        fixture.encoders[0].finish(false, null);
        await flushEventLoop();
        await fixture.settleCurrentChecks();
        expect(starts).toEqual([1, 2]);

        fixture.encoders[1].finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-2] never starts more encoders than the local concurrency limit', async () => {
        const fixture = makeManage(1, 4);
        await fixture.manage.push(addOption({ recordedId: 211 }));
        await fixture.manage.push(addOption({ recordedId: 212 }));

        await fixture.settleCurrentChecks();
        expect(fixture.encoders[0].start).toHaveBeenCalledOnce();
        expect(fixture.encoders[1].start).not.toHaveBeenCalled();
        expect(fixture.manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 1 }], waitQueue: [{ id: 2 }] });

        fixture.encoders[0].finish(false, null);
        fixture.encoders[1].finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-4] reports a failed start without requeueing the request', async () => {
        const fixture = makeManage(1, 4);
        const errors: number[] = [];
        fixture.event.setErrorEncode(() => errors.push(1));
        await fixture.manage.push(addOption({ recordedId: 241 }));
        fixture.encoders[0].start.mockRejectedValueOnce(new Error('SyntheticSharedSlotRefusal'));

        await fixture.settleCurrentChecks();
        await flushEventLoop();
        expect(errors).toEqual([1]);
        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-5] checks the next queued request after a running request completes', async () => {
        const fixture = makeManage(1, 4);
        await fixture.manage.push(addOption({ recordedId: 251 }));
        await fixture.manage.push(addOption({ recordedId: 252 }));

        await fixture.settleCurrentChecks();
        fixture.encoders[0].finish(false, null);
        await flushEventLoop();
        await fixture.settleCurrentChecks();
        expect(fixture.encoders[1].start).toHaveBeenCalledOnce();
        expect(fixture.manage.getEncodeInfo()).toMatchObject({ runningQueue: [{ id: 2 }], waitQueue: [] });

        fixture.encoders[1].finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-6] keeps waiting and running requests process-local', async () => {
        const previous = makeManage(1);
        const restarted = makeManage(1);

        await previous.manage.push(addOption({ recordedId: 261 }));
        expect(previous.manage.getEncodeInfo().waitQueue).toHaveLength(1);
        expect(restarted.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await previous.cleanup();
        await restarted.cleanup();
        expectCleanFixture(previous);
        expectCleanFixture(restarted);
    });

    it('[EN-SPEC-R3-1] rejects missing input before requesting a process', async () => {
        const fixture = await makeEncoderFixture({ inputExists: false });

        await expect(fixture.model.start()).rejects.toBeInstanceOf(Error);
        expect(fixture.create).not.toHaveBeenCalled();
        expect(fixture.model.childProcess).toBeNull();
    });

    it('[EN-SPEC-R3-3] derives the deadline from recording duration and an explicit rate', async () => {
        vi.useFakeTimers();
        const fixture = await makeEncoderFixture({ encode: [{ cmd: '%NODE%', name: 'synthetic-mode', rate: 3 }] });
        const cancel = vi.spyOn(fixture.model, 'cancel').mockResolvedValue(undefined);

        await fixture.model.start();
        await vi.advanceTimersByTimeAsync(74);
        expect(cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(cancel).toHaveBeenCalledOnce();

        await settleEncoder(fixture, 1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EN-SPEC-R3-4] uses the default deadline multiplier when the encoding mode omits it', async () => {
        vi.useFakeTimers();
        const fixture = await makeEncoderFixture({ encode: [{ cmd: '%NODE%', name: 'synthetic-mode' }] });
        const cancel = vi.spyOn(fixture.model, 'cancel').mockResolvedValue(undefined);

        await fixture.model.start();
        await vi.advanceTimersByTimeAsync(99);
        expect(cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(cancel).toHaveBeenCalledOnce();

        await settleEncoder(fixture, 1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EN-SPEC-R3-5] requests managed cancellation when the deadline expires', async () => {
        vi.useFakeTimers();
        const fixture = await makeEncoderFixture({ encode: [{ cmd: '%NODE%', name: 'synthetic-mode', rate: 3 }] });

        await fixture.model.start();
        await vi.advanceTimersByTimeAsync(75);
        expect(fixture.requestStop).toHaveBeenCalledOnce();

        await settleEncoder(fixture, 1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('[EN-SPEC-R3-6] removes a start failure from the running queue', async () => {
        const fixture = makeManage(1, 4);
        await fixture.manage.push(addOption({ recordedId: 361 }));
        fixture.encoders[0].start.mockRejectedValueOnce(new Error('SyntheticStartFailure'));

        await fixture.settleCurrentChecks();
        await flushEventLoop();
        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R3-8] overlays the parent environment on the process-port request', async () => {
        const marker = 'EPGSTATION_CANONICAL_PARENT';
        const previous = process.env[marker];
        process.env[marker] = 'inherited';
        try {
            const fixture = await makeEncoderFixture();
            await fixture.model.start();
            const request = fixture.create.mock.calls[0][0] as { spawnOption: { env: Record<string, string> } };
            expect(fixture.create).toHaveBeenCalledOnce();
            expect(request.spawnOption.env[marker]).toBe('inherited');

            await settleEncoder(fixture);
            expect(fixture.fileManager.usedFileNameIndex).toEqual({});
        } finally {
            if (previous === undefined) delete process.env[marker];
            else process.env[marker] = previous;
        }
    });

    it('[EN-SPEC-R3-9] passes missing optional values as empty strings without renaming CHANNELNAME', async () => {
        const fixture = await makeEncoderFixture();
        await fixture.model.start();
        const request = fixture.create.mock.calls[0][0] as { spawnOption: { env: Record<string, string> } };

        expect(request.spawnOption.env.DESCRIPTION).toBe('');
        expect(request.spawnOption.env.CHANNELNAME).toBe('Channel name');
        expect(request.spawnOption.env.CHANNEL_NAME).toBeUndefined();

        await settleEncoder(fixture);
        expect(fixture.fileManager.usedFileNameIndex).toEqual({});
    });

    it('[EN-SPEC-R4-1] returns separate empty running and waiting public arrays', async () => {
        const recordedDB = { findIds: vi.fn() };
        const api = new EncodeApiModel({ getEncodeInfo: () => ({ runningQueue: [], waitQueue: [] }) }, {}, recordedDB, {
            convertRecordedToRecordedItem: vi.fn(),
        });

        await expect(api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });
        expect(recordedDB.findIds).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R4-2] exposes each request identifier, mode, and recorded program', async () => {
        const recordedDB = { findIds: vi.fn(async () => [{ id: 421 }]) };
        const api = new EncodeApiModel(
            { getEncodeInfo: () => ({ runningQueue: [{ id: 1, mode: 'running', recordedId: 421 }], waitQueue: [] }) },
            {},
            recordedDB,
            { convertRecordedToRecordedItem: vi.fn(recorded => recorded) },
        );

        await expect(api.getAll(false)).resolves.toEqual({
            runningItems: [{ id: 1, mode: 'running', recorded: { id: 421 } }],
            waitItems: [],
        });
        expect(recordedDB.findIds).toHaveBeenCalledWith([421]);
    });

    it('[EN-SPEC-R4-3] reflects a received progress record on the running encoder', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        fixture.stdout.emit('data', `${JSON.stringify({ type: 'progress', percent: 43, log: 'working' })}\n`);

        expect(fixture.model.getProgressInfo()).toEqual({ percent: 43, log: 'working' });
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-4] emits one progress notification after reflecting a progress record', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        fixture.stdout.emit('data', `${JSON.stringify({ type: 'progress', percent: 44, log: 'notified' })}\n`);

        expect(fixture.encodeEvent.emitUpdateEncodeProgress).toHaveBeenCalledOnce();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R4-5] leaves progress unset when no valid progress record is received', async () => {
        const fixture = await makeEncoderFixture({ progressStream: true });
        await fixture.model.start();
        fixture.stdout.emit('data', 'not-json\n');

        expect(fixture.model.getProgressInfo()).toBeNull();
        expect(fixture.encodeEvent.emitUpdateEncodeProgress).not.toHaveBeenCalled();
        await settleEncoder(fixture);
    });

    it('[EN-SPEC-R5-1] removes a waiting request without starting its encoder', async () => {
        const fixture = makeManage(1, 4);
        const waiting = makeEncoder();
        waiting.setOption({ ...addOption({ recordedId: 511 }), encodeId: 1 });
        fixture.manage.waitQueue = [waiting];

        await fixture.manage.cancel(1);
        expect(waiting.start).not.toHaveBeenCalled();
        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R5-2] sends a running encoder cancellation through its managed process port', async () => {
        const fixture = await makeEncoderFixture();
        await fixture.model.start();

        await fixture.model.cancel();
        expect(fixture.requestStop).toHaveBeenCalledOnce();

        await settleEncoder(fixture, 1);
        expect(fixture.model.childProcess).toBeNull();
    });

    it('[EN-SPEC-R5-3] cancels all matching recorded-program requests while retaining other requests', async () => {
        const fixture = makeManage(1, 4);
        const running = makeEncoder();
        const matching = makeEncoder();
        const unrelated = makeEncoder();
        running.setOption({ ...addOption({ recordedId: 531 }), encodeId: 1 });
        matching.setOption({ ...addOption({ recordedId: 531 }), encodeId: 2 });
        unrelated.setOption({ ...addOption({ recordedId: 532 }), encodeId: 3 });
        fixture.manage.runningQueue = [running];
        fixture.manage.waitQueue = [matching, unrelated];
        fixture.execution.getExecution.mockResolvedValue('synthetic-cancel');
        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();

        await fixture.manage.cancelEncodeByRecordedId(531);
        expect(running.cancel).toHaveBeenCalledOnce();
        expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([{ id: 3, mode: 'synthetic-mode', recordedId: 532 }]);

        fixture.manage.runningQueue = [];
        fixture.manage.waitQueue = [];
        (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R5-4] notifies the accepted cancellation identifier', async () => {
        const fixture = makeManage(1, 4);
        const waiting = makeEncoder();
        const cancelled: number[] = [];
        waiting.setOption({ ...addOption({ recordedId: 541 }), encodeId: 1 });
        fixture.manage.waitQueue = [waiting];
        fixture.event.setCancelEncode(id => cancelled.push(id));

        await fixture.manage.cancel(1);
        expect(cancelled).toEqual([1]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R6-1] requests output-file registration after a successful result', async () => {
        const fixture = makeFinishFixture();

        await fixture.finish(finishInfo());
        expect(fixture.addVideoFile).toHaveBeenCalledOnce();
        expect(fixture.calls).toContain('add:synthetic-output.mp4');
    });

    it('[EN-SPEC-R6-2] requests source-size update when the successful result has no output', async () => {
        const fixture = makeFinishFixture();

        await fixture.finish(finishInfo({ filePath: null, fullOutputPath: null }));
        expect(fixture.updateVideoFileSize).toHaveBeenCalledExactlyOnceWith(43);
    });

    it('[EN-SPEC-R6-3] suppresses original-file removal while a sibling shares the source', async () => {
        const fixture = makeManage(2, 4);
        const finished: FinishEncodeInfo[] = [];
        fixture.event.setFinishEncode(info => finished.push(info));
        await fixture.manage.push(addOption({ recordedId: 631, sourceVideoFileId: 6301 }));
        await fixture.manage.push(addOption({ recordedId: 632, sourceVideoFileId: 6301 }));
        await fixture.settleCurrentChecks();
        fixture.encoders[0].finish(false, 'shared-source.mp4');
        await flushEventLoop();

        expect(finished[0].removeOriginal).toBe(false);
        fixture.encoders[1].finish(true, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R6-4] keeps the original when output registration fails', async () => {
        const fixture = makeFinishFixture();
        const failure = new Error('SyntheticRegistrationFailure');
        fixture.addVideoFile.mockRejectedValueOnce(failure);

        await fixture.finish(finishInfo({ removeOriginal: true }));
        expect(fixture.deleteVideoFile).not.toHaveBeenCalled();
        expect(fixture.logError).toHaveBeenCalledWith(failure);
    });

    it('[EN-SPEC-R6-5] deletes the original only after successful result reflection', async () => {
        const fixture = makeFinishFixture();

        await fixture.finish(finishInfo({ removeOriginal: true }));
        expect(fixture.addVideoFile).toHaveBeenCalledOnce();
        expect(fixture.deleteVideoFile).toHaveBeenCalledExactlyOnceWith(43, true);
        expect(fixture.calls).toEqual([
            'add:synthetic-output.mp4',
            'delete:43',
            'ui',
            'complete:41:701:synthetic-mode',
        ]);
    });

    it('[EN-SPEC-R6-6] notifies completion with no video ID after a reflection failure', async () => {
        const fixture = makeFinishFixture();
        fixture.updateVideoFileSize.mockRejectedValueOnce(new Error('SyntheticSizeFailure'));

        await fixture.finish(finishInfo({ filePath: null, fullOutputPath: null, removeOriginal: true }));
        expect(fixture.notifyClient).toHaveBeenCalledOnce();
        expect(fixture.emitFinishEncode).toHaveBeenCalledWith({
            recordedId: 41,
            videoFileId: null,
            mode: 'synthetic-mode',
        });
    });

    it('[EN-SPEC-R6-7] notifies the client and completion event after a successful retained source', async () => {
        const fixture = makeFinishFixture();

        await fixture.finish(finishInfo({ removeOriginal: false }));
        expect(fixture.notifyClient).toHaveBeenCalledOnce();
        expect(fixture.emitFinishEncode).toHaveBeenCalledWith({
            recordedId: 41,
            videoFileId: 701,
            mode: 'synthetic-mode',
        });
    });

    it('[EN-SPEC-R7-1] removes only an abnormal owned partial output', async () => {
        vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const fixture = await makeEncoderFixture();
        await fixture.model.start();
        const output = (fixture.create.mock.calls[0][0] as { output: string }).output;
        await writeFile(output, 'partial output');

        fixture.child.emit('exit', 1, null);
        await expect.poll(
            async () => ({
                outputPresent: await access(output).then(() => true, () => false),
                index: fixture.fileManager.usedFileNameIndex,
            }),
            { timeout: 2000, interval: 10 },
        ).toEqual({ outputPresent: false, index: {} });
    });

    it('[EN-SPEC-R7-2] does not restore an earlier instance waiting queue', async () => {
        const previous = makeManage(1);
        const restarted = makeManage(1);

        await previous.manage.push(addOption({ recordedId: 721 }));
        expect(previous.manage.getEncodeInfo().waitQueue).toHaveLength(1);
        expect(restarted.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await previous.cleanup();
        await restarted.cleanup();
        expectCleanFixture(previous);
        expectCleanFixture(restarted);
    });

    it('[EN-SPEC-R7-3] assigns identifier one after a new instance starts', async () => {
        const fixture = makeManage(1);

        await expect(fixture.manage.push(addOption())).resolves.toBe(1);
        expect(fixture.manage.getEncodeInfo().waitQueue[0].id).toBe(1);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R7-4] wraps the next identifier to one after the safe-integer maximum', async () => {
        const fixture = makeManage(1, 4);
        fixture.manage.idCnt = Number.MAX_SAFE_INTEGER;

        await expect(fixture.manage.push(addOption({ recordedId: 741 }))).resolves.toBe(Number.MAX_SAFE_INTEGER);
        await expect(fixture.manage.push(addOption({ recordedId: 742 }))).resolves.toBe(1);
        expect(fixture.manage.getEncodeInfo().waitQueue.map(item => item.id)).toEqual([Number.MAX_SAFE_INTEGER, 1]);

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R7-5] leaves a prior partial output untouched when a new manager starts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'epgstation-encoding-restart-output-'));
        temporaryRoots.add(root);
        const staleOutput = join(root, 'partial-output.mp4');
        await writeFile(staleOutput, 'prior partial output');
        const fixture = makeManage(1);

        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        await expect(access(staleOutput)).resolves.toBeUndefined();

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });
});

describe('encoding request and public data contracts', () => {
    it('[EN-SPEC-R1-6-7] snapshots the omitted default and every valid queue limit at construction', () => {
        const omitted = makeManage(1);
        expect(omitted.manage.encodeQueueLimit).toBe(1024);

        const validValues = [1, 1024, Number.MAX_SAFE_INTEGER];
        const explicit = validValues.map(value => makeManage(1, value));
        expect(explicit.map(fixture => fixture.manage.encodeQueueLimit)).toEqual(validValues);

        for (const fixture of [omitted, ...explicit]) {
            (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
            (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-R1-7] rejects invalid queue values before any queue or provider side effects', () => {
        const logger = { encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }, system: { error: vi.fn() } };
        const execution = { getExecution: vi.fn(), unLockExecution: vi.fn() };
        const provider = vi.fn();
        const event = new EncodeEvent({ getLogger: () => logger });

        try {
            for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
                expect(
                    () =>
                        new EncodeManageModel(
                            { getLogger: () => logger },
                            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: value }) },
                            execution,
                            provider,
                            event,
                        ),
                ).toThrow('InvalidEncodeQueueLimit');
            }

            expect(execution.getExecution).not.toHaveBeenCalled();
            expect(provider).not.toHaveBeenCalled();
        } finally {
            (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        }
    });

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['fraction', 1.5],
        ['NaN', Number.NaN],
        ['positive infinity', Number.POSITIVE_INFINITY],
        ['negative infinity', Number.NEGATIVE_INFINITY],
        ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
        ['string', '1'],
        ['null', null],
        ['explicit undefined', undefined],
    ])('[EN-COMPOSITE-R1-7] rejects an invalid %s queue limit during construction', (_name, value) => {
        expect(() => makeManage(1, value)).toThrow();
    });

    it('[EN-SPEC-R1-8-10] reserves admission synchronously, rejects limit+1 without side effects, and keeps its snapshot', async () => {
        const fixture = makeManage(1, 1);
        const added: apid.EncodeId[] = [];
        fixture.event.setAddEncode(id => added.push(id));

        const accepted = fixture.manage.push(addOption({ recordedId: 101 }));
        const rejected = fixture.manage.push(addOption({ recordedId: 102 }));

        expect(fixture.manage.admissionReservations).toBe(1);
        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        expect(fixture.execution.getExecution).toHaveBeenCalledOnce();
        expect(fixture.provider).not.toHaveBeenCalled();
        expect(fixture.manage.idCnt).toBe(1);
        expect(added).toEqual([]);
        await expect(rejected).rejects.toBeInstanceOf(Error);

        await expect(accepted).resolves.toBe(1);
        expect(fixture.manage.admissionReservations).toBe(0);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 101 }],
        });
        expect(fixture.provider).toHaveBeenCalledOnce();
        expect(fixture.manage.idCnt).toBe(2);
        expect(added).toEqual([1]);
        expect(
            fixture.manage.admissionReservations + fixture.manage.getEncodeInfo().waitQueue.length,
        ).toBeLessThanOrEqual(1);

        const callsAtWaitLimit = {
            execution: fixture.execution.getExecution.mock.calls.length,
            provider: fixture.provider.mock.calls.length,
        };
        await expect(fixture.manage.push(addOption({ recordedId: 103 }))).rejects.toBeInstanceOf(Error);
        expect(fixture.execution.getExecution).toHaveBeenCalledTimes(callsAtWaitLimit.execution);
        expect(fixture.provider).toHaveBeenCalledTimes(callsAtWaitLimit.provider);
        expect(fixture.manage.admissionReservations).toBe(0);
        expect(fixture.manage.idCnt).toBe(2);
        expect(added).toEqual([1]);
        expect(fixture.manage.getEncodeInfo().waitQueue).toEqual([{ id: 1, mode: 'synthetic-mode', recordedId: 101 }]);

        fixture.config.encodeQueueLimit = 2;
        expect(fixture.manage.encodeQueueLimit).toBe(1);
        const restarted = makeManage(1, fixture.config.encodeQueueLimit);
        expect(restarted.manage.encodeQueueLimit).toBe(2);

        await fixture.cleanup();
        (restarted.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (restarted.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
        expectCleanFixture(restarted);
    });

    it('[EN-COMPOSITE-R1-8] excludes running jobs from the admission limit', async () => {
        const fixture = makeManage(1, 1);
        const running = makeEncoder();
        running.setOption({ ...addOption({ recordedId: 111 }), encodeId: 77 });
        fixture.manage.runningQueue = [running];

        await expect(fixture.manage.push(addOption({ recordedId: 112 }))).resolves.toBe(1);

        expect(fixture.manage.admissionReservations).toBe(0);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 77, mode: 'synthetic-mode', recordedId: 111 }],
            waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 112 }],
        });
        fixture.manage.runningQueue = [];
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-1-5] accepts one complete request, assigns a positive ID, and announces it once', async () => {
        const fixture = makeManage(1);
        const request = addOption();
        const added: apid.EncodeId[] = [];
        const finished: FinishEncodeInfo[] = [];
        const addListener = vi.fn((id: apid.EncodeId) => added.push(id));
        fixture.event.setAddEncode(addListener);
        fixture.event.setFinishEncode(info => finished.push(info));

        await expect(fixture.manage.push(request)).resolves.toBe(1);

        expect(fixture.provider).toHaveBeenCalledOnce();
        expect(fixture.encoders[0].setOption).toHaveBeenCalledOnce();
        expect(fixture.encoders[0].option).toEqual({ ...request, encodeId: 1 });
        expect(fixture.encoders[0].option).not.toBe(request);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: request.mode, recordedId: request.recordedId }],
        });
        expect(added).toEqual([1]);
        expect(fixture.checkHandles).toHaveLength(1);
        expect(addListener.mock.invocationCallOrder[0]).toBeLessThan(
            fixture.execution.getExecution.mock.invocationCallOrder[1],
        );

        await fixture.settleCurrentChecks();
        fixture.encoders[0].finish(false, 'synthetic-output.ts');
        expect(finished).toHaveLength(1);
        expect(Object.keys(finished[0]).sort()).toEqual([
            'filePath',
            'fullOutputPath',
            'mode',
            'parentDirName',
            'recordedId',
            'removeOriginal',
            'videoFileId',
        ]);
        expect(finished[0]).not.toHaveProperty('encodeQueueLimit');

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-2] preserves a false remove-original choice in the queued request', async () => {
        const fixture = makeManage(1);
        const request = addOption({ removeOriginal: false });

        await expect(fixture.manage.push(request)).resolves.toBe(1);

        expect(fixture.encoders[0].option).toEqual({ ...request, encodeId: 1 });
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 1, mode: request.mode, recordedId: request.recordedId }],
        });

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R1-4] rejects disabled encoding before execution, provider, ID, queue, and event side effects', async () => {
        for (const concurrentEncodeNum of [0, -1]) {
            const fixture = makeManage(concurrentEncodeNum);
            const added = vi.fn();
            fixture.event.setAddEncode(added);

            await expect(fixture.manage.push(addOption())).rejects.toBeInstanceOf(Error);

            expect(fixture.execution.getExecution).not.toHaveBeenCalled();
            expect(fixture.execution.unLockExecution).not.toHaveBeenCalled();
            expect(fixture.provider).not.toHaveBeenCalled();
            expect(added).not.toHaveBeenCalled();
            expect(fixture.manage.idCnt).toBe(1);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-R4-1-2] returns two empty public arrays without querying recorded content', async () => {
        const recordedDB = { findIds: vi.fn() };
        const api = new EncodeApiModel({ getEncodeInfo: () => ({ runningQueue: [], waitQueue: [] }) }, {}, recordedDB, {
            convertRecordedToRecordedItem: vi.fn(),
        });

        await expect(api.getAll(false)).resolves.toEqual({ runningItems: [], waitItems: [] });
        expect(recordedDB.findIds).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R4-1-3] joins unique recorded IDs once, preserves queue separation, and omits missing records', async () => {
        const recordedDB = { findIds: vi.fn(async () => [{ id: 41 }]) };
        const convert = vi.fn((recorded: { id: number }, isHalfWidth: boolean) => ({
            id: recorded.id,
            syntheticHalfWidth: isHalfWidth,
        }));
        const api = new EncodeApiModel(
            {
                getEncodeInfo: () => ({
                    runningQueue: [{ id: 1, mode: 'running-mode', recordedId: 41, percent: 37, log: 'progress' }],
                    waitQueue: [
                        { id: 2, mode: 'waiting-mode', recordedId: 41 },
                        { id: 3, mode: 'missing-mode', recordedId: 404 },
                    ],
                }),
            },
            {},
            recordedDB,
            { convertRecordedToRecordedItem: convert },
        );

        const result = await api.getAll(true);
        expect(result).toEqual({
            runningItems: [
                {
                    id: 1,
                    log: 'progress',
                    mode: 'running-mode',
                    percent: 37,
                    recorded: { id: 41, syntheticHalfWidth: true },
                },
            ],
            waitItems: [{ id: 2, mode: 'waiting-mode', recorded: { id: 41, syntheticHalfWidth: true } }],
        });
        expect(Object.keys(result).sort()).toEqual(['runningItems', 'waitItems']);
        expect(Object.keys(result.runningItems[0]).sort()).toEqual(['id', 'log', 'mode', 'percent', 'recorded']);
        expect(Object.keys(result.waitItems[0]).sort()).toEqual(['id', 'mode', 'recorded']);
        expect(recordedDB.findIds).toHaveBeenCalledOnce();
        expect(recordedDB.findIds).toHaveBeenCalledWith([41, 404]);
        expect(convert).toHaveBeenCalledTimes(2);
    });

    it('[EN-SPEC-R1-11] keeps the internal queue limit out of runtime API, event, public config, and IPC payloads', async () => {
        const request = addOption();
        const fixture = makeManage(1);
        const cancelled: apid.EncodeId[] = [];
        fixture.event.setCancelEncode(id => cancelled.push(id));
        const encodeId = await fixture.manage.push(request);
        await fixture.manage.cancel(encodeId);
        expect(cancelled).toEqual([1]);

        const publicConfig = new ConfigApiModel(
            {
                getConfig: () => ({
                    clientSocketioPort: 45_001,
                    encode: [{ name: 'synthetic-mode' }],
                    encodeQueueLimit: 73,
                    recorded: [{ name: 'synthetic-parent' }],
                    urlscheme: {
                        download: { android: '', ios: '', mac: '', win: '' },
                        m2ts: { android: '', ios: '', mac: '', win: '' },
                        video: { android: '', ios: '', mac: '', win: '' },
                    },
                }),
            },
            { reserveation: { getBroadcastStatus: vi.fn(async () => ({})) } },
        );
        const configResult = await publicConfig.getConfig(false);
        expect(configResult).not.toHaveProperty('encodeQueueLimit');

        const child = Object.assign(new EventEmitter(), { send: vi.fn() });
        const ipcServer = new IPCServer({}, {}, {}, {}, {}, {}, {});
        ipcServer.register(child);
        ipcServer.setEncode(request);
        const ipcPayload = child.send.mock.calls[0][0] as { type: string; value: apid.AddEncodeProgramOption };
        expect(Object.keys(ipcPayload).sort()).toEqual(['type', 'value']);
        expect(Object.keys(ipcPayload.value).sort()).toEqual([
            'directory',
            'mode',
            'parentDir',
            'recordedId',
            'removeOriginal',
            'sourceVideoFileId',
        ]);
        expect(ipcPayload).not.toHaveProperty('encodeQueueLimit');
        expect(ipcPayload.value).not.toHaveProperty('encodeQueueLimit');
        child.removeAllListeners();

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R5-1-4] cancels a waiting request without starting a process and announces it once', async () => {
        const fixture = makeManage(1, 4);
        const cancelled: apid.EncodeId[] = [];
        fixture.event.setCancelEncode(id => cancelled.push(id));
        const target = makeEncoder();
        const sibling = makeEncoder();
        target.setOption({ ...addOption({ recordedId: 211 }), encodeId: 41 });
        sibling.setOption({ ...addOption({ recordedId: 212 }), encodeId: 42 });
        fixture.manage.waitQueue = [target, sibling];
        expect(fixture.resources().pendingChecks).toBe(0);

        await fixture.manage.cancel(41);
        await flushEventLoop();

        expect(target.start).not.toHaveBeenCalled();
        expect(target.cancel).not.toHaveBeenCalled();
        expect(sibling.start).not.toHaveBeenCalled();
        expect(sibling.cancel).not.toHaveBeenCalled();
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 42, mode: 'synthetic-mode', recordedId: 212 }],
        });
        expect(cancelled).toEqual([41]);
        expect(fixture.resources().pendingChecks).toBe(1);

        const [queueCheck] = fixture.checkHandles;
        queueCheck.lease.resolve(queueCheck.executionId);
        await queueCheck.settled.promise;

        expect(target.start).not.toHaveBeenCalled();
        expect(target.cancel).not.toHaveBeenCalled();
        expect(sibling.start).toHaveBeenCalledOnce();
        expect(sibling.cancel).not.toHaveBeenCalled();
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 42, mode: 'synthetic-mode', recordedId: 212 }],
            waitQueue: [],
        });

        sibling.finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R5-3-4] attempts every recorded-program cancellation before reporting one failure', async () => {
        const logger = {
            encode: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
            system: { error: vi.fn() },
        };
        const event = new EncodeEvent({ getLogger: () => logger });
        const execution = {
            getExecution: vi.fn(async () => `cancel-execution-${execution.getExecution.mock.calls.length}`),
            unLockExecution: vi.fn(),
        };
        const manage = new EncodeManageModel(
            { getLogger: () => logger },
            { getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 4 }) },
            execution,
            vi.fn(),
            event,
        );
        const failed = makeEncoder();
        const running = makeEncoder();
        const waiting = makeEncoder();
        failed.setOption({ ...addOption({ recordedId: 221 }), encodeId: 71 });
        running.setOption({ ...addOption({ recordedId: 221 }), encodeId: 72 });
        waiting.setOption({ ...addOption({ recordedId: 221 }), encodeId: 73 });
        failed.cancel.mockRejectedValueOnce(new Error('synthetic stop rejection'));
        manage.runningQueue = [failed, running];
        manage.waitQueue = [waiting];
        const cancelled: apid.EncodeId[] = [];
        event.setCancelEncode(id => cancelled.push(id));

        await expect(manage.cancelEncodeByRecordedId(221)).rejects.toThrow('StopEncodeError');
        expect(failed.cancel).toHaveBeenCalledOnce();
        expect(running.cancel).toHaveBeenCalledOnce();
        expect(waiting.cancel).not.toHaveBeenCalled();
        expect(manage.getEncodeInfo()).toMatchObject({
            runningQueue: [{ id: 71 }, { id: 72 }],
            waitQueue: [],
        });
        expect(cancelled).toEqual([73, 71, 72]);
        expect(execution.unLockExecution).toHaveBeenCalledTimes(3);
        (manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
    });

    it('[EN-SPEC-R7-2-3-4-5] keeps queues process-local, restarts IDs, wraps safely, and leaves prior output untouched', async () => {
        const staleRoot = await mkdtemp(join(tmpdir(), 'epgstation-encoding-stale-output-'));
        temporaryRoots.add(staleRoot);
        const staleOutput = join(staleRoot, 'partial-output.mp4');
        await writeFile(staleOutput, 'stale output');
        const previous = makeManage(1);
        const restarted = makeManage(1);
        const wrapping = makeManage(1);

        try {
            await expect(previous.manage.push(addOption({ recordedId: 301 }))).resolves.toBe(1);
            expect(previous.manage.getEncodeInfo().waitQueue).toEqual([
                { id: 1, mode: 'synthetic-mode', recordedId: 301 },
            ]);
            expect(restarted.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            await expect(access(staleOutput)).resolves.toBeUndefined();

            await expect(restarted.manage.push(addOption({ recordedId: 302 }))).resolves.toBe(1);
            expect(restarted.manage.getEncodeInfo().waitQueue).toEqual([
                { id: 1, mode: 'synthetic-mode', recordedId: 302 },
            ]);

            wrapping.manage.idCnt = Number.MAX_SAFE_INTEGER;
            await expect(wrapping.manage.push(addOption({ recordedId: 303 }))).resolves.toBe(Number.MAX_SAFE_INTEGER);
            await expect(wrapping.manage.push(addOption({ recordedId: 304 }))).resolves.toBe(1);
            expect(wrapping.manage.getEncodeInfo().waitQueue.map(item => item.id)).toEqual([
                Number.MAX_SAFE_INTEGER,
                1,
            ]);
        } finally {
            await previous.cleanup();
            await restarted.cleanup();
            await wrapping.cleanup();
            expectCleanFixture(previous);
            expectCleanFixture(restarted);
            expectCleanFixture(wrapping);
        }
    });
});

describe('recorded-use lease admission contract', () => {
    it('[EN-SPEC-RECORDED-USE-INPUT-SNAPSHOT] keeps the lease request and queued job on the pre-await recorded ID', async () => {
        const acquired = createDeferred<{ token: object }>();
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(() => acquired.promise),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        const input = addOption({ recordedId: 909 });
        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();

        try {
            const pushing = fixture.manage.push(input);
            await Promise.resolve();
            input.recordedId = 910;
            acquired.resolve({ token: {} });

            await expect(pushing).resolves.toBe(1);
            expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(909, 'encoding');
            expect(fixture.manage.getEncodeInfo()).toEqual({
                runningQueue: [],
                waitQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 909 }],
            });

            const cancelling = fixture.manage.cancel(1);
            await Promise.resolve();
            await fixture.settleCurrentChecks();
            await cancelling;
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-RECORDED-USE-ACQUIRE] acquires one encoding lease before making a job or queue visible', async () => {
        const acquired = createDeferred<{ token: object }>();
        const token = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(() => acquired.promise),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        const added: number[] = [];
        fixture.event.setAddEncode(id => added.push(id));

        try {
            const pushing = fixture.manage.push(addOption({ recordedId: 904 }));
            await Promise.resolve();

            expect(recordedResourceUse.acquire).toHaveBeenCalledOnce();
            expect(recordedResourceUse.acquire).toHaveBeenCalledWith(904, 'encoding');
            expect(fixture.manage.idCnt).toBe(1);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.provider).not.toHaveBeenCalled();
            expect(added).toEqual([]);

            acquired.resolve({ token });
            await expect(pushing).resolves.toBe(1);
            expect(fixture.provider).toHaveBeenCalledOnce();
            expect(added).toEqual([1]);
            expect(recordedResourceUse.release).not.toHaveBeenCalled();
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it.each(['RecordedResourceUseBlocked', 'RecordedResourceUseTimeout', 'RecordedResourceUseUnknown'])(
        '[EN-SPEC-RECORDED-USE-REJECT] leaves no queue, job, notification, or release after %s',
        async rejection => {
            const recordedResourceUse: RecordedResourceUsePort = {
                acquire: vi.fn(async () => {
                    throw new Error(rejection);
                }),
                release: vi.fn(async () => undefined),
            };
            const fixture = makeManage(1, 4, recordedResourceUse);
            const added: number[] = [];
            fixture.event.setAddEncode(id => added.push(id));

            try {
                await expect(fixture.manage.push(addOption({ recordedId: 905 }))).rejects.toThrow(rejection);

                expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(905, 'encoding');
                expect(recordedResourceUse.release).not.toHaveBeenCalled();
                expect(fixture.manage.idCnt).toBe(1);
                expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
                expect(fixture.provider).not.toHaveBeenCalled();
                expect(added).toEqual([]);
            } finally {
                await fixture.cleanup();
                expectCleanFixture(fixture);
            }
        },
    );

    it.each([
        ['null carrier', null],
        ['non-object carrier', 912],
        ['missing token', {}],
        ['null token', { token: null }],
        ['non-object token', { token: 'test-not-an-object-token' }],
        ['function carrier', Object.assign(() => undefined, { token: {} })],
    ] as const)('[EN-SPEC-RECORDED-USE-INVALID] rejects %s without admission side effects', async (_case, acquired) => {
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => acquired as { token: object }),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        const added: number[] = [];
        fixture.event.setAddEncode(id => added.push(id));

        try {
            await expect(fixture.manage.push(addOption({ recordedId: 912 }))).rejects.toThrow(
                'InvalidRecordedResourceUseLease',
            );

            expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(912, 'encoding');
            expect(recordedResourceUse.release).not.toHaveBeenCalled();
            expect(fixture.manage.idCnt).toBe(1);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            expect(fixture.provider).not.toHaveBeenCalled();
            expect(added).toEqual([]);
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-RECORDED-USE-WAIT-CANCEL] releases the exact held token once when a waiting job is cancelled', async () => {
        const token = {};
        const unrelatedToken = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi
                .fn()
                .mockImplementationOnce(async () => ({ token }))
                .mockImplementationOnce(async () => ({ token: unrelatedToken }))
                .mockImplementation(async () => {
                    throw new Error('UnexpectedRecordedResourceUseAcquire');
                }),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();

        try {
            const id = await fixture.manage.push(addOption({ recordedId: 906 }));
            const addingUnrelated = fixture.manage.push(addOption({ recordedId: 907 }));
            await Promise.resolve();
            await fixture.settleCurrentChecks();
            const unrelatedId = await addingUnrelated;
            expect(recordedResourceUse.release).not.toHaveBeenCalled();

            const cancelling = fixture.manage.cancel(id);
            await Promise.resolve();
            await fixture.settleCurrentChecks();
            await cancelling;

            expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
            expect(fixture.logger.encode.info).toHaveBeenCalledWith(`cancel encode: ${id}`);
            expect(fixture.manage.getEncodeInfo()).toEqual({
                runningQueue: [],
                waitQueue: [{ id: unrelatedId, mode: 'synthetic-mode', recordedId: 907 }],
            });

            const cancelUnrelated = fixture.manage.cancel(unrelatedId);
            await Promise.resolve();
            await fixture.settleCurrentChecks();
            await cancelUnrelated;

            expect(recordedResourceUse.release).toHaveBeenNthCalledWith(2, unrelatedToken);
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it.each(['sync-throw', 'rejected-promise'] as const)(
        '[EN-SPEC-RECORDED-USE-RELEASE-FAILURE] logs %s once without breaking concurrent waiting cancellation',
        async failure => {
            const token = {};
            const releaseFailure = new Error(`SyntheticRelease${failure}`);
            const recordedResourceUse: RecordedResourceUsePort = {
                acquire: vi.fn(async () => ({ token })),
                release: vi.fn(() => {
                    if (failure === 'sync-throw') throw releaseFailure;
                    return Promise.reject(releaseFailure);
                }),
            };
            const fixture = makeManage(1, 4, recordedResourceUse);
            (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();

            try {
                const id = await fixture.manage.push(addOption({ recordedId: 911 }));
                const firstCancel = fixture.manage.cancel(id);
                const secondCancel = fixture.manage.cancel(id);
                await Promise.resolve();
                await fixture.settleCurrentChecks();

                await expect(Promise.all([firstCancel, secondCancel])).resolves.toEqual([undefined, undefined]);
                expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
                expect(fixture.logger.encode.error).toHaveBeenCalledWith('release recorded resource use failed');
                expect(fixture.logger.encode.error).toHaveBeenCalledWith(releaseFailure);
                expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
            } finally {
                await fixture.cleanup();
                expectCleanFixture(fixture);
            }
        },
    );

    it('[EN-SPEC-RECORDED-USE-RELEASE-LOG-FAILURE] absorbs a logger failure while reporting a release failure', async () => {
        const token = {};
        const releaseFailure = new Error('SyntheticReleaseLogFailure');
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(() => Promise.reject(releaseFailure)),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        fixture.logger.encode.error.mockImplementation(() => {
            throw new Error('SyntheticRecordedUseReleaseLoggerFailure');
        });

        try {
            const id = await fixture.manage.push(addOption({ recordedId: 912 }));
            const cancelling = fixture.manage.cancel(id);
            await Promise.resolve();
            await fixture.settleCurrentChecks();

            // logRecordedUseReleaseFailure (EncodeManageModel.ts:457-464) wraps its own logging call in
            // try/catch specifically so a broken logger cannot prevent queue cleanup or cancellation
            // from completing -- this proves that swallow works, not just that the release failure
            // itself is reported.
            await expect(cancelling).resolves.toBeUndefined();
            expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-RECORDED-USE-ADMISSION-ROLLBACK] releases the exact token after job creation fails before queue publication', async () => {
        const token = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        fixture.provider.mockRejectedValueOnce(new Error('SyntheticEncoderProviderFailure'));

        try {
            await expect(fixture.manage.push(addOption({ recordedId: 907 }))).rejects.toThrow(
                'SyntheticEncoderProviderFailure',
            );

            expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(907, 'encoding');
            expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
            expect(fixture.manage.idCnt).toBe(1);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });

    it('[EN-SPEC-RECORDED-USE-QUEUE-ROLLBACK] releases the exact token after queue publication fails', async () => {
        const token = {};
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const fixture = makeManage(1, 4, recordedResourceUse);
        const runtime = fixture.manage as unknown as {
            waitQueue: SyntheticEncoder[];
        };
        vi.spyOn(runtime.waitQueue, 'push').mockImplementation(() => {
            throw new Error('SyntheticQueueAppendFailure');
        });

        try {
            await expect(fixture.manage.push(addOption({ recordedId: 908 }))).rejects.toThrow(
                'SyntheticQueueAppendFailure',
            );

            expect(recordedResourceUse.acquire).toHaveBeenCalledExactlyOnceWith(908, 'encoding');
            expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token);
            expect(fixture.manage.idCnt).toBe(1);
            expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });
});

describe('recorded-use result-settlement contract', () => {
    it('[EN-SPEC-RECORDED-USE-SETTLEMENT] retains the exact lease through direct result settlement and releases it once', async () => {
        const token = {};
        const settlement = createDeferred<void>();
        const recordedResourceUse: RecordedResourceUsePort = {
            acquire: vi.fn(async () => ({ token })),
            release: vi.fn(async () => undefined),
        };
        const finish: EncodeFinishSettlementPort = {
            finishEncode: vi.fn(() => settlement.promise),
        };
        const fixture = makeManage(1, 4, recordedResourceUse, finish);

        try {
            await fixture.manage.push(addOption({ recordedId: 913 }));
            await fixture.settleCurrentChecks();
            await vi.waitFor(() => expect(fixture.encoders[0]?.finishCallback).not.toBeNull());

            const terminal = fixture.encoders[0]?.finishCallback;
            if (terminal === null || terminal === undefined) throw new Error('MissingSyntheticFinishCallback');
            terminal(false, 'settling-output.mp4');
            terminal(false, 'late-duplicate-output.mp4');

            await vi.waitFor(() => expect(finish.finishEncode).toHaveBeenCalledOnce());
            await fixture.settleCurrentChecks();
            expect(recordedResourceUse.release).not.toHaveBeenCalled();

            settlement.resolve(undefined);
            await vi.waitFor(() => expect(recordedResourceUse.release).toHaveBeenCalledExactlyOnceWith(token));
        } finally {
            await fixture.cleanup();
            expectCleanFixture(fixture);
        }
    });
});

describe('inactive recorded-use snapshot contract', () => {
    it('[EN-SPEC-RECORDED-USE-SNAPSHOT-INACTIVE] reads deduplicated queued and running recorded IDs without activating work', () => {
        const fixture = makeManage(1, 4);
        const running = makeEncoder();
        const duplicateWaiting = makeEncoder();
        const waiting = makeEncoder();
        running.setOption({ ...addOption({ recordedId: 901 }), encodeId: 71 });
        duplicateWaiting.setOption({ ...addOption({ recordedId: 901 }), encodeId: 72 });
        waiting.setOption({ ...addOption({ recordedId: 902 }), encodeId: 73 });
        fixture.manage.runningQueue = [running];
        fixture.manage.waitQueue = [duplicateWaiting, waiting];
        const before = fixture.manage.getEncodeInfo();

        expect(fixture.manage.getQueuedAndRunningRecordedIds()).toEqual({
            status: 'known',
            recordedIds: new Set([901, 902]),
        });
        expect(fixture.manage.getEncodeInfo()).toEqual(before);
        expect(fixture.execution.getExecution).not.toHaveBeenCalled();
        expect(fixture.provider).not.toHaveBeenCalled();

        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-RECORDED-USE-SNAPSHOT-UNKNOWN] reports unknown when one queued job cannot expose its recorded ID', () => {
        const fixture = makeManage(1, 4);
        const unavailable = makeEncoder();
        unavailable.setOption({ ...addOption({ recordedId: 903 }), encodeId: 74 });
        unavailable.getEncodeOption.mockReturnValueOnce(null);
        fixture.manage.waitQueue = [unavailable];

        expect(fixture.manage.getQueuedAndRunningRecordedIds()).toEqual({ status: 'unknown' });
        expect(fixture.execution.getExecution).not.toHaveBeenCalled();
        expect(fixture.provider).not.toHaveBeenCalled();

        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-RECORDED-USE-SNAPSHOT-UNKNOWN] reports unknown when reading one queued job throws', () => {
        const fixture = makeManage(1, 4);
        const unavailable = makeEncoder();
        unavailable.getEncodeOption.mockImplementation(() => {
            throw new Error('SyntheticRecordedUseSnapshotFailure');
        });
        fixture.manage.waitQueue = [unavailable];

        expect(fixture.manage.getQueuedAndRunningRecordedIds()).toEqual({ status: 'unknown' });
        expect(fixture.execution.getExecution).not.toHaveBeenCalled();
        expect(fixture.provider).not.toHaveBeenCalled();

        (fixture.manage as unknown as { listener: EventEmitter }).listener.removeAllListeners();
        (fixture.event as unknown as { emitter: EventEmitter }).emitter.removeAllListeners();
        expectCleanFixture(fixture);
    });
});

describe('FIFO execution characterization', () => {
    it('[EN-SPEC-R2-1-2-5] starts in FIFO order, holds the local limit, and advances after normal and abnormal completion', async () => {
        const fixture = makeManage(2, 8);
        const starts: number[] = [];

        await fixture.manage.push(addOption({ recordedId: 801 }));
        await fixture.manage.push(addOption({ recordedId: 802 }));
        await fixture.manage.push(addOption({ recordedId: 803 }));
        await fixture.manage.push(addOption({ recordedId: 804 }));
        fixture.encoders.forEach(encoder => {
            encoder.start.mockImplementation(async () => {
                starts.push(encoder.option!.encodeId);
            });
        });

        await fixture.settleCurrentChecks();
        expect(starts).toEqual([1, 2]);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [
                { id: 1, mode: 'synthetic-mode', recordedId: 801 },
                { id: 2, mode: 'synthetic-mode', recordedId: 802 },
            ],
            waitQueue: [
                { id: 3, mode: 'synthetic-mode', recordedId: 803 },
                { id: 4, mode: 'synthetic-mode', recordedId: 804 },
            ],
        });

        fixture.encoders[0].finish(false, 'first-output.mp4');
        await flushEventLoop();
        expect(starts).toEqual([1, 2]);
        await fixture.settleCurrentChecks();
        expect(starts).toEqual([1, 2, 3]);
        expect(fixture.manage.getEncodeInfo().runningQueue.map(item => item.id)).toEqual([2, 3]);

        fixture.encoders[1].finish(true, null);
        await flushEventLoop();
        expect(starts).toEqual([1, 2, 3]);
        await fixture.settleCurrentChecks();
        expect(starts).toEqual([1, 2, 3, 4]);
        expect(fixture.manage.getEncodeInfo().runningQueue.map(item => item.id)).toEqual([3, 4]);

        fixture.encoders[2].finish(false, 'third-output.mp4');
        fixture.encoders[3].finish(false, 'fourth-output.mp4');
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-3] obtains a shared execution slot before starting the queued encoder', async () => {
        const fixture = makeManage(1, 4);
        await fixture.manage.push(addOption({ recordedId: 805 }));
        const [encoder] = fixture.encoders;

        await fixture.settleCurrentChecks();

        expect(fixture.execution.getExecution).toHaveBeenCalledTimes(2);
        expect(fixture.execution.getExecution.mock.invocationCallOrder[1]).toBeLessThan(
            encoder.start.mock.invocationCallOrder[0],
        );
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 1, mode: 'synthetic-mode', recordedId: 805 }],
            waitQueue: [],
        });

        encoder.finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R2-3-4-R3-6] removes a failed start without requeueing it and checks the next FIFO item on the next loop', async () => {
        const fixture = makeManage(1, 4);
        const starts: number[] = [];
        const errors: number[] = [];
        fixture.event.setErrorEncode(() => errors.push(errors.length + 1));

        await fixture.manage.push(addOption({ recordedId: 811 }));
        await fixture.manage.push(addOption({ recordedId: 812 }));
        fixture.encoders[0].start.mockImplementation(async () => {
            starts.push(1);
            throw new Error('SyntheticSharedSlotRefusal');
        });
        fixture.encoders[1].start.mockImplementation(async () => {
            starts.push(2);
        });

        await fixture.settleCurrentChecks();
        await flushEventLoop();
        expect(starts).toEqual([1]);
        expect(errors).toEqual([1]);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [],
            waitQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 812 }],
        });

        await fixture.settleCurrentChecks();
        expect(starts).toEqual([1, 2]);
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 812 }],
            waitQueue: [],
        });
        fixture.encoders[1].finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R6-9] frees the queue before asynchronous result reflection settles', async () => {
        const fixture = makeManage(1, 4);
        const reflection = createDeferred<void>();
        const reflected: number[] = [];
        fixture.event.setFinishEncode(info => {
            void reflection.promise.then(() => reflected.push(info.recordedId));
        });

        await fixture.manage.push(addOption({ recordedId: 821 }));
        await fixture.manage.push(addOption({ recordedId: 822 }));
        await fixture.settleCurrentChecks();
        fixture.encoders[0].finish(false, 'first-output.mp4');
        await flushEventLoop();
        await fixture.settleCurrentChecks();

        expect(reflected).toEqual([]);
        expect(fixture.encoders[1].start).toHaveBeenCalledOnce();
        expect(fixture.manage.getEncodeInfo()).toEqual({
            runningQueue: [{ id: 2, mode: 'synthetic-mode', recordedId: 822 }],
            waitQueue: [],
        });

        reflection.resolve(undefined);
        await reflection.promise;
        expect(reflected).toEqual([821]);
        fixture.encoders[1].finish(false, null);
        await fixture.cleanup();
        expectCleanFixture(fixture);
    });

    it('[EN-SPEC-R6-8] logs one delete rejection after registration without client or completion notification', async () => {
        const deletionFailure = new Error('synthetic source deletion failure');
        const addVideoFile = vi.fn(async () => 831);
        const deleteVideoFile = vi.fn(async () => {
            throw deletionFailure;
        });
        const notifyClient = vi.fn();
        const emitFinishEncode = vi.fn(async () => undefined);
        const fixture = makeManage(1, 4);

        await fixture.manage.push(addOption({ recordedId: 831 }));
        const finishModel = new EncodeFinishModel(
            { getLogger: () => fixture.logger } as never,
            { notifyClient, notifyUpdateEncodeProgress: vi.fn() } as never,
            {
                encodeEvent: { emitFinishEncode },
                recorded: { addVideoFile, deleteVideoFile, updateVideoFileSize: vi.fn(async () => undefined) },
            } as never,
            fixture.event,
            fixture.manage as never,
        );
        finishModel.set();

        await fixture.settleCurrentChecks();
        fixture.encoders[0].finish(false, 'source-delete-failure.mp4');
        await vi.waitFor(() => expect(fixture.logger.system.error).toHaveBeenCalledWith(deletionFailure));

        expect(addVideoFile).toHaveBeenCalledOnce();
        expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(43, true);
        expect(fixture.logger.system.error).toHaveBeenCalledTimes(1);
        expect(notifyClient).not.toHaveBeenCalled();
        expect(emitFinishEncode).not.toHaveBeenCalled();
        expect(fixture.manage.getEncodeInfo()).toEqual({ runningQueue: [], waitQueue: [] });

        await fixture.cleanup();
        expectCleanFixture(fixture);
    });
});

describe('encoder preflight characterization', () => {
    it.each([
        ['recording file registration', { video: null }],
        ['recorded program', { recorded: null }],
        ['channel', { channel: null }],
        ['physical input file', { inputExists: false }],
        ['encoding mode', { encode: [] }],
        ['destination directory', { parentExists: false }],
    ] as const)('[EN-SPEC-R3-1-2] does not request a process when %s is unavailable', async (_boundary, overrides) => {
        const fixture = await makeEncoderFixture(overrides);

        await expect(fixture.model.start()).rejects.toBeInstanceOf(Error);

        expect(fixture.create).not.toHaveBeenCalled();
        expect(fixture.model.childProcess).toBeNull();
        expect(fixture.model.timerId).toBeNull();
    });

    it('[EN-SPEC-R3-2] releases the exact output reservation and preserves the process start error', async () => {
        const startError = new Error('SyntheticProcessStartFailure');
        const fixture = await makeEncoderFixture({ createError: startError });
        const release = vi.spyOn(fixture.fileManager, 'release');

        await expect(fixture.model.start()).rejects.toBe(startError);

        expect(fixture.create).toHaveBeenCalledOnce();
        const output = (fixture.create.mock.calls[0][0] as { output: string | null }).output;
        expect(output).not.toBeNull();
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(output);
        expect(fixture.fileManager.usedFileNameIndex).toEqual({});
        expect(fixture.model.childProcess).toBeNull();
        expect(fixture.model.timerId).toBeNull();
    });

    it('[EN-COMPOSITE-R3-2] does not manufacture an output release when a no-output process start fails', async () => {
        const startError = new Error('SyntheticNoOutputProcessStartFailure');
        const fixture = await makeEncoderFixture({
            createError: startError,
            encode: [{ cmd: '%NODE% %INPUT% %OUTPUT%', name: 'synthetic-mode' }],
        });
        const release = vi.spyOn(fixture.fileManager, 'release');

        await expect(fixture.model.start()).rejects.toBe(startError);

        expect(fixture.create).toHaveBeenCalledOnce();
        expect((fixture.create.mock.calls[0][0] as { output: string | null }).output).toBeNull();
        expect(release).not.toHaveBeenCalled();
        expect(fixture.fileManager.usedFileNameIndex).toEqual({});
        expect(fixture.model.childProcess).toBeNull();
        expect(fixture.model.timerId).toBeNull();
    });
});

describe('command, environment, and deadline characterization', () => {
    it('[EN-SPEC-R3-7] replaces NODE, ROOT, and SPACE only at their established parse positions', async () => {
        const parsed = ProcessUtil.parseCmdStr('%NODE% %ROOT% %SPACE% %INPUT% %OUTPUT% %UNKNOWN%');

        expect(parsed).toEqual({
            args: [ProcessUtil.ROOT_PATH, ' ', '%INPUT%', '%OUTPUT%', '%UNKNOWN%'],
            bin: process.argv[0],
        });

        const fixture = await makeEncoderFixture({
            encode: [{ cmd: '%NODE% %ROOT% %SPACE% %INPUT% %OUTPUT%', name: 'synthetic-mode' }],
        });
        await fixture.model.start();
        expect(fixture.create).toHaveBeenCalledOnce();
        expect((fixture.create.mock.calls[0][0] as { cmd: string }).cmd).toBe('%NODE% %ROOT% %SPACE% %INPUT% %OUTPUT%');
        await settleEncoder(fixture);
        expect(fixture.fileManager.usedFileNameIndex).toEqual({});
    });

    it('[EN-SPEC-R3-8-9] inherits the parent environment and overlays exactly 35 named decimal-or-empty values', async () => {
        const originalValues = new Map(ENCODE_ENV_KEYS.map(key => [key, process.env[key]]));
        const markerKey = 'EPGSTATION_SYNTHETIC_PARENT_MARKER';
        const originalMarker = process.env[markerKey];
        for (const key of ENCODE_ENV_KEYS) delete process.env[key];
        const staleKeys = ['RECORDEDID', 'CHANNELNAME', 'DIR'] as const;
        process.env.RECORDEDID = 'stale-recorded-id';
        process.env.CHANNELNAME = 'stale-channel-name';
        process.env.DIR = 'stale-directory';
        process.env[markerKey] = 'inherited';
        const staleKeySet = new Set<string>(staleKeys);

        try {
            const fixture = await makeEncoderFixture();
            await fixture.model.start();
            const request = fixture.create.mock.calls[0][0] as {
                output: string | null;
                spawnOption: { env: Record<string, string | undefined> };
            };
            const environment = request.spawnOption.env;
            const inheritedKeys = new Set(Object.keys(process.env));
            const overlayKeys = Object.keys(environment).filter(key => inheritedKeys.has(key) === false);

            expect(ENCODE_ENV_KEYS).toHaveLength(35);
            expect(overlayKeys.sort()).toEqual(ENCODE_ENV_KEYS.filter(key => staleKeySet.has(key) === false).sort());
            expect(ENCODE_ENV_KEYS.every(key => Object.prototype.hasOwnProperty.call(environment, key))).toBe(true);
            expect(environment[markerKey]).toBe('inherited');
            expect(environment.RECORDEDID).toBe('501');
            expect(environment.CHANNELNAME).toBe('Channel name');
            expect(environment.CHANNEL_NAME).toBeUndefined();
            expect(environment.DESCRIPTION).toBe('');
            expect(environment.VIDEOTYPE).toBe('');
            expect(environment.GENRE1).toBe('0');
            expect(environment.SUBGENRE3).toBe('0');
            expect(environment.ERROR_CNT).toBe('7');
            expect(environment.DROP_CNT).toBe('0');
            expect(environment.SCRAMBLING_CNT).toBe('11');
            expect(ENCODE_ENV_KEYS.every(key => typeof environment[key] === 'string')).toBe(true);
            expect(request.output).not.toBeNull();

            await settleEncoder(fixture);
            expect(fixture.fileManager.usedFileNameIndex).toEqual({});
        } finally {
            for (const [key, value] of originalValues) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            if (originalMarker === undefined) delete process.env[markerKey];
            else process.env[markerKey] = originalMarker;
        }
    });

    it.each([
        ['output without directory', '.mp4', undefined, 'output'],
        ['no output with directory', undefined, 'nested', 'directory'],
        ['no output or directory', undefined, undefined, 'empty'],
    ] as const)('[EN-SPEC-R3-8-9] keeps DIR and SUBDIR distinct for %s', async (_case, suffix, directory, expected) => {
        const fixture = await makeEncoderFixture({
            ...(directory === undefined ? {} : { directory }),
            encode: [{ cmd: '%NODE%', name: 'synthetic-mode', ...(suffix === undefined ? {} : { suffix }) }],
        });
        await fixture.model.start();
        const request = fixture.create.mock.calls[0][0] as {
            output: string | null;
            spawnOption: { env: Record<string, string | undefined> };
        };
        const environment = request.spawnOption.env;

        if (expected === 'output') {
            expect(request.output).not.toBeNull();
            expect(environment.DIR).toBe(request.output);
            expect(environment.SUBDIR).toBe('');
        } else if (expected === 'directory') {
            expect(request.output).toBeNull();
            expect(environment.DIR).toBe('nested');
            expect(environment.SUBDIR).toBe('nested');
        } else {
            expect(request.output).toBeNull();
            expect(environment.DIR).toBe('');
            expect(environment.SUBDIR).toBe('');
        }

        await settleEncoder(fixture);
    });

    it.each([
        ['explicit rate', 3, 75],
        ['default rate', undefined, 100],
    ] as const)(
        '[EN-SPEC-R3-3-5] uses duration times %s and requests the established cancellation once at the boundary',
        async (_case, rate, deadline) => {
            vi.useFakeTimers();
            const fixture = await makeEncoderFixture({
                encode: [{ cmd: '%NODE%', name: 'synthetic-mode', ...(rate === undefined ? {} : { rate }) }],
            });
            const cancel = vi.spyOn(fixture.model, 'cancel').mockResolvedValue(undefined);
            await fixture.model.start();

            await vi.advanceTimersByTimeAsync(deadline - 1);
            expect(cancel).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(cancel).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(deadline);
            expect(cancel).toHaveBeenCalledOnce();
            await settleEncoder(fixture, 1);
            expect(vi.getTimerCount()).toBe(0);
        },
    );
});
