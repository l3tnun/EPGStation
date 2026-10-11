// server の mutation testing（Stryker）の設定。`npm run mutation:server` で流す。
// 位置づけと運用は .kiro/steering/server-testing.md の「Mutation Testing」と docs/testing.md を参照。
// preflight・CI の gate ではない。単体 test の層（spec・imp）だけを対象 test にする。

import { fileURLToPath } from 'node:url';

const tscPath = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url));

// incremental の cache。環境変数で別の場所に変えられる。消えたら全 mutant を流し直す。
const incrementalFile = process.env.EPGS_MUTATION_INCREMENTAL_FILE ?? 'test/server/.artifacts/mutation/incremental.json';

// 重要 module の一覧。評価対象を増やすときはここに足す。
// `path:開始行-終了行` の形で範囲を絞れる。
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
    // 配信の管理と HLS の stream id の割り当て
    'src/model/service/stream/manager/StreamManageModel.ts',
    'src/model/service/stream/manager/HlsStreamIdAllocator.ts',
    // 配信の本体（live・録画済みの stream、HLS の file の削除、録画済みの使用権と再生元）
    'src/model/service/stream/base/StreamBaseModel.ts',
    'src/model/service/stream/base/LiveStreamBaseModel.ts',
    'src/model/service/stream/base/RecordedStreamBaseModel.ts',
    'src/model/service/stream/LiveStreamModel.ts',
    'src/model/service/stream/LiveHLSStreamModel.ts',
    'src/model/service/stream/RecordedStreamModel.ts',
    'src/model/service/stream/RecordedHLSStreamModel.ts',
    'src/model/service/stream/util/HLSFileDeleterModel.ts',
    'src/model/service/stream/recorded/RecordedDeliveryLeaseConsumer.ts',
    'src/model/service/stream/recorded/RecordedPlaybackSourceConsumer.ts',
    'src/model/service/stream/recorded/DeliveryRecordedUseSnapshotProvider.ts',
    // EPG の更新と tuner server への接続
    'src/model/epgUpdater/EPGUpdateManageModel.ts',
    'src/model/tuner/TunerServerAccessModel.ts',
    'src/model/tuner/transport/ConnectionTargetParser.ts',
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
    ignorePatterns: [
        '/client',
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
