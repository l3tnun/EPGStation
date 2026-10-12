import { execFile, fork } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { flushImmediate, makeLogger, makeSetter, RecordingEvent } from '../event-and-hook-delivery/_harness';
import { makeManager, makeReserve } from '../recording-execution/_harness';

const executeFile = promisify(execFile);
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const require = createRequire(join(process.cwd(), 'package.json'));
const IPCServer = (
    require(join(snapshot, 'model/ipc/IPCServer.js')) as { default: new (...dependencies: any[]) => any }
).default;
const reflectMetadataEntry = require.resolve('reflect-metadata');

interface RuntimeStartupWorkflowInput {
    runRecordingReconciliation: () => Promise<void>;
    runRecordingCandidatesAndStart: () => Promise<void>;
    runExpiredReservationCleanup: () => Promise<void>;
    startEpgSupervisor: () => Promise<void>;
}

interface RuntimeStartupWorkflowPort {
    runAfterServiceSupervisionAccepted(input: RuntimeStartupWorkflowInput): Promise<unknown>;
}

const StartupContinuationCoordinator = (
    require(join(snapshot, 'model/workflow/StartupContinuationCoordinator.js')) as {
        default: new () => RuntimeStartupWorkflowPort;
    }
).default;

const runPreparationRejectionChild = async (): Promise<string[]> => {
    const script = `
        require('reflect-metadata');
        const { join } = require('node:path');
        const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        const EventSetter = require(join(snapshot, 'model', 'event', 'EventSetter.js')).default;
        const callbacks = Object.create(null);
        const port = names => Object.fromEntries(names.map(name => [name, callback => { callbacks[name] = callback; }]));
        const logger = { system: { error: error => console.log('error:' + error.message), fatal() {}, debug() {}, info() {}, warn() {} } };
        const setter = new EventSetter(
            { getLogger: () => logger },
            port(['setUpdated']),
            port(['setFinishEncode']),
            port(['setAdded', 'setUpdated', 'setEnabled', 'setDisabled', 'setDeleted']),
            port(['setUpdated']),
            port(['setStartPrepRecording', 'setCancelPrepRecording', 'setPrepRecordingFailed', 'setStartRecording', 'setRecordingFailed', 'setRecordingRetryOver', 'setFinishRecording', 'setEventRelay']),
            port(['setCreated', 'setUpdated', 'setRelated', 'setDeleted', 'setDeletedRelation']),
            port(['setDeleteRecorded', 'setUpdateVideoFileSize', 'setAddVideoFile', 'setCreateNewRecorded', 'setAddUploadedVideoFile', 'setDeleteVideoFile', 'setDropLogFileChanged', 'setChangeProtect']),
            port(['setAdded', 'setDeleted']),
            { updateAll() {}, updateRule() {}, cancel: () => Promise.reject(new Error('cancel-rejected')), addEventRelay() {} },
            { acceptMutation() {} },
            { historyCleanup() {}, removeRuleId() {} },
            { setRelation() {} },
            { add() {} },
            { addUpdateReseves() {}, addRecordingPrepStartCmd() {}, addRecordingPrepRecFailedCmd() {}, addRecordingStartCmd() {}, addRecordingFailedCmd() {}, addRecordingFinishCmd() {}, addEncodingFinishCmd() {} },
            { notifyClient() {}, setEncode() {} },
            { getConfig: () => ({ recorded: [{ name: 'synthetic-root' }] }) },
            { setup() {} },
        );
        let unhandled = false;
        process.on('unhandledRejection', () => { unhandled = true; });
        setter.set();
        callbacks.setPrepRecordingFailed({ id: 289 });
        setImmediate(() => {
            console.log('unhandled:' + unhandled);
            process.exitCode = unhandled ? 1 : 0;
        });
    `;
    const result = await executeFile(process.execPath, ['--unhandled-rejections=strict', '-e', script], {
        env: { ...process.env, EPGSTATION_SERVER_COMPILED_SNAPSHOT: snapshot },
        timeout: 5_000,
    });

    expect(result.stderr).toBe('');
    return result.stdout.trim().split('\n').filter(Boolean);
};

