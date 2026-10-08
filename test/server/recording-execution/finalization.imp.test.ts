import { describe, expect, it, vi } from 'vitest';
import { makeRecorder, makeReserve } from './_harness';

describe('recording finalizer resource ownership', () => {
    it('[Task 5.1/6.1] ends the writer once while destroying the active stream', () => {
        const harness = makeRecorder();
        const stream = { unpipe: vi.fn(), destroy: vi.fn(), push: vi.fn(), removeAllListeners: vi.fn() };
        const writer = { removeAllListeners: vi.fn(), end: vi.fn() };
        harness.model.reserve = makeReserve();
        harness.model.stream = stream;
        harness.model.recFile = writer;
        harness.model.destroyStream();
        expect(stream.destroy).toHaveBeenCalledOnce();
        expect(writer.end).toHaveBeenCalledOnce();
        expect(harness.model.stream).toBeNull();
    });
});
