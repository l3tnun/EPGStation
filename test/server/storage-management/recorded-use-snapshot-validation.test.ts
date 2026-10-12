import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface StorageRecordedUseSnapshotAdapterRuntime {
    getSnapshot(): Promise<unknown>;
}

interface StorageRecordedUseSnapshotAdapterConstructor {
    new (recording: unknown, serviceChild: unknown): StorageRecordedUseSnapshotAdapterRuntime;
}

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}
const StorageRecordedUseSnapshotAdapter = (
    require(join(compiledSnapshot, 'model', 'operator', 'storage', 'StorageRecordedUseSnapshotAdapter.js')) as {
        default: StorageRecordedUseSnapshotAdapterConstructor;
    }
).default;

const knownRecording = { recordedIds: new Set([1]), status: 'known' };
const knownServiceChild = { recordedIds: [2], status: 'known' };

const getSnapshot = (recording: unknown, serviceChild: unknown): Promise<unknown> =>
    new StorageRecordedUseSnapshotAdapter(
        { getActiveRecordedIds: () => recording },
        { requestSnapshot: async () => serviceChild },
    ).getSnapshot();

const invalidRecordedIds: ReadonlyArray<[string, unknown]> = [
    ['zero', 0],
    ['a negative number', -1],
    ['a fractional number', 1.5],
    ['a number beyond the safe integer range', Number.MAX_SAFE_INTEGER + 1],
    ['a numeric string', '5'],
    ['NaN', Number.NaN],
];

describe('storage recorded-use snapshot validation', () => {
    it('[SM-4.1-SNAPSHOT] reports unknown when the Recording provider returns undefined', async () => {
        await expect(getSnapshot(undefined, knownServiceChild)).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot resolves to undefined', async () => {
        await expect(getSnapshot(knownRecording, undefined)).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown for a non-object Recording snapshot of a primitive type', async () => {
        await expect(getSnapshot('known', knownServiceChild)).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the Recording snapshot carries recorded IDs but is not known', async () => {
        await expect(getSnapshot({ recordedIds: new Set([1]), status: 'unknown' }, knownServiceChild)).resolves.toEqual(
            { status: 'unknown' },
        );
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the Recording snapshot is known but its recorded IDs are not a Set', async () => {
        await expect(getSnapshot({ recordedIds: [1], status: 'known' }, knownServiceChild)).resolves.toEqual({
            status: 'unknown',
        });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when a known Recording snapshot has no recorded IDs', async () => {
        await expect(getSnapshot({ status: 'known' }, knownServiceChild)).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot carries recorded IDs but is not known', async () => {
        await expect(getSnapshot(knownRecording, { recordedIds: [2], status: 'unknown' })).resolves.toEqual({
            status: 'unknown',
        });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when the service-child snapshot is known but its recorded IDs are not an array', async () => {
        await expect(getSnapshot(knownRecording, { recordedIds: new Set([2]), status: 'known' })).resolves.toEqual({
            status: 'unknown',
        });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when a known service-child snapshot has no recorded IDs', async () => {
        await expect(getSnapshot(knownRecording, { status: 'known' })).resolves.toEqual({ status: 'unknown' });
    });

    it.each(invalidRecordedIds)(
        '[SM-4.1-SNAPSHOT] reports unknown when a Recording recorded ID is %s',
        async (_label, recordedId) => {
            await expect(
                getSnapshot({ recordedIds: new Set([recordedId]), status: 'known' }, knownServiceChild),
            ).resolves.toEqual({ status: 'unknown' });
        },
    );

    it.each(invalidRecordedIds)(
        '[SM-4.1-SNAPSHOT] reports unknown when a service-child recorded ID is %s',
        async (_label, recordedId) => {
            await expect(getSnapshot(knownRecording, { recordedIds: [recordedId], status: 'known' })).resolves.toEqual({
                status: 'unknown',
            });
        },
    );

    it('[SM-4.1-SNAPSHOT] reports unknown when only some of the Recording recorded IDs are valid', async () => {
        await expect(
            getSnapshot({ recordedIds: new Set([1, 0]), status: 'known' }, knownServiceChild),
        ).resolves.toEqual({ status: 'unknown' });
    });

    it('[SM-4.1-SNAPSHOT] reports unknown when only some of the service-child recorded IDs are valid', async () => {
        await expect(getSnapshot(knownRecording, { recordedIds: [2, 0], status: 'known' })).resolves.toEqual({
            status: 'unknown',
        });
    });

    it('[SM-4.1-SNAPSHOT] accepts the smallest valid recorded ID and the largest safe integer', async () => {
        await expect(
            getSnapshot(
                { recordedIds: new Set([1]), status: 'known' },
                { recordedIds: [Number.MAX_SAFE_INTEGER], status: 'known' },
            ),
        ).resolves.toEqual({ recordedIds: new Set([1, Number.MAX_SAFE_INTEGER]), status: 'known' });
    });

    it('[SM-4.1-SNAPSHOT] accepts known snapshots that hold no recorded IDs', async () => {
        await expect(
            getSnapshot({ recordedIds: new Set(), status: 'known' }, { recordedIds: [], status: 'known' }),
        ).resolves.toEqual({ recordedIds: new Set(), status: 'known' });
    });
});