describe('reservation recording provider contract', () => {
    it('[WC-2.1][WC-2.4] hands a reservation diff to the synchronous Recording mutation port before the reservation Hook', async () => {
        const recording = makeManager();
        const harness = makeSetter({ recordingManage: recording.model });
        const reserve = makeReserve({ id: 261, endAt: Date.now() + 60_000, startAt: Date.now() });
        const actualAcceptMutation = recording.model.acceptMutation.bind(recording.model);
        const ledger: string[] = [];
        const acceptMutation = vi.spyOn(recording.model, 'acceptMutation').mockImplementation(diff => {
            ledger.push('accept');
            actualAcceptMutation(diff);
        });
        const update = vi.spyOn(recording.model, 'update');
        harness.externalCommandManage.addUpdateReseves.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        try {
            expect(harness.callbacks.reserve.setUpdated({ insert: [reserve], isSuppressLog: false })).toBeUndefined();

            expect(acceptMutation).toHaveBeenCalledOnce();
            expect(update).not.toHaveBeenCalled();
            expect(ledger).toEqual(['accept', 'hook']);
            expect(harness.externalCommandManage.addUpdateReseves.mock.calls).toEqual([
                [{ insert: [reserve], isSuppressLog: false }],
            ]);

            for (let index = 0; index < 12; index += 1) await Promise.resolve();

            expect(recording.model.hasReserve(reserve.id)).toBe(true);
        } finally {
            recording.model.scheduleController.stop();
        }
    });

    it('[WC-2.5][WC-2.6] connects the real recording preparation-failure event to independent refresh, cancellation, and Hook handoffs', async () => {
        const logger = makeLogger();
        const recordingEvent = new RecordingEvent({ getLogger: () => logger });
        const reserve = makeReserve({ id: 290 });
        const ledger: string[] = [];
        const harness = makeSetter({ logger, recordingEvent });
        harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
        harness.reservationManage.cancel.mockImplementation(() => {
            ledger.push('cancel');
            return Promise.resolve(undefined);
        });
        harness.externalCommandManage.addRecordingPrepRecFailedCmd.mockImplementation(() => ledger.push('hook'));
        harness.setter.set();

        expect(recordingEvent.emitPrepRecordingFailed(reserve)).toBeUndefined();
        await flushImmediate();

        expect(ledger).toEqual(['ui', 'cancel', 'hook']);
        expect(harness.reservationManage.cancel).toHaveBeenCalledExactlyOnceWith(reserve.id);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('[WC-2.6][WC-7.3] records an async preparation-cancellation rejection in an isolated Node process', async () => {
        await expect(runPreparationRejectionChild()).resolves.toEqual(['error:cancel-rejected', 'unhandled:false']);
    });
});

describe('Runtime startup single-port typed outcomes', () => {
    it.each([
        [
            'synchronous throw',
            (failure: Error) =>
                vi.fn(() => {
                    throw failure;
                }),
        ],
        ['rejection', (failure: Error) => vi.fn(async () => Promise.reject(failure))],
    ] as const)(
        '[PRIMARY WC-7.9][WC-7.9] converts a recording reconciliation %s into the single port typed first-failure without invoking the remaining three stages',
        async (_, createReconciliation) => {
            const failure = new Error('synthetic recording reconciliation failure');
            const coordinator = new StartupContinuationCoordinator();
            const input: RuntimeStartupWorkflowInput = {
                runRecordingReconciliation: createReconciliation(failure),
                runRecordingCandidatesAndStart: vi.fn(async () => undefined),
                runExpiredReservationCleanup: vi.fn(async () => undefined),
                startEpgSupervisor: vi.fn(async () => undefined),
            };

            await expect(coordinator.runAfterServiceSupervisionAccepted(input)).resolves.toEqual({
                cause: failure,
                kind: 'Failed',
                stage: 'recording-reconciliation',
            });

            expect(input.runRecordingReconciliation).toHaveBeenCalledOnce();
            expect(input.runRecordingCandidatesAndStart).not.toHaveBeenCalled();
            expect(input.runExpiredReservationCleanup).not.toHaveBeenCalled();
            expect(input.startEpgSupervisor).not.toHaveBeenCalled();
        },
    );
});

// Layer 4 (Task 9.4, requirements.md AC 8.4): connects the existing service-child IPC consumer, the
// real production recording typed provider, and the recorded-content typed provider boundary across
// a live forked child process, while preserving the existing recorded.delete wire (model `recorded`,
// function `delete`, args `{ recordedId }`, void/error reply, default 5s timeout -- confirmed against
// `src/model/ipc/IPCClient.ts:758-770` and `src/model/ipc/IPCMessageDefine.ts:123-133`). Unlike the
// existing `user-deletion.integration.test.ts`/`video-file-deletion.integration.test.ts` PRIMARY
// tests (which drive the real `IPCServer` directly with a synthetic `EventEmitter` message and fake
// `recording`/`recorded` domain objects), this test additionally drives the real, compiled
// `RecordedApiModel.delete()` (the actual IPC *consumer* entry point) from inside a real, separate
// Node child process talking over the OS-level IPC channel `fork()` provides, and wires the parent
// side's recording port to the real, compiled `RecordingManageModel` (via the same
// `recording-execution` harness `WC-2.1` already uses in this file), not a bare fake. The
// recorded-content boundary stays a typed-interface-conformant fake, matching every other Layer 1-3
// PRIMARY test in this tree: `server-recorded-content` owns the real DB/filesystem effects behind
// `IPreparedRecordedDeletionProvider`, and Requirement 8.4 explicitly bars this feature from owning
// DB/filesystem directly.
describe('workflow-coordination Layer 4 provider contracts', () => {
    const artifactsTmpDirectory = join(process.cwd(), 'test/server/.artifacts/tmp');

    const runIpcConsumerChild = async (
        recordedId: number,
    ): Promise<{ readonly cancelledEncodeIds: readonly number[]; readonly ok: boolean; readonly stderr: string }> => {
        await mkdir(artifactsTmpDirectory, { recursive: true });
        const scriptDirectory = await mkdtemp(join(artifactsTmpDirectory, 'layer4-ipc-consumer-'));
        const scriptPath = join(scriptDirectory, 'child.cjs');
        const childScript = [
            "'use strict';",
            `require(${JSON.stringify(reflectMetadataEntry)});`,
            "const { join } = require('node:path');",
            'const snapshotPath = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;',
            "const IPCClient = require(join(snapshotPath, 'model', 'ipc', 'IPCClient.js')).default;",
            "const RecordedApiModel = require(join(snapshotPath, 'model', 'api', 'recorded', 'RecordedApiModel.js')).default;",
            'const noop = () => undefined;',
            'const logger = {',
            '    access: { error: noop, fatal: noop, info: noop },',
            '    encode: { error: noop, fatal: noop, info: noop },',
            '    stream: { error: noop, fatal: noop, info: noop },',
            '    system: { debug: noop, error: noop, fatal: noop, info: noop, warn: noop },',
            '};',
            'const loggerModel = { getLogger: () => logger };',
            'const cancelledEncodeIds = [];',
            'const encodeManage = { cancelEncodeByRecordedId: async id => { cancelledEncodeIds.push(id); } };',
            'const ipc = new IPCClient(loggerModel, {}, encodeManage);',
            'const api = new RecordedApiModel(ipc, {}, encodeManage, {});',
            'const recordedId = Number(process.argv[2]);',
            'api.delete(recordedId).then(',
            '    () => {',
            "        process.stdout.write('DONE:' + JSON.stringify({ cancelledEncodeIds, ok: true }) + '\\n');",
            '        process.exit(0);',
            '    },',
            '    error => {',
            "        process.stdout.write('DONE:' + JSON.stringify({ cancelledEncodeIds, message: error && error.message, ok: false }) + '\\n');",
            '        process.exit(1);',
            '    },',
            ');',
        ].join('\n');
        await writeFile(scriptPath, childScript, 'utf8');

        const token = Object.freeze(Object.create(null));
        const reserveId = recordedId + 1;
        const recording = makeManager();
        const reserve = makeReserve({ endAt: Date.now() + 60_000, id: reserveId, startAt: Date.now() });
        recording.model.acceptMutation({ insert: [reserve], isSuppressLog: true });
        await vi.waitFor(() => expect(recording.model.hasReserve(reserveId)).toBe(true));

        const recordedDomain = {
            deletePrepared: vi.fn(async () => undefined),
            prepareUserDeletion: vi.fn(async () => ({
                isRecording: true,
                reserveId,
                status: 'prepared' as const,
                token,
            })),
        };
        const server = new IPCServer({}, recordedDomain, {}, recording.model, {}, {}, undefined, {});
        const child = fork(scriptPath, [String(recordedId)], {
            env: { ...process.env, EPGSTATION_SERVER_COMPILED_SNAPSHOT: snapshot },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', chunk => (stdout += chunk));
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', chunk => (stderr += chunk));
        server.register(child);

        try {
            await vi.waitFor(() => expect(stdout).toContain('DONE:'), { timeout: 8_000 });
            const doneLine = stdout.split('\n').find(line => line.startsWith('DONE:'));
            if (doneLine === undefined)
                throw new Error(`no DONE line observed from the forked child; stderr=${stderr}`);
            const outcome = JSON.parse(doneLine.slice('DONE:'.length)) as {
                cancelledEncodeIds: number[];
                ok: boolean;
            };

            expect(recordedDomain.prepareUserDeletion).toHaveBeenCalledExactlyOnceWith(recordedId);
            expect(recordedDomain.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
            expect(recordedDomain.deletePrepared.mock.calls[0][0]).toBe(token);
            await vi.waitFor(() => expect(recording.model.hasReserve(reserveId)).toBe(false));

            return { cancelledEncodeIds: outcome.cancelledEncodeIds, ok: outcome.ok, stderr };
        } finally {
            recording.model.scheduleController.stop();
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            await rm(scriptDirectory, { force: true, recursive: true });
        }
    };

    it('[WC-8.4] preserves the existing recorded.delete IPC wire while connecting the real service-child consumer, IPCServer, and the real RecordingManageModel typed recording provider across a live forked child process', async () => {
        const recordedId = 84_001;
        const outcome = await runIpcConsumerChild(recordedId);

        expect(outcome.stderr).toBe('');
        expect(outcome.ok).toBe(true);
        expect(outcome.cancelledEncodeIds).toEqual([recordedId]);
    }, 15_000);
});
