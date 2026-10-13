// server の mutation testing（Stryker）の設定。`npm run mutation:server` で流す。
// 位置づけと運用は .kiro/steering/server-testing.md の「Mutation Testing」と docs/testing.md を参照。
// preflight・CI の gate ではない。単体 test の層（spec・imp）だけを対象 test にする。

import { fileURLToPath } from 'node:url';

const tscPath = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url));

// incremental の cache。環境変数で別の場所に変えられる。消えたら全 mutant を流し直す。
const incrementalFile =
    process.env.EPGS_MUTATION_INCREMENTAL_FILE ?? 'test/server/.artifacts/mutation/incremental.json';

// 重要 module の一覧。評価対象を増やすときはここに足す。
// `path:開始行-終了行` の形で範囲を絞れる。
// DB の class（stryker.db.config.mjs）と配信の本体（stryker.delivery.config.mjs）は、結合 test も
// 対象 test に入れる専用の設定だけで流すので、ここには入れない。
const mutate = [
    // 予約の競合判定と tuner の割り当て
    'src/model/operator/reservation/ReservationManageModel.ts',
    'src/model/operator/reservation/Tuner.ts',
    // 録画の scheduler と録画候補の管理
    'src/model/operator/recording/RecordingScheduleController.ts',
    'src/model/operator/recording/RecordingCandidateRegistry.ts',
    // ルールの管理と予約 option の検査
    'src/model/operator/rule/RuleManageModel.ts',
    'src/model/operator/ReserveOptionChecker.ts',
    // 削除・保存の判断
    'src/model/operator/storage/StorageManageModel.ts',
    'src/model/operator/storage/StoragePressureDeletionAdapter.ts',
    'src/model/operator/recorded/PreparedDeletionTokenRegistry.ts',
    // 録画の実行・管理・stream・drop 検査
    'src/model/operator/recording/RecorderModel.ts',
    'src/model/operator/recording/RecordingManageModel.ts',
    'src/model/operator/recording/RecordingUtilModel.ts',
    'src/model/operator/recording/DropCheckerModel.ts',
    'src/model/operator/recording/RecordingStreamCreator.ts',
    // 設定の解釈
    'src/model/ConfigYaml.ts',
    'src/model/Configuration.ts',
    // file 名・日時・channel の処理
    'src/util/StrUtil.ts',
    'src/util/DateUtil.ts',
    'src/util/ChannelUtil.ts',
    'src/util/SubDirectoryUtil.ts',
    // 録画済みの管理・upload の取り込み・thumbnail・外部 command・file 操作
    'src/model/operator/recorded/RecordedManageModel.ts',
    'src/model/operator/recorded/RecordedUploadAdoptionModel.ts',
    'src/model/operator/thumbnail/ThumbnailManageModel.ts',
    'src/model/operator/externalCommand/ExternalCommandManageModel.ts',
    'src/util/FileUtil.ts',
    // 削除と起動の workflow
    'src/model/workflow/ParentUserDeletionCoordinator.ts',
    'src/model/workflow/ParentVideoFileDeletionCoordinator.ts',
    'src/model/workflow/RuntimeStartupWorkflowPort.ts',
    'src/model/workflow/ServiceChildUserDeletionCoordinator.ts',
    'src/model/workflow/StartupContinuationCoordinator.ts',
    // upload の受け付け
    'src/model/service/upload/UploadAdmissionController.ts',
    // エンコードの管理・実行・完了処理
    'src/model/service/encode/EncodeManageModel.ts',
    'src/model/service/encode/EncodeProcessManageModel.ts',
    'src/model/service/encode/EncoderModel.ts',
    'src/model/service/encode/EncodeFinishModel.ts',
    'src/model/service/encode/EncodeFileManageModel.ts',
    // エンコードの依頼の記録（管理側の依頼記録窓口）
    'src/model/operator/encode/EncodeQueueStore.ts',
    // 配信の管理と HLS の stream id の割り当て
    'src/model/service/stream/manager/StreamManageModel.ts',
    'src/model/service/stream/manager/HlsStreamIdAllocator.ts',
    // EPG の更新と tuner server への接続
    'src/model/epgUpdater/EPGUpdateManageModel.ts',
    'src/model/tuner/TunerServerAccessModel.ts',
    'src/model/tuner/transport/ConnectionTargetParser.ts',
    // tuner server への通信と変更の監視
    'src/model/tuner/transport/TunerHttpTransport.ts',
    'src/model/tuner/transport/TunerUserAgent.ts',
    'src/model/tuner/change/MirakurunChangeAdapter.ts',
    'src/model/tuner/change/MirakcChangeAdapter.ts',
    'src/model/tuner/change/ProductDetector.ts',
    // event と通知の配線
    'src/model/event/EventSetter.ts',
    'src/model/event/RecordingEvent.ts',
    'src/model/event/RecordedEvent.ts',
    'src/model/event/EncodeEvent.ts',
    'src/model/event/RuleEvent.ts',
    'src/model/event/RecordedTagEvent.ts',
    'src/model/event/ThumbnailEvent.ts',
    'src/model/event/EPGUpdateEvent.ts',
    'src/model/event/ReserveEvent.ts',
    'src/model/event/OperatorEncodeEvent.ts',
    'src/model/event/OperatorEncodeEventBinding.ts',
    'src/model/service/socketio/SocketIOManageModel.ts',
    // 録画済みの再生元・資源の排他、EPG 更新の実行、基盤の処理
    'src/model/operator/recorded/RecordedPlaybackSourceProvider.ts',
    'src/model/operator/recorded/RecordedResourceMutationLock.ts',
    'src/model/epgUpdater/EPGUpdater.ts',
    'src/model/epgUpdater/EPGUpdateExecutorManageModel.ts',
    'src/model/epgUpdater/EPGUpdateExecutor.ts',
    'src/lib/TailStream.ts',
    'src/model/ExecutionManagementModel.ts',
    'src/model/ServiceChildRecordedUseRegistry.ts',
    'src/model/LoggerModel.ts',
    'src/model/ConnectionCheckModel.ts',
    'src/model/PromiseRetry.ts',
    'src/model/PromiseQueue.ts',
    'src/model/ConfigurationFileAccess.ts',
    'src/model/operator/recording/RecordingRecordedUseProvider.ts',
    'src/model/operator/recordedTag/RecordedTagManadeModel.ts',
    'src/model/operator/storage/StorageRecordedUseSnapshotAdapter.ts',
    'src/util/ProcessUtil.ts',
    'src/util/Util.ts',
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
    testRunner: 'vitest',
    vitest: {
        configFile: 'vitest.mutation.server.config.ts',
        // server の test は src ではなく build した dist を読むので、変更 file から test を逆引きできない。
        related: false,
    },
    mutate,
    // Stryker が mutant を入れた src を sandbox で compile し、test はその dist を読む。
    // sandbox には node_modules が無い時点で実行されるので、tsc は元の repository の物を絶対 path で呼ぶ。
    buildCommand: `node ${tscPath}`,
    // sandbox へ複製しない path。先頭の `/` で repository root 直下だけに限る
    // （`recorded` のように書くと src/model/api/recorded/ なども除外されて module が見つからなくなる）。
    // `/.stryker-tmp*` は並行して流す run の sandbox（`.stryker-tmp-<名前>` など）で、
    // 複製すると dry run が遅くなる。
    ignorePatterns: [
        '/.stryker-tmp*',
        // client は server の test に使わないので複製しないが、依存の image の計画の test
        // （application-runtime/docker-dependency-images.spec.test.ts）が client の package.json と lock を読む。
        '/client/*',
        '!/client/package.json',
        '!/client/package-lock.json',
        '/docs',
        '/recorded',
        '/thumbnail',
        '/drop',
        '/logs',
        '/data',
        '/img',
        '/.claude',
        '/.agents',
        '/.kiro',
        '/.codex',
        '/.github',
        '/dist',
        '/test/server/.artifacts',
        '/reports',
        '*.log',
    ],
    coverageAnalysis: 'perTest',
    // module 先頭の定数表の mutant（static）に全 test を流さず、それを覆う test だけで実行する。
    ignoreStatic: true,
    concurrency: 2,
    timeoutMS: 40000,
    dryRunTimeoutMinutes: 30,
    incremental: true,
    incrementalFile,
    reporters: ['clear-text', 'progress', 'json', 'html'],
    jsonReporter: { fileName: 'reports/mutation/server/report.json' },
    htmlReporter: { fileName: 'reports/mutation/server/report.html' },
    tempDirName: '.stryker-tmp',
    cleanTempDir: true,
};
