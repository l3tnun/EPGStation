import { describe, expect, it } from 'vitest';

import { compiled, logger } from './_media-harness';

const HlsStreamIdAllocator = compiled<any>(
    'model',
    'service',
    'stream',
    'manager',
    'HlsStreamIdAllocator.js',
).default;

const newAllocator = (): any => new HlsStreamIdAllocator({ getLogger: () => logger() });

/**
 * streamId を巡回カーソルで採番する `reserve` の境界。カーソルが `Number.MAX_SAFE_INTEGER` に
 * 達したときは 0 へ折り返し、折り返した先で使用中の id を距離順（折り返し後の小さい順）に飛ばす。
 */
describe('HlsStreamIdAllocator cursor wrap-around (unittest/imp)', () => {
    it('[R2-HLSSTREAMIDALLOCATOR-WRAP] skips the occupied ids after wrapping from MAX_SAFE_INTEGER in ascending order', () => {
        const allocator = newAllocator();
        allocator.release(Number.MAX_SAFE_INTEGER - 1);

        // 使用中の id を昇順でない順に渡しても、カーソル(MAX_SAFE_INTEGER)から近い順に 0, 1 と飛ばして 2 を採る。
        const reserved = allocator.reserve([1, 0, Number.MAX_SAFE_INTEGER], new Set<number>());

        expect(reserved).toBe(2);
    });

    it('[R2-HLSSTREAMIDALLOCATOR-WRAP] wraps the cursor to 0 after the id MAX_SAFE_INTEGER is reserved', () => {
        const allocator = newAllocator();
        allocator.release(Number.MAX_SAFE_INTEGER - 1);

        expect(allocator.reserve([], new Set<number>())).toBe(Number.MAX_SAFE_INTEGER);
        expect(allocator.reserve([], new Set<number>())).toBe(0);
    });

    it('[R2-HLSSTREAMIDALLOCATOR-WRAP] skips consecutive occupied ids that are given out of order', () => {
        const allocator = newAllocator();

        expect(allocator.reserve([2, 0, 1], new Set<number>())).toBe(3);
    });
});
