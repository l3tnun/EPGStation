import { describe, expect, it, vi } from 'vitest';

import { flushImmediate, makeSetter } from '../event-and-hook-delivery/_harness';

const settlements = [
    ['history resolves and update succeeds', 'resolve', 'resolve'],
    ['history resolves and update rejects', 'resolve', 'reject'],
    ['history rejects and update succeeds', 'reject', 'resolve'],
    ['history rejects and update rejects', 'reject', 'reject'],
] as const;

describe('EventSetter program and Rule workflow contract', () => {
    it.each(settlements)(
        '[PRIMARY WC-1.2][PRIMARY WC-1.3][PRIMARY WC-1.4][PRIMARY WC-1.5][WC-1.2][WC-1.3][WC-1.4][WC-1.5] awaits history cleanup before updateAll when %s',
        async (_label, historySettlement, updateSettlement) => {
            const historyFailure = new Error('synthetic history failure');
            const updateFailure = new Error('synthetic update failure');
            const ledger: string[] = [];
            const harness = makeSetter();
            harness.recordedManage.historyCleanup.mockImplementationOnce(() => {
                ledger.push('history');
                return historySettlement === 'resolve' ? Promise.resolve() : Promise.reject(historyFailure);
            });
            harness.recordedManage.historyCleanup.mockImplementationOnce(() => {
                ledger.push('history');
                return Promise.resolve();
            });
            harness.reservationManage.updateAll.mockImplementationOnce((isFirst: boolean) => {
                ledger.push(`update:${isFirst}`);
                return updateSettlement === 'resolve' ? Promise.resolve() : Promise.reject(updateFailure);
            });
            harness.reservationManage.updateAll.mockImplementationOnce((isFirst: boolean) => {
                ledger.push(`update:${isFirst}`);
                return Promise.resolve();
            });
            harness.setter.set();

            const first = harness.callbacks.epg.setUpdated();
            if (updateSettlement === 'reject') {
                await expect(first).rejects.toBe(updateFailure);
            } else {
                await expect(first).resolves.toBeUndefined();
            }
            await expect(harness.callbacks.epg.setUpdated()).resolves.toBeUndefined();

            expect(ledger).toEqual([
                'history',
                'update:true',
                'history',
                updateSettlement === 'resolve' ? 'update:false' : 'update:true',
            ]);
        },
    );

    it.each([
        ['added', 'setAdded', ['ui', 'update']],
        ['updated', 'setUpdated', ['ui', 'update']],
        ['enabled', 'setEnabled', ['ui', 'update']],
        ['disabled', 'setDisabled', ['ui', 'update']],
        ['deleted', 'setDeleted', ['ui', 'remove', 'update']],
    ] as const)(
        '[PRIMARY WC-1.6][PRIMARY WC-1.7][PRIMARY WC-1.10][WC-1.6][WC-1.7][WC-1.10] starts the selected destinations in order when a Rule is %s',
        (_kind, callback, expected) => {
            const ledger: string[] = [];
            const harness = makeSetter();
            harness.ipc.notifyClient.mockImplementation(() => ledger.push('ui'));
            harness.recordedManage.removeRuleId.mockImplementation(() => ledger.push('remove'));
            harness.reservationManage.updateRule.mockImplementation(() => ledger.push('update'));
            harness.setter.set();

            expect(harness.callbacks.rule[callback](41)).toBeUndefined();

            expect(ledger).toEqual(expected);
            expect(harness.ipc.notifyClient.mock.calls).toEqual([[]]);
            expect(harness.reservationManage.updateRule.mock.calls).toEqual([[41]]);
            if (callback === 'setDeleted') {
                expect(harness.recordedManage.removeRuleId.mock.calls).toEqual([[41]]);
            } else {
                expect(harness.recordedManage.removeRuleId).not.toHaveBeenCalled();
            }
        },
    );

    it('[PRIMARY WC-1.8][PRIMARY WC-1.9][WC-1.8][WC-1.9] records each detached Rule failure while later independent Rule work still starts once', async () => {
        const uiFailure = new Error('synthetic Rule UI rejection');
        const removeFailure = new Error('synthetic Rule relation failure');
        const updateFailure = new Error('synthetic Rule update rejection');
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        const ledger: string[] = [];
        const harness = makeSetter();
        harness.ipc.notifyClient.mockImplementation(() => {
            ledger.push('ui');
            return Promise.reject(uiFailure);
        });
        harness.recordedManage.removeRuleId.mockImplementation(() => {
            ledger.push('remove');
            throw removeFailure;
        });
        harness.reservationManage.updateRule.mockImplementation(() => {
            ledger.push('update');
            return Promise.reject(updateFailure);
        });
        harness.setter.set();
        process.prependListener('unhandledRejection', recordUnhandled);

        try {
            expect(harness.callbacks.rule.setDeleted(52)).toBeUndefined();
            await flushImmediate();

            expect(ledger).toEqual(['ui', 'remove', 'update']);
            expect(harness.ipc.notifyClient).toHaveBeenCalledOnce();
            expect(harness.recordedManage.removeRuleId).toHaveBeenCalledOnce();
            expect(harness.reservationManage.updateRule).toHaveBeenCalledOnce();
            expect(harness.logger.system.error.mock.calls).toContainEqual([uiFailure]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([removeFailure]);
            expect(harness.logger.system.error.mock.calls).toContainEqual([updateFailure]);
            expect(harness.logger.system.error).toHaveBeenCalledTimes(3);
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener('unhandledRejection', recordUnhandled);
        }
    });

    it('[PRIMARY WC-1.11][WC-1.11] forwards only the Rule identifier to reservation management without judging candidates, conflicts, or duplicate programs', () => {
        const reservationManage = {
            updateAll: vi.fn(),
            updateRule: vi.fn(),
            cancel: vi.fn(async () => undefined),
            addEventRelay: vi.fn(),
            acceptRuleCandidate: vi.fn(),
            resolveReservationConflict: vi.fn(),
            resolveDuplicateProgram: vi.fn(),
        };
        const harness = makeSetter({ reservationManage });
        harness.setter.set();

        expect(harness.callbacks.rule.setAdded(71)).toBeUndefined();
        expect(harness.callbacks.rule.setUpdated(72)).toBeUndefined();
        expect(harness.callbacks.rule.setEnabled(73)).toBeUndefined();
        expect(harness.callbacks.rule.setDisabled(74)).toBeUndefined();
        expect(harness.callbacks.rule.setDeleted(75)).toBeUndefined();

        expect(reservationManage.updateRule.mock.calls).toEqual([[71], [72], [73], [74], [75]]);
        expect(reservationManage.acceptRuleCandidate).not.toHaveBeenCalled();
        expect(reservationManage.resolveReservationConflict).not.toHaveBeenCalled();
        expect(reservationManage.resolveDuplicateProgram).not.toHaveBeenCalled();
    });
});
