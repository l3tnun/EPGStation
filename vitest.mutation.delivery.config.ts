import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

import base from './vitest.server.config.ts';

// 配信の本体の mutation testing（stryker.delivery.config.mjs）専用の vitest 設定。通常の test 実行では使わない。
//
// - 対象 test は単体 test の層（spec・imp）に、配信の結合 test（process の起動・file・HTTP・使用権の確認）を足したもの。
//   配信の本体は process の起動や file の書き出しの正しさを結合 test が確かめているため。
//   Docker を使う結合 test は無い（image の確認などは入れない）。
// - Stryker の test id が vitest の file filter と一致するように、各 project の root を repository root にして
//   include / exclude の先頭に `test/server/` を付ける（vitest.mutation.server.config.ts と同じ）。
// - server の test は build 済みの `dist` を読む。Stryker の buildCommand が mutant 入りの src から
//   sandbox の `<cwd>/dist` を作るので、それを compiled snapshot にする。
// - Stryker は vitest を threads pool・worker 1 に固定する。除外する test は
//   application-runtime/spec/compiled-snapshot-coverage.test.ts の 1 つだけ。網羅率の除外の印の行を持つ src の
//   file の実物の text を読む test で、Stryker が mutate する file を書き換える sandbox では成り立たず、
//   src の code を実行しないので mutant も殺せない（理由は vitest.mutation.server.config.ts を参照）。
//   この設定も `vitest.related` を無効にしているので、この test は import の関係に関わらず動き、
//   失敗すると dry run が止まる。
const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

// sandbox で成り立たないため除外する単体 test。
const mutationExcludedTests = ['application-runtime/spec/compiled-snapshot-coverage.test.ts'];

// 配信の結合 test。
const integrationFiles = [
    'media-delivery/*.integration.test.ts',
    'service-interface/recorded-resource-use-binding.integration.test.ts',
    'service-interface/recorded-playback-source-binding.integration.test.ts',
    'media-process-management/process-group.integration.test.ts',
];

const projects = ((base as any).test.projects as any[]).map(project => {
    const isIntegration = project.test.name === 'integration';
    return {
        ...project,
        root: process.cwd(),
        test: {
            ...project.test,
            root: process.cwd(),
            include: isIntegration ? pre(integrationFiles) : pre(project.test.include),
            exclude: pre([...(project.test.exclude ?? []), ...mutationExcludedTests]),
            env: {
                ...(project.test.env ?? {}),
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: resolve(process.cwd(), 'dist'),
            },
        },
    };
});

export default defineConfig({
    root: '.',
    test: { ...(base as any).test, projects, coverage: { enabled: false } },
});
