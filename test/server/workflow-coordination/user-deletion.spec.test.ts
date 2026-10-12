import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;
const ParentUserDeletionCoordinator = load<
    new (
        deletion: {
            prepareUserDeletion(recordedId: number): Promise<unknown>;
            deletePrepared(token: object): Promise<void>;
        },
        recording: {
            hasReservation(reserveId: number): boolean;
            requestCancellationForDeletion(reserveId: number): Promise<void>;
        },
    ) => {
        deleteFromRequest(recordedId: number): Promise<void>;
    }
>('model/workflow/ParentUserDeletionCoordinator.js');
const ParentVideoFileDeletionCoordinator = load<
    new (
        videoDeletion: object,
        recordedDeletion: object,
        recording: object,
    ) => { deleteVideoFileFromRequest(videoFileId: number): Promise<void> }
>('model/workflow/ParentVideoFileDeletionCoordinator.js');
const ServiceChildUserDeletionCoordinator = load<
    new (
        encoding: { cancelEncodeByRecordedId(recordedId: number): Promise<void> },
        request: { requestUserDeletion(recordedId: number): Promise<void> },
    ) => { deleteByUser(recordedId: number): Promise<void> }
>('model/workflow/ServiceChildUserDeletionCoordinator.js');

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('parent user deletion coordinator', () => {
    it('[WC-6.1] keeps preparation effect-free and invokes final deletion once only after the terminal barrier', async () => {
        const token = Object.freeze(Object.create(null));
        const preparation = deferred<{
            status: 'prepared';
            token: object;
            isRecording: boolean;
            reserveId: number;
        }>();
        const terminalBarrier = deferred<void>();
        const deletion = {
            prepareUserDeletion: vi.fn(() => preparation.promise),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => true),
            requestCancellationForDeletion: vi.fn(() => terminalBarrier.promise),
        };
        const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

        const operation = coordinator.deleteFromRequest(601);
        await vi.waitFor(() => expect(deletion.prepareUserDeletion).toHaveBeenCalledWith(601));

        expect(recording.hasReservation).not.toHaveBeenCalled();
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
        expect(deletion.deletePrepared).not.toHaveBeenCalled();

        preparation.resolve({ status: 'prepared', token, isRecording: true, reserveId: 602 });
        await vi.waitFor(() => expect(recording.requestCancellationForDeletion).toHaveBeenCalledWith(602));

        expect(deletion.deletePrepared).not.toHaveBeenCalled();
        terminalBarrier.resolve();
        await operation;

        expect(deletion.deletePrepared).toHaveBeenCalledOnce();
        expect(deletion.deletePrepared).toHaveBeenCalledWith(token);
    });

    it('[WC-5.5] when isRecording with reserveId but hasReservation is false, skips cancellation and continues deletion', async () => {
        const token = Object.freeze(Object.create(null));
        const deletion = {
            prepareUserDeletion: vi.fn(async () => ({
                status: 'prepared' as const,
                token,
                isRecording: true,
                reserveId: 603,
            })),
            deletePrepared: vi.fn(async () => undefined),
        };
        const recording = {
            hasReservation: vi.fn(() => false),
            requestCancellationForDeletion: vi.fn(async () => undefined),
        };
        const coordinator = new ParentUserDeletionCoordinator(deletion, recording);

        await coordinator.deleteFromRequest(601);

        expect(recording.hasReservation).toHaveBeenCalledExactlyOnceWith(603);
        expect(recording.requestCancellationForDeletion).not.toHaveBeenCalled();
        expect(deletion.deletePrepared).toHaveBeenCalledExactlyOnceWith(token);
        expect(deletion.deletePrepared.mock.calls[0][0]).toBe(token);
    });
});

