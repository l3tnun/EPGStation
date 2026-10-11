import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

interface DateUtilModule {
    format: (date: Date, formatStr: string) => string;
    getJaDate: (localDate: Date) => Date;
}

async function loadDateUtil(): Promise<DateUtilModule> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'DateUtil.js'));
    const { default: DateUtil } = (await import(moduleUrl.href)) as { default: DateUtilModule };
    return DateUtil;
}

describe('[IMP-CHAR-SF-3] DateUtil.format compatible output', () => {
    it('substitutes yyyy/MM/dd hh:mm:ss with zero-padded local date parts', async () => {
        const DateUtil = await loadDateUtil();
        const date = new Date(2026, 6, 30, 9, 7, 4);

        expect(DateUtil.format(date, 'yyyy/MM/dd hh:mm:ss')).toBe('2026/07/30 09:07:04');
    });

    it('substitutes YY with the 2-digit year', async () => {
        const DateUtil = await loadDateUtil();
        const date = new Date(2026, 6, 30, 9, 7, 4);

        expect(DateUtil.format(date, 'YY/MM/dd')).toBe('26/07/30');
    });

    it('keeps a two-digit hour, minute and second as they are without a third leading digit', async () => {
        const DateUtil = await loadDateUtil();
        const date = new Date(2026, 11, 31, 23, 59, 58);

        expect(DateUtil.format(date, 'yyyy/MM/dd hh:mm:ss')).toBe('2026/12/31 23:59:58');
    });

    it.each([
        [2026, 6, 26, '日'],
        [2026, 6, 27, '月'],
        [2026, 6, 28, '火'],
        [2026, 6, 29, '水'],
        [2026, 6, 30, '木'],
        [2026, 6, 31, '金'],
        [2026, 7, 1, '土'],
    ])('substitutes w with the Japanese label for %i-%i-%i', async (year, month, day, label) => {
        const DateUtil = await loadDateUtil();

        expect(DateUtil.format(new Date(year, month, day, 12, 0, 0), 'w')).toBe(label);
    });

    it('substitutes w with the Japanese day-of-week label for the given date', async () => {
        const DateUtil = await loadDateUtil();
        // 2026-07-30 is a Thursday; the expected label is a literal, not derived via the same
        // `date.getDay()` accessor the implementation itself uses (that would just mirror the
        // implementation and never fail regardless of which label the loop actually picks).
        const date = new Date(2026, 6, 30, 9, 7, 4);

        expect(DateUtil.format(date, 'w')).toBe('木');
    });
});

describe('[IMP-CHAR-SF-3] DateUtil.getJaDate offset direction', () => {
    // process.env.TZ cannot be switched inside a worker once it has started, so the host offset is
    // injected through the Date itself.
    it.each([
        [0, 9],
        [-540, 0],
        [300, 14],
    ])(
        'adds the difference between the local offset (%i min) and UTC+9 to the instant (%i hours)',
        async (offsetMinutes, hours) => {
            const DateUtil = await loadDateUtil();
            const localDate = new Date(Date.UTC(2026, 6, 30, 0, 0, 0));
            localDate.getTimezoneOffset = () => offsetMinutes;

            const jaDate = DateUtil.getJaDate(localDate);

            expect(jaDate.getTime() - localDate.getTime()).toBe(hours * 60 * 60 * 1000);
        },
    );
});
