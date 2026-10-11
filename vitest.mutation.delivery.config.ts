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
// - Stryker は vitest を threads pool・worker 1 に固定する。その条件で動かない test は下の一覧で除く。
const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

const mutationExclusions = [
    // process.env.TZ を実行中に切り替える。threads pool の中では切り替えが効かず失敗する。
    'shared-foundation/imp/date-util-timezone.test.ts',
    // build 工具・clean install・npm の path に依存し、sandbox の複製では再現できない。
    'application-runtime/spec/compiled-snapshot-coverage.test.ts',
    'application-runtime/docker-dependency-images.spec.test.ts',
];

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
            exclude: pre([...(project.test.exclude ?? []), ...mutationExclusions]),
            env: {
                ...(project.test.env ?? {}),
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: resolve(process.cwd(), 'dist'),
                EPGS_MUTATION_RUN: '1',
            },
        },
    };
});

export default defineConfig({
    root: '.',
    test: { ...(base as any).test, projects, coverage: { enabled: false } },
});
