import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compiledSnapshot } from './harness';

interface Migration {
    name: string;
    up: (runner: { query: (sql: string) => Promise<void> }) => Promise<void>;
    down: (runner: { query: (sql: string) => Promise<void> }) => Promise<void>;
}

const require = createRequire(join(process.cwd(), 'package.json'));

const load = (dialect: 'mysql' | 'sqlite', file: string, className: string): Migration => {
    const module = require(join(compiledSnapshot, 'db', 'migrations', dialect, `${file}.js`)) as Record<
        string,
        new () => Migration
    >;
    return new module[className]();
};

const record = async (run: (runner: { query: (sql: string) => Promise<void> }) => Promise<void>): Promise<string[]> => {
    const issued: string[] = [];
    await run({
        query: async sql => {
            issued.push(sql);
        },
    });
    return issued;
};

interface Summary {
    readonly label: string;
    /** Tables the query reads or writes; the SQLite rebuild's temporary_ prefix is removed. */
    readonly tables: readonly string[];
}

const stripTemporary = (name: string): string => name.replace(/^temporary_/u, '');

const summarize = (sql: string): Summary => {
    const text = sql.replace(/`/gu, '"').trim();
    const one = (label: string, table: string): Summary => ({ label, tables: [stripTemporary(table)] });
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^CREATE TABLE "(\w+)"/u)) !== null) return one(`CREATE TABLE ${match[1]}`, match[1]);
    if ((match = text.match(/^DROP TABLE "(\w+)"/u)) !== null) return one(`DROP TABLE ${match[1]}`, match[1]);
    if ((match = text.match(/^INSERT INTO "(\w+)"/u)) !== null) return one(`COPY INTO ${match[1]}`, match[1]);
    if ((match = text.match(/^CREATE INDEX "\w+" ON "(\w+)"/u)) !== null) {
        return one(`CREATE INDEX ON ${match[1]}`, match[1]);
    }
    if ((match = text.match(/^DROP INDEX "\w+" ON "(\w+)"/u)) !== null) {
        return one(`DROP INDEX ON ${match[1]}`, match[1]);
    }
    if (/^DROP INDEX "\w+"$/u.test(text)) return { label: 'DROP INDEX', tables: ['recorded_tags_recorded_tag'] };
    if ((match = text.match(/^ALTER TABLE "(\w+)" RENAME TO "(\w+)"/u)) !== null) {
        return one(`RENAME ${match[1]} TO ${match[2]}`, match[1]);
    }
    if ((match = text.match(/^ALTER TABLE "(\w+)" ADD CONSTRAINT/u)) !== null) {
        return one(`ADD FOREIGN KEY ON ${match[1]}`, match[1]);
    }
    if ((match = text.match(/^ALTER TABLE "(\w+)" DROP FOREIGN KEY/u)) !== null) {
        return one(`DROP FOREIGN KEY ON ${match[1]}`, match[1]);
    }
    if ((match = text.match(/^ALTER TABLE "(\w+)" DROP COLUMN/u)) !== null) {
        return one(`DROP COLUMN ON ${match[1]}`, match[1]);
    }
    if ((match = text.match(/^ALTER TABLE "(\w+)" CHANGE/u)) !== null) {
        return one(`CHANGE COLUMN ON ${match[1]}`, match[1]);
    }
    if ((match = text.match(/^ALTER TABLE "?(\w+)"? ADD /u)) !== null)
        return one(`ADD COLUMN ON ${match[1]}`, match[1]);
    return { label: `UNCLASSIFIED ${text}`, tables: [] };
};

/** Folds consecutive identical summaries into "label xN". */
const grouped = (issued: readonly string[]): string[] => {
    const groups: string[] = [];
    let last: string | undefined;
    let count = 0;
    const flush = (): void => {
        if (last !== undefined) groups.push(count === 1 ? last : `${last} x${count}`);
    };
    for (const sql of issued) {
        const { label } = summarize(sql);
        if (label === last) {
            count += 1;
        } else {
            flush();
            last = label;
            count = 1;
        }
    }
    flush();
    return groups;
};

const tablesOf = (issued: readonly string[]): string[] =>
    [...new Set(issued.flatMap(sql => summarize(sql).tables))].sort();

interface Expectation {
    readonly dialect: 'mysql' | 'sqlite';
    readonly file: string;
    readonly className: string;
    /** Queries issued by `up`, in order, as "kind table" with consecutive repeats folded to "xN". */
    readonly up: readonly string[];
    /** Queries issued by `down`, in order, in the same notation. */
    readonly down: readonly string[];
}

const expectations: readonly Expectation[] = [
    {
        dialect: 'mysql',
        file: '1601186196169-Init',
        className: 'Init1601186196169',
        up: [
            'CREATE TABLE channel',
            'CREATE TABLE drop_log_file',
            'CREATE TABLE program',
            'CREATE TABLE recorded_tag',
            'CREATE TABLE thumbnail',
            'CREATE TABLE video_file',
            'CREATE TABLE recorded',
            'CREATE TABLE recorded_history',
            'CREATE TABLE reserve',
            'CREATE TABLE rule',
            'CREATE TABLE recorded_tags_recorded_tag',
            'ADD FOREIGN KEY ON thumbnail',
            'ADD FOREIGN KEY ON video_file',
            'ADD FOREIGN KEY ON recorded',
            'ADD FOREIGN KEY ON recorded_tags_recorded_tag x2',
        ],
        down: [
            'DROP FOREIGN KEY ON recorded_tags_recorded_tag x2',
            'DROP FOREIGN KEY ON recorded',
            'DROP FOREIGN KEY ON video_file',
            'DROP FOREIGN KEY ON thumbnail',
            'DROP INDEX ON recorded_tags_recorded_tag x2',
            'DROP TABLE recorded_tags_recorded_tag',
            'DROP TABLE rule',
            'DROP TABLE reserve',
            'DROP TABLE recorded_history',
            'DROP INDEX ON recorded',
            'DROP TABLE recorded',
            'DROP TABLE video_file',
            'DROP TABLE thumbnail',
            'DROP TABLE recorded_tag',
            'DROP TABLE program',
            'DROP TABLE drop_log_file',
            'DROP TABLE channel',
        ],
    },
    {
        dialect: 'mysql',
        file: '1624084351785-AddRawExtended',
        className: 'AddRawExtended1624084351785',
        up: [
            'ADD COLUMN ON program x2',
            'ADD COLUMN ON recorded x2',
            'ADD COLUMN ON reserve x2',
            'CHANGE COLUMN ON channel x2',
            'CHANGE COLUMN ON program x16',
            'DROP FOREIGN KEY ON recorded',
            'CHANGE COLUMN ON recorded x20',
            'CHANGE COLUMN ON reserve x36',
            'CHANGE COLUMN ON rule x24',
            'ADD FOREIGN KEY ON recorded',
        ],
        down: [
            'DROP FOREIGN KEY ON recorded',
            'CHANGE COLUMN ON rule x24',
            'CHANGE COLUMN ON reserve x36',
            'CHANGE COLUMN ON recorded x20',
            'ADD FOREIGN KEY ON recorded',
            'CHANGE COLUMN ON program x16',
            'CHANGE COLUMN ON channel x2',
            'DROP COLUMN ON reserve x2',
            'DROP COLUMN ON recorded x2',
            'DROP COLUMN ON program x2',
        ],
    },
    {
        dialect: 'mysql',
        file: '1716647383635-AddEventRelay',
        className: 'AddEventRelay1716647383635',
        up: [
            'DROP FOREIGN KEY ON recorded_tags_recorded_tag x2',
            'ADD COLUMN ON reserve',
            'DROP FOREIGN KEY ON recorded',
            'CHANGE COLUMN ON recorded x22',
            'CHANGE COLUMN ON rule x24',
            'CHANGE COLUMN ON reserve x38',
            'CHANGE COLUMN ON program x18',
            'CHANGE COLUMN ON channel x2',
            'ADD FOREIGN KEY ON recorded',
            'ADD FOREIGN KEY ON recorded_tags_recorded_tag x2',
        ],
        down: [
            'DROP FOREIGN KEY ON recorded_tags_recorded_tag x2',
            'DROP FOREIGN KEY ON recorded',
            'CHANGE COLUMN ON channel x2',
            'CHANGE COLUMN ON program x18',
            'CHANGE COLUMN ON reserve x38',
            'CHANGE COLUMN ON rule x24',
            'CHANGE COLUMN ON recorded x22',
            'ADD FOREIGN KEY ON recorded',
            'DROP COLUMN ON reserve',
            'ADD FOREIGN KEY ON recorded_tags_recorded_tag x2',
        ],
    },
    {
        dialect: 'mysql',
        file: '1790497623885-AddRuleBS4K',
        className: 'AddRuleBS4K1790497623885',
        up: ['ADD COLUMN ON rule'],
        down: ['DROP COLUMN ON rule'],
    },
    {
        dialect: 'sqlite',
        file: '1601185891878-Init',
        className: 'Init1601185891878',
        up: [
            'CREATE TABLE channel',
            'CREATE TABLE drop_log_file',
            'CREATE TABLE program',
            'CREATE TABLE recorded_tag',
            'CREATE TABLE thumbnail',
            'CREATE TABLE video_file',
            'CREATE TABLE recorded',
            'CREATE TABLE recorded_history',
            'CREATE TABLE reserve',
            'CREATE TABLE rule',
            'CREATE TABLE recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
            'CREATE TABLE temporary_thumbnail',
            'COPY INTO temporary_thumbnail',
            'DROP TABLE thumbnail',
            'RENAME temporary_thumbnail TO thumbnail',
            'CREATE TABLE temporary_video_file',
            'COPY INTO temporary_video_file',
            'DROP TABLE video_file',
            'RENAME temporary_video_file TO video_file',
            'CREATE TABLE temporary_recorded',
            'COPY INTO temporary_recorded',
            'DROP TABLE recorded',
            'RENAME temporary_recorded TO recorded',
            'DROP INDEX x2',
            'CREATE TABLE temporary_recorded_tags_recorded_tag',
            'COPY INTO temporary_recorded_tags_recorded_tag',
            'DROP TABLE recorded_tags_recorded_tag',
            'RENAME temporary_recorded_tags_recorded_tag TO recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
        ],
        down: [
            'DROP INDEX x2',
            'RENAME recorded_tags_recorded_tag TO temporary_recorded_tags_recorded_tag',
            'CREATE TABLE recorded_tags_recorded_tag',
            'COPY INTO recorded_tags_recorded_tag',
            'DROP TABLE temporary_recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
            'RENAME recorded TO temporary_recorded',
            'CREATE TABLE recorded',
            'COPY INTO recorded',
            'DROP TABLE temporary_recorded',
            'RENAME video_file TO temporary_video_file',
            'CREATE TABLE video_file',
            'COPY INTO video_file',
            'DROP TABLE temporary_video_file',
            'RENAME thumbnail TO temporary_thumbnail',
            'CREATE TABLE thumbnail',
            'COPY INTO thumbnail',
            'DROP TABLE temporary_thumbnail',
            'DROP INDEX x2',
            'DROP TABLE recorded_tags_recorded_tag',
            'DROP TABLE rule',
            'DROP TABLE reserve',
            'DROP TABLE recorded_history',
            'DROP TABLE recorded',
            'DROP TABLE video_file',
            'DROP TABLE thumbnail',
            'DROP TABLE recorded_tag',
            'DROP TABLE program',
            'DROP TABLE drop_log_file',
            'DROP TABLE channel',
        ],
    },
    {
        dialect: 'sqlite',
        file: '1624085241577-AddRawExtended',
        className: 'AddRawExtended1624085241577',
        up: ['ADD COLUMN ON program x2', 'ADD COLUMN ON recorded x2', 'ADD COLUMN ON reserve x2'],
        down: [
            'RENAME reserve TO temporary_reserve',
            'CREATE TABLE reserve',
            'COPY INTO reserve',
            'DROP TABLE temporary_reserve',
            'RENAME recorded TO temporary_recorded',
            'CREATE TABLE recorded',
            'COPY INTO recorded',
            'DROP TABLE temporary_recorded',
            'RENAME program TO temporary_program',
            'CREATE TABLE program',
            'COPY INTO program',
            'DROP TABLE temporary_program',
        ],
    },
    {
        dialect: 'sqlite',
        file: '1716647355956-AddEventRelay',
        className: 'AddEventRelay1716647355956',
        up: [
            'DROP INDEX x2',
            'CREATE TABLE temporary_recorded_tags_recorded_tag',
            'COPY INTO temporary_recorded_tags_recorded_tag',
            'DROP TABLE recorded_tags_recorded_tag',
            'RENAME temporary_recorded_tags_recorded_tag TO recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
            'CREATE TABLE temporary_reserve',
            'COPY INTO temporary_reserve',
            'DROP TABLE reserve',
            'RENAME temporary_reserve TO reserve',
            'DROP INDEX x2',
            'CREATE TABLE temporary_recorded_tags_recorded_tag',
            'COPY INTO temporary_recorded_tags_recorded_tag',
            'DROP TABLE recorded_tags_recorded_tag',
            'RENAME temporary_recorded_tags_recorded_tag TO recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
        ],
        down: [
            'DROP INDEX x2',
            'RENAME recorded_tags_recorded_tag TO temporary_recorded_tags_recorded_tag',
            'CREATE TABLE recorded_tags_recorded_tag',
            'COPY INTO recorded_tags_recorded_tag',
            'DROP TABLE temporary_recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
            'RENAME reserve TO temporary_reserve',
            'CREATE TABLE reserve',
            'COPY INTO reserve',
            'DROP TABLE temporary_reserve',
            'DROP INDEX x2',
            'RENAME recorded_tags_recorded_tag TO temporary_recorded_tags_recorded_tag',
            'CREATE TABLE recorded_tags_recorded_tag',
            'COPY INTO recorded_tags_recorded_tag',
            'DROP TABLE temporary_recorded_tags_recorded_tag',
            'CREATE INDEX ON recorded_tags_recorded_tag x2',
        ],
    },
    {
        dialect: 'sqlite',
        file: '1790497623886-AddRuleBS4K',
        className: 'AddRuleBS4K1790497623886',
        up: [
            'CREATE TABLE temporary_rule',
            'COPY INTO temporary_rule',
            'DROP TABLE rule',
            'RENAME temporary_rule TO rule',
        ],
        down: ['RENAME rule TO temporary_rule', 'CREATE TABLE rule', 'COPY INTO rule', 'DROP TABLE temporary_rule'],
    },
];

describe('[PERSIST-MIGRATION-UNIT] [AR-9.9] migration up / down issue the expected queries to a recording runner', () => {
    for (const expectation of expectations) {
        const { dialect, file, className } = expectation;
        const tag = `${dialect}/${file}`;

        it(`[PERSIST-MIGRATION-UNIT-NAME] ${tag} names itself after its class`, () => {
            expect(load(dialect, file, className).name).toBe(className);
        });

        it(`[PERSIST-MIGRATION-UNIT-UP] ${tag} up issues the expected queries in order`, async () => {
            const migration = load(dialect, file, className);
            expect(grouped(await record(runner => migration.up(runner)))).toEqual(expectation.up);
        });

        it(`[PERSIST-MIGRATION-UNIT-DOWN] ${tag} down issues the expected queries in order`, async () => {
            const migration = load(dialect, file, className);
            expect(grouped(await record(runner => migration.down(runner)))).toEqual(expectation.down);
        });

        it(`[PERSIST-MIGRATION-UNIT-REVERT] ${tag} down touches exactly the tables up touches`, async () => {
            const migration = load(dialect, file, className);
            const upTables = tablesOf(await record(runner => migration.up(runner)));
            const downTables = tablesOf(await record(runner => migration.down(runner)));
            expect(upTables.length).toBeGreaterThan(0);
            expect(downTables).toEqual(upTables);
        });

        it(`[PERSIST-MIGRATION-UNIT-ERROR] ${tag} up and down stop at a failing query and surface its error`, async () => {
            const migration = load(dialect, file, className);
            const failure = new Error('synthetic query failure');
            const issued: string[] = [];
            const failing = {
                query: async (sql: string): Promise<void> => {
                    issued.push(sql);
                    throw failure;
                },
            };
            await expect(migration.up(failing)).rejects.toBe(failure);
            await expect(migration.down(failing)).rejects.toBe(failure);
            expect(issued).toHaveLength(2);
        });
    }
});
