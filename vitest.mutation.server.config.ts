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
// - Stryker は vitest を threads pool・worker 1 に固定する。その条件で動かない test は下の一覧で除く。
const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

const mutationExclusions = [
    // process.env.TZ を実行中に切り替える。threads pool の中では切り替えが効かず失敗する。
    'shared-foundation/imp/date-util.test.ts',
    // build 工具・clean install・npm の path に依存し、sandbox の複製では再現できない。
    'application-runtime/spec/compiled-snapshot-coverage.test.ts',
    'application-runtime/docker-dependency-images.spec.test.ts',
];

const projects = ((base as any).test.projects as any[])
    .filter(project => project.test.name !== 'integration')
    .map(project => ({
        ...project,
        root: process.cwd(),
        test: {
            ...project.test,
            root: process.cwd(),
            include: pre(project.test.include),
            exclude: pre([...(project.test.exclude ?? []), ...mutationExclusions]),
            env: {
                ...(project.test.env ?? {}),
                EPGSTATION_SERVER_COMPILED_SNAPSHOT: resolve(process.cwd(), 'dist'),
                // mutation の実行中だけ立てる。sandbox では再現できない clean install の probe を test 側で飛ばす目印。
                EPGS_MUTATION_RUN: '1',
            },
        },
    }));

export default defineConfig({
    root: '.',
    test: { ...(base as any).test, projects, coverage: { enabled: false } },
});
