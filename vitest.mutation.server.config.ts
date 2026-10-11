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
//   sandbox（repository の複製）の中でも全部動くので、除外する test は無い。
//   sandbox は Stryker が全ての `src/**/*.ts` の先頭に `// @ts-nocheck` の 1 行を足すので、build した dist の
//   offset と行番号が通常より 15 byte・1 行ずれる。この差に依存する test
//   （application-runtime/spec/compiled-snapshot-coverage.test.ts）はその差を読んで合わせている。
//   sandbox は client を複製しない（`/client/*`）が、依存の image の計画の test が読む client の
//   package.json と lock は複製する（stryker.server.config.mjs の `ignorePatterns`）。
const pre = (patterns: string[]): string[] => patterns.map(pattern => `test/server/${pattern}`);

const projects = ((base as any).test.projects as any[])
    .filter(project => project.test.name !== 'integration')
    .map(project => ({
        ...project,
        root: process.cwd(),
        test: {
            ...project.test,
            root: process.cwd(),
            include: pre(project.test.include),
            exclude: pre(project.test.exclude ?? []),
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
