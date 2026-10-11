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
  // 保存（localStorage・sessionStorage）の読み書きと検証
  'src/features/guide/guideStorage.ts',
  'src/features/recorded/requests/settingsStorage.ts',
  'src/features/settings/lib/settingsStorageAccess.ts',
  'src/shared/settings/settingsStorage.ts',
  'src/shared/settings/settingsValidation.ts',
  'src/app/scroll/sessionScrollHistory.ts',
  'src/app/scroll/memoryScrollHistory.ts',
  'src/app/lib/routeScroll.ts',
  'src/app/lib/routePath.ts',
  // route・時刻・endpoint の組み立て
  'src/features/guide/lib/guideRoute.ts',
  'src/features/guide/lib/guideDate.ts',
  'src/features/guide/lib/guideUrls.ts',
  'src/features/recorded/lib/recordedRoute.ts',
  'src/features/reserves/lib/reserveRoutes.ts',
  'src/features/reserves/lib/reserveEndpoint.ts',
  'src/features/reserves/lib/reservesListRequests.ts',
  'src/features/reserves/lib/reservesFetch.ts',
  'src/features/video/playback/playbackRoutes.ts',
  // API の要求の組み立て
  'src/features/dashboard/dashboardRequests.ts',
  'src/features/storages/storagesRequests.ts',
  'src/features/recording/recordingRequests.ts',
  'src/features/encode/encodeRequests.ts',
  'src/features/reserves/reservesRequests.ts',
  'src/features/recorded/requests/listRequest.ts',
  'src/features/recorded/requests/addEncode.ts',
  'src/features/recorded/requests/bulkDelete.ts',
  'src/features/recorded/requests/searchPath.ts',
  'src/features/recorded/requests/uploadForm.ts',
  'src/features/recorded/requests/fileSize.ts',
  // 再生（字幕・lifecycle・設定・handoff・stream の選択）
  'src/features/video/playback/playbackSubtitle.ts',
  'src/features/video/playback/playbackLifecycle.ts',
  'src/features/video/playback/playbackLifecycleRepository.ts',
  'src/features/video/playback/playbackSettings.ts',
  'src/features/recorded/requests/videoHandoff.ts',
  'src/features/recorded/requests/streamSelect.ts',
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
