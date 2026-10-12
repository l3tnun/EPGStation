import { describe, expect, it, vi } from 'vitest';

import { makeModel } from './_harness';

describe('startup tuner snapshot', () => {
    it('[RM-AUX-6.1][Task 8.3] synchronously derives broadcast status from the startup snapshot', () => {
        const harness = makeModel();

        const result = harness.model.setTuners([{ types: ['GR'] }, { types: ['BS', 'CS'] }]);

        expect(result).toBeUndefined();
        expect(harness.model.getBroadcastStatus()).toEqual({
            GR: true,
            BS: true,
            CS: true,
            SKY: false,
            BS4K: false,
        });
    });

    // .kiro/specs/server-tuner-access/design.mdの正規化規則: TunerInfo.typesは任意のserver定義文字列を
    // 含み得る（getTuners()は解析失敗にしない）。setTuners()（ReservationManageModel.ts）はbroadcastStatus
    // の既知5 key（GR/BS/CS/SKY/BS4K）をfor-inで走査するため、BS4K対応tunerがあればBS4Kがtrueになる一方、
    // それ以外の未知種別（例: WOWOW-4K）には新しいkeyを増やさない（v2のTunerと同じ設計）。
    it('[RM-AUX-6.1] sets broadcast status BS4K true for a BS4K-capable tuner, and adds no new key for a genuinely unknown tuner type', () => {
        const harness = makeModel();

        const result = harness.model.setTuners([
            { types: ['GR'] },
            { types: ['BS4K'] },
            { types: ['WOWOW-4K'] },
        ]);

        expect(result).toBeUndefined();
        expect(harness.model.getBroadcastStatus()).toEqual({
            GR: true,
            BS: false,
            CS: false,
            SKY: false,
            BS4K: true,
        });
    });

    // BS4K対応tunerが1台も無い場合はBS4Kがfalseのままであること（既存4種別の挙動と対等）。
    it('[RM-AUX-6.1] keeps broadcast status BS4K false when no tuner reports the BS4K type', () => {
        const harness = makeModel();

        const result = harness.model.setTuners([{ types: ['GR'] }, { types: ['WOWOW-4K'] }]);

        expect(result).toBeUndefined();
        expect(harness.model.getBroadcastStatus()).toEqual({
            GR: true,
            BS: false,
            CS: false,
            SKY: false,
            BS4K: false,
        });
    });

    it('[RM-AUX-6.1/RM-AUX-6.7/RM-AUX-8.7][Task 8.3] does not reread, replan, persist, notify, or dynamically refresh after caller input changes', async () => {
        const harness = makeModel();
        const replan = vi.spyOn(harness.model, 'updateAll');
        const types = ['SKY'];

        expect(harness.model.setTuners([{ types }])).toBeUndefined();
        types.splice(0, types.length);
        await Promise.resolve();

        expect(harness.model.getBroadcastStatus()).toEqual({
            GR: false,
            BS: false,
            CS: false,
            SKY: true,
            BS4K: false,
        });
        expect(replan).not.toHaveBeenCalled();
        expect(harness.execution.getExecution).not.toHaveBeenCalled();
        expect(harness.reserveDB.findLists).not.toHaveBeenCalled();
        expect(harness.reserveDB.findTimeRanges).not.toHaveBeenCalled();
        expect(harness.reserveDB.updateMany).not.toHaveBeenCalled();
        expect(harness.reserveEvent.emitUpdated).not.toHaveBeenCalled();
    });
});
