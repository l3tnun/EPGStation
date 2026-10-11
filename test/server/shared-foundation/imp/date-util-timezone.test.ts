import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

// The expectation depends on the process time zone, and `process.env.TZ` cannot be switched inside a
// worker thread (the pool Stryker forces) once it has started. So the check runs in a child process that
// starts with `TZ=UTC`, the same way for every pool.
const childScript = [
    'const { default: DateUtil } = await import(process.env.DATE_UTIL_URL);',
    'const jaDate = DateUtil.getJaDate(new Date(2026, 6, 30, 9, 7, 4));',
    'process.stdout.write(JSON.stringify({',
    '    year: jaDate.getFullYear(),',
    '    month: jaDate.getMonth(),',
    '    date: jaDate.getDate(),',
    '    hours: jaDate.getHours(),',
    '    minutes: jaDate.getMinutes(),',
    '    seconds: jaDate.getSeconds(),',
    '}));',
].join('\n');

describe('[IMP-CHAR-SF-3] DateUtil.getJaDate compatible output', () => {
    it('shifts an arbitrary local Date to a UTC+9 wall-clock instant', async () => {
        // Pinned (not the ambient host TZ) so the expected literal below is portable across CI
        // environments, and chosen so the local-vs-JST offset does not cancel to zero (which would
        // let an identity/no-op implementation coincidentally pass).
        const dateUtilUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'DateUtil.js')).href;
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', childScript], {
            env: { ...process.env, TZ: 'UTC', DATE_UTIL_URL: dateUtilUrl },
        });

        // `DateUtil.format` (the only production consumer) reads `jaDate` through these same
        // local (non-UTC) getters -- this is a literal, hardcoded JST wall-clock expectation,
        // not a recomputation of the implementation's own offset formula.
        expect(JSON.parse(stdout)).toEqual({ year: 2026, month: 6, date: 30, hours: 18, minutes: 7, seconds: 4 });
    });
});
