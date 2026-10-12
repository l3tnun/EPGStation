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
  // API の呼び出しと応答の変換
  'src/features/guide/guideApi.ts',
  'src/features/recorded/recordedApi.ts',
  'src/features/reserves/reservesApi.ts',
  'src/features/onair/onairApi.ts',
  'src/features/recording/recordingApi.ts',
  'src/features/encode/encodeApi.ts',
  'src/features/dashboard/dashboardApi.ts',
  'src/features/storages/storagesApi.ts',
  'src/features/search/rule/api/repository.ts',
  'src/features/search/rule/api/adaptRules.ts',
  'src/features/search/rule/api/adaptPrograms.ts',
  'src/features/search/rule/api/channelNames.ts',
  'src/features/search/rule/api/http.ts',
  'src/features/recorded/api/recordedAdapters.ts',
  'src/features/recorded/api/recordedSearchAdapters.ts',
  'src/features/recorded/api/createRecordedActionMethods.ts',
  'src/features/recorded/api/recordedFetch.ts',
  'src/features/reserves/lib/reserveAdapters.ts',
  'src/features/reserves/lib/manualReserveAdapters.ts',
  'src/features/reserves/lib/manualReserveServerOptions.ts',
  'src/features/guide/lib/guideApiAdapters.ts',
  'src/features/onair/lib/onairApiAdapters.ts',
  'src/features/onair/lib/onairLiveStreamAdapters.ts',
  'src/features/dashboard/lib/dashboardRecordedAdapters.ts',
  'src/features/dashboard/lib/dashboardReserveAdapters.ts',
  'src/app/api/streamConfigAdapters.ts',
  'src/app/api/serverConfigAdapters.ts',
  'src/app/api/fetchServerApiRepository.ts',
  // 設定
  'src/features/settings/settingsControlRowsFront.ts',
  'src/features/settings/settingsControlRowsBack.ts',
  'src/features/settings/settingsControlMatrix.ts',
  'src/features/settings/settingsPreview.ts',
  'src/features/settings/settingsSave.ts',
  'src/features/settings/lib/settingsControlSupport.ts',
  'src/features/settings/lib/settingsControlOptions.ts',
  'src/shared/settings/adjacentStorageRegistry.ts',
  'src/shared/settings/urlScheme.ts',
  'src/shared/settings/urlSchemePlatform.ts',
  // shell・共通
  'src/app/navigation/items.ts',
  'src/app/navigation/routeMatching.ts',
  'src/app/navigation/regenerationRequest.ts',
  'src/app/realtime.ts',
  'src/app/realtimeInvalidation.ts',
  'src/app/drawerLayout.ts',
  'src/app/lib/serverConfigSelectors.ts',
  'src/app/lib/shellSettingsSnapshots.ts',
  'src/app/scroll/scrollHistoryContext.ts',
  'src/shared/legacyPaginationDesktop.ts',
  'src/shared/extendedPagination.ts',
  // 番組表の描画と配置
  'src/features/guide/GuideGridRenderer.ts',
  'src/features/guide/lib/guideGridLayout.ts',
  'src/features/guide/lib/guideGridDom.ts',
  'src/features/guide/lib/guideGridInteraction.ts',
  'src/features/guide/lib/guideGridVisibility.ts',
  'src/features/guide/lib/guidePageState.ts',
  'src/features/guide/lib/guideProgramText.ts',
  'src/features/guide/lib/programDialogText.ts',
  'src/features/guide/lib/programGenreLabels.ts',
  'src/features/guide/lib/guideSizeSettingForm.ts',
  // 表示の整形と文言
  'src/features/recorded/lib/recordedFormat.ts',
  'src/features/dashboard/lib/dashboardFormat.ts',
  'src/features/storages/upload/lib/uploadFormat.ts',
  'src/features/recording/lib/recordingFormat.ts',
  'src/features/reserves/lib/reserveLabels.ts',
  'src/features/reserves/lib/manualProgramFormat.ts',
  'src/features/search/rule/genreLabels.ts',
  'src/features/recorded/requests/extendedText.ts',
  'src/features/search/rule/lib/programDisplay.ts',
  'src/features/search/rule/lib/ruleListText.ts',
  // 検索・ルールの form
  'src/features/search/rule/lib/searchFormState.ts',
  'src/features/search/rule/lib/searchFormItems.ts',
  'src/features/search/rule/lib/ruleOptionDraft.ts',
  'src/features/search/rule/lib/genreSelection.ts',
  'src/features/search/rule/lib/searchPageInfo.ts',
  'src/features/search/rule/lib/pageScroll.ts',
  'src/features/search/rule/lib/channelSelectOptions.ts',
  // 放映中
  'src/features/onair/lib/onairStreams.ts',
  'src/features/onair/lib/onairWatch.ts',
  'src/features/onair/lib/liveStreamSelection.ts',
  // 再生
  'src/features/video/playback/playbackLifecycleController.ts',
  'src/features/video/playback/playbackLifecycleControllerBase.ts',
  'src/features/video/playback/playbackMedia.ts',
  'src/features/video/playback/playbackControls.ts',
  'src/features/video/playback/playbackStreamMetadata.ts',
  'src/features/video/playback/platformDetection.ts',
  'src/features/video/playback/lib/playbackShellSupport.ts',
]

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  // 通常の test と同じ設定を使う。sandbox は client の中身（public と src の .module.css を含む）を複製するので、
  // 除外する test は無い。vitest runner の `vitest.related`（既定で有効）により、動くのは mutate する file へ
  // import でたどり着ける test だけ。src の text を読む静的な guard の test 2 つ
  // （unittest/spec/dashboard/dashboardLayout.spec.test.tsx と unittest/imp/searchRule.scrollFab.imp.test.ts）は
  // sandbox では成り立たないが、読む file を import しないので動かない。import でたどり着ける位置に
  // そのような test が現れたら、mutation 専用の vitest 設定で理由を添えて除外する。
  vitest: { configFile: 'vite.config.ts' },
  mutate,
  // sandbox へ複製しない path。先頭の `/` で client 直下だけに限る。
  // `/.stryker-tmp*` は並行して流す run の sandbox（`.stryker-tmp-<名前>` など）で、
  // 複製すると dry run が遅くなる。
  ignorePatterns: [
    '/.stryker-tmp*',
    '/dist',
    '/e2e',
    '/visual',
    '/device',
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