describe('service child user deletion coordinator', () => {
    it('[WC-6.1] submits the unchanged deletion request only after Encode cancellation settles', async () => {
        const encodeCancellation = deferred<void>();
        const encoding = { cancelEncodeByRecordedId: vi.fn(() => encodeCancellation.promise) };
        const request = { requestUserDeletion: vi.fn(async () => undefined) };
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding, request);

        const operation = coordinator.deleteByUser(611);
        expect(encoding.cancelEncodeByRecordedId).toHaveBeenCalledWith(611);
        expect(request.requestUserDeletion).not.toHaveBeenCalled();

        encodeCancellation.resolve();
        await operation;

        expect(request.requestUserDeletion).toHaveBeenCalledOnce();
        expect(request.requestUserDeletion).toHaveBeenCalledWith(611);
    });
});

interface CallLedger {
    readonly calls: string[];
    readonly outside: string[];
    readonly labels: WeakMap<object, string>;
}

const createLedger = (): CallLedger => ({ calls: [], outside: [], labels: new WeakMap() });

type Implementation = (...args: never[]) => unknown;

/** `get`以外の全ての操作（存在確認・列挙・変更・prototype参照など）を`outside`へ記録するhandler。 */
const recordingTraps = (ledger: CallLedger, label: string): ProxyHandler<object> => {
    const record = (operation: string, property?: string | symbol): void => {
        ledger.outside.push(`${label}:${operation}${property === undefined ? '' : `.${String(property)}`}`);
    };
    return {
        has: (_, property) => {
            record('has', property);
            return false;
        },
        set: (_, property) => {
            record('set', property);
            return false;
        },
        ownKeys: () => {
            record('ownKeys');
            return [];
        },
        getOwnPropertyDescriptor: (_, property) => {
            record('getOwnPropertyDescriptor', property);
            return undefined;
        },
        defineProperty: (_, property) => {
            record('defineProperty', property);
            return false;
        },
        deleteProperty: (_, property) => {
            record('deleteProperty', property);
            return false;
        },
        getPrototypeOf: () => {
            record('getPrototypeOf');
            return null;
        },
    };
};

const describeArgument = (ledger: CallLedger, value: unknown): string =>
    typeof value === 'number' ? String(value) : (ledger.labels.get(value as object) ?? 'unknown');

/**
 * 宣言したfield以外の参照・列挙・変更を`outside`へ記録する結果object。
 * `then`の参照は`await`が行うので記録しない。
 */
const createResult = (ledger: CallLedger, label: string, value: Record<string, unknown>): object =>
    new Proxy(Object.create(null) as object, {
        ...recordingTraps(ledger, label),
        get: (_, property) => {
            if (property === 'then') return undefined;
            if (typeof property === 'string' && Object.hasOwn(value, property)) return value[property];
            ledger.outside.push(`${label}:get.${String(property)}`);
            return undefined;
        },
    });

/** 宣言したmethodの呼び出しを`calls`へ記録し、それ以外の全ての操作を`outside`へ記録するport。 */
const createPort = (ledger: CallLedger, name: string, implementations: Record<string, Implementation>): object =>
    new Proxy(Object.create(null) as object, {
        ...recordingTraps(ledger, name),
        get: (_, property) => {
            if (typeof property !== 'string' || !Object.hasOwn(implementations, property)) {
                ledger.outside.push(`${name}:get.${String(property)}`);
                return undefined;
            }
            return (...args: never[]) => {
                ledger.calls.push(`${name}.${property}(${args.map(arg => describeArgument(ledger, arg)).join(',')})`);
                const result = implementations[property](...args);
                if (result instanceof Promise) {
                    return result.then(value =>
                        typeof value === 'object' && value !== null
                            ? createResult(ledger, `${name}.${property} result`, value as Record<string, unknown>)
                            : value,
                    );
                }
                return result;
            };
        },
    });

/** 参照・列挙・変更・prototype参照など、中身を調べる操作を全て`outside`へ記録するopaque token。 */
const createToken = (ledger: CallLedger, label: string): object => {
    const opaque = new Proxy(Object.create(null) as object, {
        ...recordingTraps(ledger, label),
        get: (_, property) => {
            ledger.outside.push(`${label}:get.${String(property)}`);
            return undefined;
        },
    });
    ledger.labels.set(opaque, label);
    return opaque;
};

