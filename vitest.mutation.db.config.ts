import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import base from './vitest.server.config.ts';

// DB の class の mutation testing（stryker.db.config.mjs）専用の vitest 設定。通常の test 実行では使わない。
//
// - 対象 test は persistence の単体 test（spec・imp）と、実 DB で query の正しさを見る結合 test。
//   Docker image の確認など DB の正しさと無関係な結合 test は入れない。
// - 結合 test は、起動したままの MySQL 9.7 を使う（test が container を作ると mutant ごとに
//   起動してしまうため）。接続先は環境変数で渡す（未指定ならここで止める）:
//   EPGS_TEST_MYSQL_{HOST,PORT,USER,PASSWORD}。
//   test ごとに無作為の名前の database を作って消すので、並列でも干渉しない。
// - Stryker の test id が vitest の file filter と一致するように、各 project の root を repository root に
//   して include / exclude の先頭に `test/server/` を付ける（vitest.mutation.server.config.ts と同じ）。
// - server の test は build 済みの `dist` を読む。Stryker の buildCommand が mutant 入りの src から
//   sandbox の `<cwd>/dist` を作るので、それを compiled snapshot にする。
// - Stryker は vitest を threads pool・worker 1 に固定する。その条件で動かない test は下の一覧で除く。

for (const name of ['HOST', 'PORT', 'PASSWORD']) {
    if ((process.env[`EPGS_TEST_MYSQL_${name}`] ?? '') === '') {
        throw new Error(`EPGS_TEST_MYSQL_${name} is required: start the database server first (see docs/testing.md)`);
    }
}
// 製品に MySQL と MariaDB を区別する code は無く（`dbtype` は sqlite / mysql だけ）、MariaDB も `mysql` の分岐を通って
// 同じ SQL を送る。mutant が通る経路は同じなので、mutation の run では MariaDB の接続先にも MySQL を使い回す。
// MariaDB 固有の解釈の違い（正規表現の engine、既定の照合順序）は、通常の結合 test の suite が毎回確かめる。
for (const name of ['HOST', 'PORT', 'USER', 'PASSWORD']) {
    const mysqlValue = process.env[`EPGS_TEST_MYSQL_${name}`];
    if ((process.env[`EPGS_TEST_MARIADB_${name}`] ?? '') === '' && mysqlValue !== undefined) {
        process.env[`EPGS_TEST_MARIADB_${name}`] = mysqlValue;
    }
}

const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

// 実 DB で query の正しさを見る結合 test。
const integrationFiles = [
    'persistence/repositories.integration.test.ts',
    'persistence/queries.integration.test.ts',
    'persistence/transactions.integration.test.ts',
    'persistence/storage-deletion-candidate.integration.test.ts',
    'persistence/doubles-parity.integration.test.ts',
    'persistence/rule-program-roundtrip.integration.test.ts',
    'persistence/search-queries.integration.test.ts',
    'persistence/channel-tag-queries.integration.test.ts',
];

const projects = ((base as any).test.projects as any[]).map(project => ({
    ...project,
    root: process.cwd(),
    test: {
        ...project.test,
        root: process.cwd(),
        include: pre(project.test.name === 'integration' ? integrationFiles : ['persistence/**/*.test.ts']),
        exclude: pre(project.test.exclude ?? []),
        env: { ...(project.test.env ?? {}), EPGSTATION_SERVER_COMPILED_SNAPSHOT: resolve(process.cwd(), 'dist') },
    },
}));

export default defineConfig({
    root: '.',
    test: { ...(base as any).test, projects, coverage: { enabled: false } },
});
