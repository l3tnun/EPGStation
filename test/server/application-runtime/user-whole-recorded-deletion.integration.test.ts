import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeContainer, createSyntheticChild, loadDefault } from './_runtime-harness';

interface RecordedApiModelConstructor {
    new (
        ipc: { recorded: { delete(recordedId: number): Promise<void> } },
        recordedDB: unknown,
        encodeManage: { cancelEncodeByRecordedId(recordedId: number): Promise<void> },
        recordedItemUtil: unknown,
    ): { delete(recordedId: number): Promise<void> };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('user whole-recorded deletion Runtime composition', () => {
    it(
        '[AR-4.3] service-pm-parent-prepared-final-delete binds the Service child coordinator to its outbound port ' +
            'and the existing PM carrier dispatch to the same parent coordinator provider ports exactly once',
        async () => {
            // Part A: production wiring (RecordedApiModel.delete, the real Service child HTTP handler's own
            // production entry point) -> service coordinator -> outbound port. The coordinator's internal
            // encode-cancel-then-outbound-call order is owner-tested
            // (workflow-coordination/imp/workflow-characteristics.test.ts:224-239 against the real
            // RecordedApiModel.prototype) and is intentionally not re-asserted here.
            const RecordedApiModel = loadDefault<RecordedApiModelConstructor>('model/api/recorded/RecordedApiModel.js');
            const requestUserDeletion = vi.fn(async (_recordedId: number) => undefined);
            const recordedApiModel = new RecordedApiModel(
                { recorded: { delete: requestUserDeletion } },
                {},
                { cancelEncodeByRecordedId: vi.fn(async () => undefined) },
                {},
            );

            await recordedApiModel.delete(41);

            expect(requestUserDeletion).toHaveBeenCalledOnce();
            expect(requestUserDeletion).toHaveBeenCalledWith(41);

            // Part B: existing PM carrier -> parent handler adapter -> parent coordinator -> provider ports.
            const container = buildRuntimeContainer();
            const parentLedger: string[] = [];
            const token = Object.freeze({ recordedId: 41 });
            const recordedManage = {
                deletePrepared: vi.fn(async (suppliedToken: object) => {
                    expect(suppliedToken).toBe(token);
                    parentLedger.push('deletePrepared:41');
                }),
                prepareUserDeletion: vi.fn(async (recordedId: number) => {
                    parentLedger.push(`prepareUserDeletion:${recordedId}`);
                    return { isRecording: true, reserveId: 7, status: 'prepared' as const, token };
                }),
            };
            const recordingManage = {
                cancelForDeletion: vi.fn(async (reserveId: number) => {
                    parentLedger.push(`cancelForDeletion:${reserveId}`);
                }),
                hasReserve: vi.fn((reserveId: number) => {
                    parentLedger.push(`hasReserve:${reserveId}`);
                    return true;
                }),
            };
            container.rebind('IRecordedManageModel').toConstantValue(recordedManage);
            container.rebind('IRecordingManageModel').toConstantValue(recordingManage);

            const ipcServer = container.get<{
                register(child: unknown): void;
            }>('IIPCServer');
            // Singleton DI binding: repeated resolution never constructs a second parent handler adapter/coordinator.
            expect(container.get('IIPCServer')).toBe(ipcServer);

            const child = createSyntheticChild(9_001);
            ipcServer.register(child);
            // Re-registering the same peer must not accumulate a second message listener (zero duplicate binding).
            ipcServer.register(child);
            expect(child.listenerCount('message')).toBe(1);

            child.emit('message', { args: { recordedId: 41 }, func: 'delete', id: 501, model: 'recorded' });
            await vi.waitFor(() => expect(child.send).toHaveBeenCalledOnce(), { interval: 0 });

            expect(parentLedger).toEqual([
                'prepareUserDeletion:41',
                'hasReserve:7',
                'cancelForDeletion:7',
                'deletePrepared:41',
            ]);
            expect(recordedManage.prepareUserDeletion).toHaveBeenCalledOnce();
            expect(recordedManage.deletePrepared).toHaveBeenCalledOnce();
            expect(recordingManage.hasReserve).toHaveBeenCalledOnce();
            expect(recordingManage.cancelForDeletion).toHaveBeenCalledOnce();
            // The reply-carries-requester-id contract is PM owner-tested
            // (process-messaging/imp/dispatcher-peer.test.ts:20-55); a single request here adds no information
            // beyond "exactly one reply was sent", already asserted above.
            expect(child.send).toHaveBeenCalledOnce();

            // Releasing the peer must leave zero residual message-dispatch listeners on the synthetic transport
            // (no leaked binding of the parent handler adapter's own request channel).
            ipcServer.register(createSyntheticChild(9_002));
            expect(child.listenerCount('message')).toBe(0);
        },
    );
});
