import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

type Client = {
    acquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
};
type DeliveryLease = { release(): Promise<void> };
type DeliverySnapshot = { status: 'unknown' } | { status: 'known'; recordedIds: ReadonlySet<number> };

const packageRequire = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined || !isAbsolute(compiledSnapshot)) {
    throw new Error('Server test runner did not provide an absolute compiled snapshot');
}
const compiled = <T>(relativePath: string): T => packageRequire(join(compiledSnapshot, relativePath)) as T;
const compiledDefault = <T>(relativePath: string): T => compiled<{ default: T }>(relativePath).default;

const { set } = compiled<{ set(container: Container): void }>('model/ModelContainerSetter.js');
const EncodeManageModel = compiledDefault<new (...args: never[]) => object>(
    'model/service/encode/EncodeManageModel.js',
);
const EncodeFinishModel = compiledDefault<new (...args: never[]) => object>(
    'model/service/encode/EncodeFinishModel.js',
);
const RecordedDeliveryLeaseConsumer = compiledDefault<new (...args: never[]) => object>(
    'model/service/stream/recorded/RecordedDeliveryLeaseConsumer.js',
);
const ServiceChildRecordedUseRegistry = compiledDefault<new () => object>('model/ServiceChildRecordedUseRegistry.js');

const syntheticLogger = {
    getLogger: () => ({
        access: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
        encode: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
        stream: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
        system: { error: vi.fn(), fatal: vi.fn(), info: vi.fn() },
    }),
};

const createContainer = (): Container => {
    const container = new Container({ skipBaseClassChecks: true });
    set(container);
    container.rebind('ILoggerModel').toConstantValue(syntheticLogger);
    container.rebind('IConfiguration').toConstantValue({ getConfig: () => ({ concurrentEncodeNum: 1 }) });
    return container;
};

const createClient = (): Client => ({
    acquire: vi.fn(async () => ({ token: { id: 'synthetic-token' } })),
    release: vi.fn(async () => undefined),
});

const createIpcClient = (client: Client) => ({
    recordedResourceUseClient: client,
    recordedUseSnapshotHandlerRegistrationPort: { register: vi.fn() },
});

