import { describe, expect, it } from 'vitest';
import { load, makeReserve } from './_harness';

const Tuner = load<new (tuner: { types: string[] }) => any>('model', 'operator', 'reservation', 'Tuner.js');

describe('tuner assignment simulation', () => {
    it('[RM-6.1] accepts the first reservation on a freshly created tuner that supports the channel type', () => {
        const tuner = new Tuner({ types: ['GR'] });

        expect(tuner.add(makeReserve({ id: 1, channelType: 'GR', channel: 'chan-a' }))).toBe(true);
        expect(tuner.reserves).toHaveLength(1);
    });

    it('[RM-6.1] accepts a second reservation only on the channel already held and rejects another channel', () => {
        const tuner = new Tuner({ types: ['GR'] });

        expect(tuner.add(makeReserve({ id: 1, channelType: 'GR', channel: 'chan-a' }))).toBe(true);
        expect(tuner.add(makeReserve({ id: 2, channelType: 'GR', channel: 'chan-a' }))).toBe(true);
        expect(tuner.add(makeReserve({ id: 3, channelType: 'GR', channel: 'chan-b' }))).toBe(false);
        expect(tuner.reserves).toHaveLength(2);
    });

    it('[RM-6.1] rejects a channel type the tuner does not support even when it is empty', () => {
        const tuner = new Tuner({ types: ['GR'] });

        expect(tuner.add(makeReserve({ id: 1, channelType: 'BS', channel: 'chan-a' }))).toBe(false);
        expect(tuner.reserves).toHaveLength(0);
    });

    it('[RM-6.1] frees the tuner for another channel after clear', () => {
        const tuner = new Tuner({ types: ['GR'] });
        tuner.add(makeReserve({ id: 1, channelType: 'GR', channel: 'chan-a' }));

        tuner.clear();

        expect(tuner.add(makeReserve({ id: 2, channelType: 'GR', channel: 'chan-b' }))).toBe(true);
    });
});
