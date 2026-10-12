import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import base from './vitest.server.config.ts';

// mutation testing（stryker.server.config.mjs）専用の vitest 設定。通常の test 実行では使わない。
//
// - 対象 test は単体 test の層（spec・imp）だけ。結合 test は除く。
// - Stryker の test id（`test/server/...#名前`）が vitest の file filter と一致するように、
//   各 project の root を repository root にして include / exclude の先頭に `test/server/` を付ける。
// - server の test は build 済みの `dist` を読む。Stryker の buildCommand が mutant 入りの src から
//   sandbox の `<cwd>/dist` を作るので、それを compiled snapshot にする。
// - Stryker は vitest を threads pool・worker 1 に固定する。単体 test の層（spec・imp）は、その条件でも、
//   sandbox（repository の複製）の中でも動く。除外する単体 test は
//   application-runtime/spec/compiled-snapshot-coverage.test.ts の 1 つだけ。
//   この test は、網羅率の除外の印の行を末尾に持つ src の file の実物の text を読んで、網羅率を測る道具を確かめる。
//   Stryker は mutate する file を書き換える（mutant の切り替えを挟み、整形し直し、末尾の改行を落とす）ので、
//   その file の実物は sandbox に無く、この test は sandbox では成り立たない。
//   src の code を実行しないので mutant を殺せず、除外しても mutation の結果は変わらない。
//   server の設定（stryker.server.config.mjs）は `vitest.related` を無効にしているので、単体 test は
//   mutate する file との import の関係に関わらず全件動く。この test が dry run で失敗すると run が止まる。
//   一方、file の読み込み（describe の中の処理）で失敗した場合は、Stryker は失敗と数えず、その file の test が
//   黙って動かないまま run が続く。どちらにしても結果が信用できなくなるため、
//   sandbox で成り立たない test は、失敗のまま残さずここで明示して除外する。
//   sandbox は client を複製しない（`/client/*`）が、依存の image の計画の test が読む client の
//   package.json と lock は複製する（stryker.server.config.mjs の `ignorePatterns`）。
const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

// sandbox で成り立たないため除外する単体 test（理由は上のコメント）。
const mutationExcludedTests = ['application-runtime/spec/compiled-snapshot-coverage.test.ts'];

const projects = ((base as any).test.projects as any[])
    .filter(project => project.test.name !== 'integration')
    .map(project => ({
        ...project,
        root: process.cwd(),
        test: {
            ...project.test,
            root: process.cwd(),
            include: pre(project.test.include),
            exclude: pre([...(project.test.exclude ?? []), ...mutationExcludedTests]),
            env: {
                ...(project.test.env ?? {}),
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: resolve(process.cwd(), 'dist'),
            },
        },
    }));

export default defineConfig({
    root: '.',
    test: { ...(base as any).test, projects, coverage: { enabled: false } },
});