describe('ModelContainerSetter service-child recorded-use composition', () => {
    it('[AR-9.4] fails the encoding adapter with RecordedResourceUseClientNotBound until the IPC client is bound, then delegates', async () => {
        const container = createContainer();
        const adapter = container.get<{
            acquire(recordedId: number, kind: 'encoding'): Promise<{ token: object }>;
            bind(client: Client): void;
            release(token: object): Promise<void>;
        }>('EncodingRecordedResourceUsePort');
        const client = createClient();

        expect(() => adapter.acquire(5, 'encoding')).toThrow('RecordedResourceUseClientNotBound');
        expect(() => adapter.release({})).toThrow('RecordedResourceUseClientNotBound');

        adapter.bind(client);
        const lease = await adapter.acquire(5, 'encoding');
        await adapter.release(lease.token);

        expect(client.acquire).toHaveBeenCalledExactlyOnceWith(5, 'encoding');
        expect(client.release).toHaveBeenCalledExactlyOnceWith(lease.token);
        expect(container.get('EncodingRecordedResourceUsePort')).toBe(adapter);
    });

    it('[AR-9.4] fails the delivery adapter before binding and hands out a lease whose release reaches the client exactly once', async () => {
        const container = createContainer();
        const adapter = container.get<{
            acquire(recordedId: number, kind: 'delivery'): Promise<DeliveryLease>;
            bind(client: Client): void;
        }>('DeliveryRecordedResourceUsePort');
        const client = createClient();
        const token = { id: 'synthetic-delivery-token' };
        client.acquire.mockResolvedValue({ token });

        await expect(adapter.acquire(6, 'delivery')).rejects.toThrow('RecordedResourceUseClientNotBound');

        adapter.bind(client);
        const lease = await adapter.acquire(6, 'delivery');
        const firstRelease = lease.release();
        const secondRelease = lease.release();

        expect(secondRelease).toBe(firstRelease);
        await firstRelease;
        expect(client.acquire).toHaveBeenCalledExactlyOnceWith(6, 'delivery');
        expect(client.release).toHaveBeenCalledExactlyOnceWith(token);
    });

    it('[AR-9.4] reports an unknown delivery snapshot until the provider is bound and then delegates to it', () => {
        const container = createContainer();
        const staged = container.get<{
            bind(provider: { getActiveRecordedFileDeliveryIds(): DeliverySnapshot }): void;
            getActiveRecordedFileDeliveryIds(): DeliverySnapshot;
        }>('StagedDeliveryRecordedUseSnapshotProvider');
        const known: DeliverySnapshot = { recordedIds: new Set([8]), status: 'known' };

        expect(staged.getActiveRecordedFileDeliveryIds()).toEqual({ status: 'unknown' });

        staged.bind({ getActiveRecordedFileDeliveryIds: () => known });

        expect(staged.getActiveRecordedFileDeliveryIds()).toBe(known);
    });

    it('[AR-4.5] binds the adapters and registers one union snapshot handler, and ignores a second bind', () => {
        const container = createContainer();
        const encodingSnapshot = vi.fn(() => ({ recordedIds: new Set([1, 2]), status: 'known' }) as const);
        const deliverySnapshot = vi.fn((): DeliverySnapshot => ({ recordedIds: new Set([2, 3]), status: 'known' }));
        container.rebind('IEncodeManageModel').toConstantValue({ getQueuedAndRunningRecordedIds: encodingSnapshot });
        container
            .rebind('DeliveryRecordedUseSnapshotProvider')
            .toConstantValue({ getActiveRecordedFileDeliveryIds: deliverySnapshot });
        const composition = container.get<{ bind(ipcClient: unknown): void }>('ServiceChildRecordedUseComposition');
        const client = createClient();
        const ipcClient = createIpcClient(client);

        composition.bind(ipcClient);
        composition.bind(ipcClient);

        const register = ipcClient.recordedUseSnapshotHandlerRegistrationPort.register;
        expect(register).toHaveBeenCalledOnce();
        const handler = register.mock.calls[0]![0] as { getSnapshot(): unknown };
        expect(handler.getSnapshot()).toEqual({ recordedIds: [1, 2, 3], status: 'known' });
    });

    it('[AR-9.4] answers unknown when either the encoding or the delivery snapshot is unknown', () => {
        const container = createContainer();
        let encoding: unknown = { status: 'unknown' };
        let delivery: DeliverySnapshot = { recordedIds: new Set([4]), status: 'known' };
        container.rebind('IEncodeManageModel').toConstantValue({ getQueuedAndRunningRecordedIds: () => encoding });
        container
            .rebind('DeliveryRecordedUseSnapshotProvider')
            .toConstantValue({ getActiveRecordedFileDeliveryIds: () => delivery });
        const composition = container.get<{ bind(ipcClient: unknown): void }>('ServiceChildRecordedUseComposition');
        const ipcClient = createIpcClient(createClient());
        composition.bind(ipcClient);
        const handler = ipcClient.recordedUseSnapshotHandlerRegistrationPort.register.mock.calls[0]![0] as {
            getSnapshot(): unknown;
        };

        expect(handler.getSnapshot()).toEqual({ status: 'unknown' });

        encoding = { recordedIds: new Set([9]), status: 'known' };
        delivery = { status: 'unknown' };
        expect(handler.getSnapshot()).toEqual({ status: 'unknown' });
    });

    it('[AR-9.4] lets the composition route a delivery lease through the bound client and report it in the delivery snapshot', async () => {
        const container = createContainer();
        container.rebind('IEncodeManageModel').toConstantValue({
            getQueuedAndRunningRecordedIds: () => ({ recordedIds: new Set<number>(), status: 'known' }),
        });
        const composition = container.get<{ bind(ipcClient: unknown): void }>('ServiceChildRecordedUseComposition');
        const client = createClient();
        const ipcClient = createIpcClient(client);
        composition.bind(ipcClient);
        const handler = ipcClient.recordedUseSnapshotHandlerRegistrationPort.register.mock.calls[0]![0] as {
            getSnapshot(): unknown;
        };
        const observedDuringOpen: unknown[] = [];
        container.rebind('IRecordedPlaybackSourceProvider').toConstantValue({
            open: vi.fn(async () => {
                observedDuringOpen.push(handler.getSnapshot());
                throw new Error('synthetic open failure');
            }),
            resolveRecordedId: vi.fn(async () => 5),
        });
        const consumer = container.get<{ acquireAndOpen(videoFileId: number, playPosition: number): Promise<unknown> }>(
            'RecordedDeliveryLeaseConsumer',
        );

        await expect(consumer.acquireAndOpen(9, 0)).rejects.toThrow('synthetic open failure');

        expect(consumer).toBeInstanceOf(RecordedDeliveryLeaseConsumer);
        expect(client.acquire).toHaveBeenCalledExactlyOnceWith(5, 'delivery');
        expect(client.release).toHaveBeenCalledOnce();
        expect(observedDuringOpen).toEqual([{ recordedIds: [5], status: 'known' }]);
        expect(handler.getSnapshot()).toEqual({ recordedIds: [], status: 'known' });
        expect(container.get('RecordedDeliveryLeaseConsumer')).toBe(consumer);
    });

    it('[AR-9.4] builds the encode queue with the shared encoding adapter and shares its single instance', () => {
        const container = createContainer();
        const model = container.get<{
            getQueuedAndRunningRecordedIds(): unknown;
        }>('IEncodeManageModel');

        expect(model).toBeInstanceOf(EncodeManageModel);
        expect(model.getQueuedAndRunningRecordedIds()).toEqual({ recordedIds: new Set(), status: 'known' });
        expect((model as unknown as { recordedResourceUsePort: unknown }).recordedResourceUsePort).toBe(
            container.get('EncodingRecordedResourceUsePort'),
        );
        expect(container.get('IEncodeManageModel')).toBe(model);
    });

    it('[AR-9.4] binds the composition to the IPC client when the encode finish model is first resolved', () => {
        const container = createContainer();
        const ipcClient = createIpcClient(createClient());
        container.rebind('IIPCClient').toConstantValue(ipcClient);
        container.rebind('ISocketIOManageModel').toConstantValue({ notifyClient: vi.fn() });
        container.rebind('IEncodeManageModel').toConstantValue({
            getQueuedAndRunningRecordedIds: () => ({ recordedIds: new Set<number>(), status: 'known' }),
            setEncodeFinishModel: vi.fn(),
        });

        const finishModel = container.get('IEncodeFinishModel');

        expect(finishModel).toBeInstanceOf(EncodeFinishModel);
        expect(ipcClient.recordedUseSnapshotHandlerRegistrationPort.register).toHaveBeenCalledOnce();
        expect(container.get('IEncodeFinishModel')).toBe(finishModel);
        expect(ipcClient.recordedUseSnapshotHandlerRegistrationPort.register).toHaveBeenCalledOnce();
    });

    it('[AR-9.4] tracks deliveries in one shared registry that the snapshot provider reads', () => {
        const container = createContainer();
        const registry = container.get<{ register(recordedId: number): { release(): void } }>(
            'ActiveRecordedDeliveryRegistry',
        );
        const provider = container.get<{ getActiveRecordedFileDeliveryIds(): DeliverySnapshot }>(
            'DeliveryRecordedUseSnapshotProvider',
        );

        const registration = registry.register(12);
        expect(provider.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set([12]), status: 'known' });
        registration.release();

        expect(provider.getActiveRecordedFileDeliveryIds()).toEqual({ recordedIds: new Set(), status: 'known' });
        expect(container.get('ActiveRecordedDeliveryRegistry')).toBe(registry);
        expect(container.get('DeliveryRecordedUseSnapshotProvider')).toBe(provider);
    });

    it('[AR-5.2] registers each service peer with the child-use registry in addition to the IPC server', () => {
        const container = createContainer();
        container.rebind('IReservationManageModel').toConstantValue({});
        container.rebind('IRecordedManageModel').toConstantValue({});
        container.rebind('IRecordedTagManadeModel').toConstantValue({});
        container.rebind('IRuleManageModel').toConstantValue({});
        container.rebind('IThumbnailManageModel').toConstantValue({});
        container.rebind('IRecordingManageModel').toConstantValue({});
        container
            .rebind('IConfiguration')
            .toConstantValue({ getConfig: () => ({ uploadTempDir: 'synthetic-upload' }) });
        const ipcServer = container.get<{ register(child: unknown): void }>('IIPCServer');
        const registry = container.get<{
            acquire(input: object): { status: string };
        }>('ServiceChildRecordedUseRegistry');
        const child = Object.assign(new EventEmitter(), { send: vi.fn() });

        ipcServer.register(child);

        expect(registry).toBeInstanceOf(ServiceChildRecordedUseRegistry);
        expect(registry.acquire({ kind: 'delivery', recordedId: 3, requestId: 1, senderPeer: child })).toEqual({
            status: 'granted',
        });
        expect(container.get('ServiceChildRecordedUseRegistry')).toBe(registry);
    });

    it.each([
        ['RecorderModelProvider', 'IRecorderModel'],
        ['EncoderModelProvider', 'IEncoderModel'],
        ['LiveStreamModelProvider', 'LiveStreamModel'],
        ['LiveHLSStreamModelProvider', 'LiveHLSStreamModel'],
        ['RecordedStreamModelProvider', 'RecordedStreamModel'],
        ['RecordedHLSStreamModelProvider', 'RecordedHLSStreamModel'],
    ])(
        '[AR-9.4] %s resolves a model on every call and rejects with the resolution error',
        async (providerKey, modelKey) => {
            const container = createContainer();
            const model = { name: `synthetic-${modelKey}` };
            container.rebind(modelKey).toConstantValue(model);
            const provider = container.get<() => Promise<unknown>>(providerKey);

            await expect(provider()).resolves.toBe(model);

            const failure = new Error(`synthetic ${modelKey} resolution failure`);
            container.rebind(modelKey).toDynamicValue(() => {
                throw failure;
            });
            await expect(provider()).rejects.toBe(failure);
        },
    );
});
