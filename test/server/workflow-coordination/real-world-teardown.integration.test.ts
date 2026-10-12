import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { Program, programRow, withWorld } from './_real-workflow';

/*
 * 本物の部品の配線（withWorld）の後始末を確かめる。
 * 外部コマンドは実の子 process で、一時 directory の中へ書く。操作の中で起動された外部コマンドが終わる前に一時 directory を
 * 消し始めると、消している途中に子 process が file を作り、directory を消せなくなる（ENOTEMPTY）か、子 process の書き込みが失敗する。
 * 後始末は、受け付けた外部コマンドの終了を待ってから一時 directory を消す。
 */

describe('teardown of the real component wiring', () => {
    it('waits for an external command started by the operation to exit before removing the temporary directory', async () => {
        // 子 process の script と結果の記録は、消される一時 directory の外に置く。
        const outside = await mkdtemp(join(tmpdir(), 'epgstation-hook-outcome-'));
        const outcome = join(outside, 'outcome.txt');
        try {
            const script = join(outside, 'late-append.cjs');
            await writeFile(
                script,
                [
                    "const fs = require('node:fs');",
                    'setTimeout(() => {',
                    "    let result = 'written';",
                    '    try {',
                    "        fs.appendFileSync(process.argv[2], 'late-append\\n');",
                    '    } catch (error) {',
                    '        result = error.code;',
                    '    }',
                    '    fs.writeFileSync(process.argv[3], result);',
                    '}, 1000);',
                ].join('\n'),
            );

            await withWorld({}, async world => {
                world.config.reserveNewAddtionCommand = `%NODE% ${script} ${world.hookLog} ${outcome}`;
                world.setter.set();
                const now = Date.now();
                await world.save(Program, [programRow({ id: 3_001, eventId: 3_001, startAt: now + 3_600_000, endAt: now + 4_200_000 })]);
                // 予約の追加で外部コマンドが起動する。操作はその終了を待たずに終わる。
                await world.reservation.add({ programId: 3_001, allowEndLack: false });
            });

            // 後始末が終わった時点で、外部コマンドは終わっていて、一時 directory の中へ書けている。
            const atTeardownEnd = await readFile(outcome, 'utf8').catch(() => 'not finished');
            // 待たなかった場合も、子 process が終わってから外の directory を消す。
            await vi.waitFor(() => expect(existsSync(outcome)).toBe(true), { interval: 50, timeout: 15_000 });
            expect({ atTeardownEnd, eventual: await readFile(outcome, 'utf8') }).toEqual({
                atTeardownEnd: 'written',
                eventual: 'written',
            });
        } finally {
            await rm(outside, { recursive: true });
        }
    }, 60_000);
});