const recordingPort = (ledger: CallLedger, hasReservation: boolean): object =>
    createPort(ledger, 'recording', {
        hasReservation: () => hasReservation,
        requestCancellationForDeletion: async () => undefined,
    });

const parentCalls = (
    recordedId: number,
    recording: { reserveId: number; held: boolean } | null,
    token: string,
): string[] => [
    `recorded.prepareUserDeletion(${recordedId})`,
    ...(recording === null
        ? []
        : [
              `recording.hasReservation(${recording.reserveId})`,
              ...(recording.held ? [`recording.requestCancellationForDeletion(${recording.reserveId})`] : []),
          ]),
    `recorded.deletePrepared(${token})`,
];

describe('user deletion coordination touches only the injected ports', () => {
    it.each([
        ['a non-recording recorded program', false, null, false, null],
        ['a recording program without a reserve ID', true, null, true, null],
        ['a recording program whose reservation is held', true, 602, true, { reserveId: 602, held: true }],
        ['a recording program whose reservation is gone', true, 602, false, { reserveId: 602, held: false }],
    ] as const)(
        '[PRIMARY WC-5.10][WC-5.10] hands the prepared opaque token to final deletion and performs no other operation for %s',
        async (_, isRecording, reserveId, hasReservation, recording) => {
            const ledger = createLedger();
            const token = createToken(ledger, 'token');
            const deleted: object[] = [];
            const recorded = createPort(ledger, 'recorded', {
                prepareUserDeletion: async () => ({ status: 'prepared', isRecording, reserveId, token }),
                deletePrepared: async (given: object) => {
                    deleted.push(given);
                },
            });
            const coordinator = new ParentUserDeletionCoordinator(
                recorded as never,
                recordingPort(ledger, hasReservation) as never,
            );

            await coordinator.deleteFromRequest(601);

            expect(ledger.calls).toEqual(parentCalls(601, recording, 'token'));
            expect(deleted).toHaveLength(1);
            expect(deleted[0]).toBe(token);
            expect(ledger.outside).toEqual([]);
        },
    );

    it.each([
        ['not-found', 'RecordedIdIsNotFound'],
        ['protected', 'RecordedIsProtected'],
    ] as const)(
        '[WC-5.10] rejects a %s preparation without any operation beyond the preparation request',
        async (status, message) => {
            const ledger = createLedger();
            const recorded = createPort(ledger, 'recorded', {
                prepareUserDeletion: async () => ({ status }),
                deletePrepared: async () => undefined,
            });
            const coordinator = new ParentUserDeletionCoordinator(
                recorded as never,
                recordingPort(ledger, true) as never,
            );

            await expect(coordinator.deleteFromRequest(601)).rejects.toThrow(message);

            expect(ledger.calls).toEqual(['recorded.prepareUserDeletion(601)']);
            expect(ledger.outside).toEqual([]);
        },
    );

    it('[WC-5.10] does not serialize or deduplicate concurrent deletions of the same and different recordings', async () => {
        const ledger = createLedger();
        const tokens = [createToken(ledger, 'token1'), createToken(ledger, 'token2'), createToken(ledger, 'token3')];
        const first = deferred<object>();
        let prepared = 0;
        const deleted: object[] = [];
        const recorded = createPort(ledger, 'recorded', {
            prepareUserDeletion: async () => {
                const index = prepared;
                prepared += 1;
                if (index === 0) return first.promise;
                return preparedWith(tokens[index], false, null);
            },
            deletePrepared: async (given: object) => {
                deleted.push(given);
            },
        });
        const coordinator = new ParentUserDeletionCoordinator(recorded as never, recordingPort(ledger, true) as never);

        const operations = [
            coordinator.deleteFromRequest(601),
            coordinator.deleteFromRequest(601),
            coordinator.deleteFromRequest(602),
        ];
        await vi.waitFor(() =>
            expect(ledger.calls).toEqual([
                'recorded.prepareUserDeletion(601)',
                'recorded.prepareUserDeletion(601)',
                'recorded.prepareUserDeletion(602)',
            ]),
        );
        await vi.waitFor(() => expect(deleted).toHaveLength(2));
        expect(deleted.includes(tokens[0])).toBe(false);

        first.resolve(preparedWith(tokens[0], false, null));
        await Promise.all(operations);

        expect(deleted).toHaveLength(3);
        for (const token of tokens) expect(deleted.filter(given => given === token).length).toBe(1);
        expect(ledger.outside).toEqual([]);
    });

    it('[WC-5.10] the service child performs only the Encode cancellation and the deletion request', async () => {
        const ledger = createLedger();
        const encoding = createPort(ledger, 'encoding', { cancelEncodeByRecordedId: async () => undefined });
        const request = createPort(ledger, 'request', { requestUserDeletion: async () => undefined });
        const coordinator = new ServiceChildUserDeletionCoordinator(encoding as never, request as never);

        await coordinator.deleteByUser(611);

        expect(ledger.calls).toEqual(['encoding.cancelEncodeByRecordedId(611)', 'request.requestUserDeletion(611)']);
        expect(ledger.outside).toEqual([]);
    });
});

