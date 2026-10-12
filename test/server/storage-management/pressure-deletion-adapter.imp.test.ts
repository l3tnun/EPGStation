import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;

type Outcome = string;
const StoragePressureDeletionAdapter = (
    require(join(snapshot, 'model/operator/storage/StoragePressureDeletionAdapter.js')) as {
        default: new (
            recorded: unknown,
            recordingGate: unknown,
            serviceChildGate: unknown,
        ) => { deleteForStoragePressure(recordedId: number, storageName: string): Promise<Outcome> };
    }
).default;

// 呼び出し順を台帳に残すfake。gate/providerが返す値だけを差し替える。
const build = (options: { prepared?: boolean; recording?: unknown; service?: unknown; deleted?: Outcome }) => {
    const ledger: string[] = [];
    const preparedToken = { prepared: true };
    const recorded = {
        deletePreparedForStorage: async (token: unknown): Promise<Outcome> => {
            ledger.push(`delete:${token === preparedToken}`);
            return options.deleted ?? 'deleted';
        },
        prepareStorageDeletion: async (recordedId: number, storageName: string) => {
            ledger.push(`prepare:${recordedId}:${storageName}`);
            return options.prepared === false ? { status: 'busy' } : { status: 'prepared', token: preparedToken };
        },
    };
    const gate = (name: string, result: unknown) => ({
        releaseDeletion: (token: unknown) => {
            ledger.push(`release:${name}:${(token as { name?: string }).name}`);
        },
        tryAcquireDeletion: (recordedId: number) => {
            ledger.push(`acquire:${name}:${recordedId}`);
            return result;
        },
    });
    const adapter = new StoragePressureDeletionAdapter(
        recorded,
        gate('recording', options.recording ?? { token: { name: 'recording' } }),
        gate('service', options.service ?? { token: { name: 'service' } }),
    );
    return { adapter, ledger };
};

describe('[SM-6.2] pressure deletion adapter composes preparation and both exclusion gates', () => {
    it('deletes the prepared recorded and releases the service gate before the recording gate', async () => {
        const { adapter, ledger } = build({ deleted: 'deleted' });

        await expect(adapter.deleteForStoragePressure(5, 'synthetic-storage')).resolves.toBe('deleted');

        expect(ledger).toEqual([
            'prepare:5:synthetic-storage',
            'acquire:recording:5',
            'acquire:service:5',
            'delete:true',
            'release:service:service',
            'release:recording:recording',
        ]);
    });

    it('reports not-deleted without touching any gate when preparation is not prepared', async () => {
        const { adapter, ledger } = build({ prepared: false });

        await expect(adapter.deleteForStoragePressure(5, 'synthetic-storage')).resolves.toBe('not-deleted');

        expect(ledger).toEqual(['prepare:5:synthetic-storage']);
    });

    it.each([
        ['busy status', { status: 'busy' }],
        ['unknown status', { status: 'unknown' }],
        ['null token', { token: null }],
        ['non-object token', { token: 'synthetic-text' }],
    ])('reports not-deleted without deleting when the recording gate returns a %s', async (_name, recording) => {
        const { adapter, ledger } = build({ recording });

        await expect(adapter.deleteForStoragePressure(5, 'synthetic-storage')).resolves.toBe('not-deleted');

        expect(ledger).toEqual(['prepare:5:synthetic-storage', 'acquire:recording:5']);
    });

    it('releases the recording gate and does not delete when the service-child gate refuses', async () => {
        const { adapter, ledger } = build({ service: { status: 'busy' } });

        await expect(adapter.deleteForStoragePressure(5, 'synthetic-storage')).resolves.toBe('not-deleted');

        expect(ledger).toEqual([
            'prepare:5:synthetic-storage',
            'acquire:recording:5',
            'acquire:service:5',
            'release:recording:recording',
        ]);
    });
});
