import { describe, expect, it } from 'vitest';

import { createOperator, type TestLogger } from './harness';

const logger: TestLogger = { system: { error: () => undefined, info: () => undefined } };

describe('persistence dialect capability contract', () => {
    it.each([
        ['sqlite', undefined, false, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['sqlite', { regexp: false }, false, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['sqlite', { regexp: true }, true, 1, 0, false, 'like', 'like', 'regexp', 'regexp'],
        ['mysql', undefined, true, true, false, true, 'like', 'like binary', 'regexp', 'regexp binary'],
        ['postgres', undefined, true, true, false, true, 'ilike', 'like', '~*', '~'],
    ])(
        '[PERSIST-2.6-%s-%j] exposes backend-specific boolean, case and regexp operators',
        (dbtype, sqlite, regexp, truthy, falsy, caseSensitive, like, binaryLike, regex, binaryRegex) => {
            const operator = createOperator({ dbtype, sqlite }, logger) as ReturnType<typeof createOperator> & {
                convertBoolean(value: boolean): boolean | number;
                getLikeStr(cs: boolean): string;
                getRegexpStr(cs: boolean): string;
                isEnableCS(): boolean;
                isEnabledRegexp(): boolean;
            };

            expect(operator.isEnabledRegexp()).toBe(regexp);
            expect(operator.convertBoolean(true)).toBe(truthy);
            expect(operator.convertBoolean(false)).toBe(falsy);
            expect(operator.isEnableCS()).toBe(caseSensitive);
            expect(operator.getLikeStr(false)).toBe(like);
            expect(operator.getLikeStr(true)).toBe(binaryLike);
            expect(operator.getRegexpStr(false)).toBe(regex);
            expect(operator.getRegexpStr(true)).toBe(binaryRegex);
        },
    );
});