type Status = 'not-found' | 'protected';
interface WholePreparation {
    readonly kind: 'prepared' | Status;
    readonly isRecording?: boolean;
    readonly reserveId?: number | null;
    readonly held?: boolean;
}

interface VideoScenario {
    readonly videoPrepare: 'prepared' | Status | 'whole';
    readonly videoFinal?: 'video-file-deleted' | Status | 'whole';
    readonly whole?: WholePreparation;
}

const preparedWith = (token: object, isRecording?: boolean, reserveId?: number | null) => ({
    status: 'prepared',
    isRecording,
    reserveId,
    token,
});

const runVideoScenario = async (scenario: VideoScenario) => {
    const ledger = createLedger();
    const videoToken = createToken(ledger, 'videoToken');
    const wholeToken = createToken(ledger, 'wholeToken');
    const videoDeleted: object[] = [];
    const wholeDeleted: object[] = [];
    const video = createPort(ledger, 'video', {
        prepareVideoFileDeletion: async () =>
            scenario.videoPrepare === 'prepared'
                ? preparedWith(videoToken)
                : scenario.videoPrepare === 'whole'
                  ? { status: 'whole-recorded-deletion-required', recordedId: 713 }
                  : { status: scenario.videoPrepare },
        deletePreparedVideoFile: async (given: object) => {
            videoDeleted.push(given);
            return scenario.videoFinal === 'whole'
                ? { status: 'whole-recorded-deletion-required', recordedId: 713 }
                : { status: scenario.videoFinal };
        },
    });
    const whole = scenario.whole ?? { kind: 'prepared', isRecording: false, reserveId: null };
    const recorded = createPort(ledger, 'recorded', {
        prepareUserDeletion: async () =>
            whole.kind === 'prepared'
                ? preparedWith(wholeToken, whole.isRecording, whole.reserveId)
                : { status: whole.kind },
        deletePrepared: async (given: object) => {
            wholeDeleted.push(given);
        },
    });
    const coordinator = new ParentVideoFileDeletionCoordinator(
        video,
        recorded,
        recordingPort(ledger, whole.held ?? true),
    );
    const error = await coordinator.deleteVideoFileFromRequest(712).then(
        () => null,
        (caught: unknown) => (caught as Error).message,
    );
    return { ledger, videoToken, wholeToken, videoDeleted, wholeDeleted, error };
};

