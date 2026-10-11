// 配信の本体の mutation testing（Stryker）の設定。`npm run mutation:delivery` で流す。
// 位置づけと運用は .kiro/steering/server-testing.md の「Mutation Testing」と docs/testing.md を参照。
// preflight・CI の gate ではない。
//
// 配信の本体（live・録画済みの stream の process の起動と後始末）の正しさは、単体 test に加えて
// process・file・HTTP を使う結合 test が確かめている。そのため対象 test に配信の結合 test を入れる
// （vitest.mutation.delivery.config.ts を参照）。

import base from './stryker.server.config.mjs';

const incrementalFile =
    process.env.EPGS_MUTATION_INCREMENTAL_FILE ?? 'test/server/.artifacts/mutation/incremental-delivery.json';

// `path:開始行-終了行` の形で範囲を絞れる。
const mutate = [
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
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
    ...base,
    vitest: {
        ...base.vitest,
        configFile: 'vitest.mutation.delivery.config.ts',
    },
    mutate,
    // 結合 test は 1 件が数秒かかるので、server の既定より長くする。
    timeoutMS: 60000,
    incrementalFile,
    jsonReporter: { fileName: 'reports/mutation/delivery/report.json' },
    htmlReporter: { fileName: 'reports/mutation/delivery/report.html' },
};
