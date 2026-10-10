// client の mutation testing（Stryker）の設定。client で `npm run mutation:client` を流す。
// 位置づけと運用は .kiro/steering/testing.md の「Mutation Testing」と docs/testing.md を参照。
// preflight・CI の gate ではない。unit test（unittest/spec・unittest/imp）だけを対象 test にする。

// incremental の cache。環境変数で別の場所に変えられる。消えたら全 mutant を流し直す。
const incrementalFile =
  process.env.EPGS_MUTATION_INCREMENTAL_FILE ?? '.artifacts/mutation/incremental.json'

// 重要な純粋 logic の一覧。評価対象を増やすときはここに足す。
const mutate = [
  // 手動予約の入力から API payload への変換
  'src/features/reserves/lib/manualReservePayload.ts',
  'src/features/reserves/lib/manualReserveForm.ts',
  'src/features/reserves/lib/reserveSelection.ts',
  // ルール検索の入力から request・payload への変換
  'src/features/search/rule/lib/rulePayload.ts',
  'src/features/search/rule/lib/searchRequest.ts',
  'src/features/search/rule/lib/inputParsers.ts',
  'src/features/search/rule/lib/searchRoute.ts',
]

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate,
  // sandbox へ複製しない path。先頭の `/` で client 直下だけに限る。
  ignorePatterns: [
    '/dist',
    '/e2e',
    '/visual',
    '/device',
    '/public',
    '/coverage',
    '/reports',
    '/.artifacts',
  ],
  coverageAnalysis: 'perTest',
  // module 先頭の定数表の mutant（static）に全 test を流さず、それを覆う test だけで実行する。
  ignoreStatic: true,
  concurrency: 2,
  timeoutMS: 40000,
  dryRunTimeoutMinutes: 30,
  incremental: true,
  incrementalFile,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/report.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
}
