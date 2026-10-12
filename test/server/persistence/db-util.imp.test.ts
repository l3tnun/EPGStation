import { describe, expect, it } from 'vitest';

import { loadCompiled } from './repository-harness';

interface DBUtilModule {
    createAndQuery: (strs: string[]) => string;
    createOrQuery: (strs: string[]) => string;
}

describe('[PERSIST-DBUTIL] DBUtil and/or query fragment construction', () => {
    const DBUtil = loadCompiled<DBUtilModule>('model/db/DBUtil.js');

    it('[PERSIST-DBUTIL-1] returns an empty string for an empty and-condition list instead of "()"', () => {
        expect(DBUtil.createAndQuery([])).toBe('');
    });

    it('[PERSIST-DBUTIL-2] joins multiple and-conditions with "and" and wraps the whole result in one more parenthesis pair', () => {
        expect(DBUtil.createAndQuery(['a = 1', 'b = 2'])).toBe('((a = 1) and (b = 2))');
    });

    it('[PERSIST-DBUTIL-3] returns "()" for an empty or-condition list, unlike createAndQuery', () => {
        expect(DBUtil.createOrQuery([])).toBe('()');
    });

    it('[PERSIST-DBUTIL-4] joins multiple or-conditions with "or" and wraps the whole result in one more parenthesis pair', () => {
        expect(DBUtil.createOrQuery(['a = 1', 'b = 2'])).toBe('((a = 1) or(b = 2))');
    });
});
