import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface DateUtilModule {
    getJaDate: (localDate: Date) => Date;
}

async function loadDateUtil(): Promise<DateUtilModule> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'DateUtil.js'));
    const { default: DateUtil } = (await import(moduleUrl.href)) as { default: DateUtilModule };
    return DateUtil;
}

describe('[IMP-CHAR-SF-3] DateUtil.getJaDate compatible output', () => {
    it('shifts an arbitrary local Date to a UTC+9 wall-clock instant', async () => {
        // Pinned (not the ambient host TZ) so the expected literal below is portable across CI
        // environments, and chosen so the local-vs-JST offset does not cancel to zero (which would
        // let an identity/no-op implementation coincidentally pass).
        const originalTimezone = process.env.TZ;
        process.env.TZ = 'UTC';
        try {
            const DateUtil = await loadDateUtil();
            const localDate = new Date(2026, 6, 30, 9, 7, 4);

            const jaDate = DateUtil.getJaDate(localDate);

            // `DateUtil.format` (the only production consumer) reads `jaDate` through these same
            // local (non-UTC) getters -- this is a literal, hardcoded JST wall-clock expectation,
            // not a recomputation of the implementation's own offset formula.
            expect(jaDate.getFullYear()).toBe(2026);
            expect(jaDate.getMonth()).toBe(6);
            expect(jaDate.getDate()).toBe(30);
            expect(jaDate.getHours()).toBe(18);
            expect(jaDate.getMinutes()).toBe(7);
            expect(jaDate.getSeconds()).toBe(4);
        } finally {
            if (originalTimezone === undefined) delete process.env.TZ;
            else process.env.TZ = originalTimezone;
        }
    });
});