describe('video file deletion coordination touches only the injected ports', () => {
    const prepare = 'video.prepareVideoFileDeletion(712)';
    const final = 'video.deletePreparedVideoFile(videoToken)';
    const wholePrepare = 'recorded.prepareUserDeletion(713)';
    const wholeDelete = 'recorded.deletePrepared(wholeToken)';
    const recordingHeld = ['recording.hasReservation(714)', 'recording.requestCancellationForDeletion(714)'];

    it.each([
        ['an initial not-found', { videoPrepare: 'not-found' }, [prepare], 'VideoFileIsNotFound'],
        ['an initial protected', { videoPrepare: 'protected' }, [prepare], 'RecordedIsProtected'],
        [
            'a final not-found',
            { videoPrepare: 'prepared', videoFinal: 'not-found' },
            [prepare, final],
            'VideoFileIsNotFound',
        ],
        [
            'a final protected',
            { videoPrepare: 'prepared', videoFinal: 'protected' },
            [prepare, final],
            'RecordedIsProtected',
        ],
        [
            'a fresh whole preparation that is not-found',
            { videoPrepare: 'whole', whole: { kind: 'not-found' } },
            [prepare, wholePrepare],
            'RecordedIdIsNotFound',
        ],
        [
            'a fresh whole preparation that is protected',
            { videoPrepare: 'whole', whole: { kind: 'protected' } },
            [prepare, wholePrepare],
            'RecordedIsProtected',
        ],
        [
            'a final whole-required followed by a not-found fresh preparation',
            { videoPrepare: 'prepared', videoFinal: 'whole', whole: { kind: 'not-found' } },
            [prepare, final, wholePrepare],
            'RecordedIdIsNotFound',
        ],
        [
            'a final whole-required followed by a protected fresh preparation',
            { videoPrepare: 'prepared', videoFinal: 'whole', whole: { kind: 'protected' } },
            [prepare, final, wholePrepare],
            'RecordedIsProtected',
        ],
    ] as readonly (readonly [string, VideoScenario, string[], string])[])(
        '[WC-5.10] rejects %s without any operation beyond the declared ports',
        async (_, scenario, expectedCalls, message) => {
            const { ledger, wholeDeleted, error } = await runVideoScenario(scenario);

            expect(error).toBe(message);
            expect(ledger.calls).toEqual(expectedCalls);
            expect(wholeDeleted).toEqual([]);
            expect(ledger.outside).toEqual([]);
        },
    );

    it.each([
        [
            'an individual deletion',
            { videoPrepare: 'prepared', videoFinal: 'video-file-deleted' },
            [prepare, final],
            true,
            false,
        ],
        [
            'an initial whole-required decision',
            { videoPrepare: 'whole' },
            [prepare, wholePrepare, wholeDelete],
            false,
            true,
        ],
        [
            'an initial whole-required decision for a recording whose reservation is held',
            { videoPrepare: 'whole', whole: { kind: 'prepared', isRecording: true, reserveId: 714, held: true } },
            [prepare, wholePrepare, ...recordingHeld, wholeDelete],
            false,
            true,
        ],
        [
            'a final whole-required decision',
            { videoPrepare: 'prepared', videoFinal: 'whole' },
            [prepare, final, wholePrepare, wholeDelete],
            true,
            true,
        ],
        [
            'a final whole-required decision for a recording whose reservation is held',
            {
                videoPrepare: 'prepared',
                videoFinal: 'whole',
                whole: { kind: 'prepared', isRecording: true, reserveId: 714, held: true },
            },
            [prepare, final, wholePrepare, ...recordingHeld, wholeDelete],
            true,
            true,
        ],
    ] as readonly (readonly [string, VideoScenario, string[], boolean, boolean])[])(
        '[WC-5.10] hands each opaque token to its own deletion for %s and performs no other operation',
        async (_, scenario, expectedCalls, usesVideoToken, usesWholeToken) => {
            const { ledger, videoToken, wholeToken, videoDeleted, wholeDeleted, error } =
                await runVideoScenario(scenario);

            expect(error).toBeNull();
            expect(ledger.calls).toEqual(expectedCalls);
            expect(videoDeleted).toHaveLength(usesVideoToken ? 1 : 0);
            if (usesVideoToken) expect(videoDeleted[0]).toBe(videoToken);
            expect(wholeDeleted).toHaveLength(usesWholeToken ? 1 : 0);
            if (usesWholeToken) expect(wholeDeleted[0]).toBe(wholeToken);
            expect(ledger.outside).toEqual([]);
        },
    );
});
