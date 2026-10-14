// DB の query の class の mutation testing（Stryker）の設定。`npm run mutation:db` で流す。
// 位置づけと運用は .kiro/steering/server-testing.md の「Mutation Testing」と docs/testing.md を参照。
// preflight・CI の gate ではない。
//
// DB の class の単体 test（persistence の spec・imp）は query builder を偽物に差し替えているので、
// 正しい行が返るかは実 DB を使う結合 test が確かめている。そのため対象 test に結合 test の一部
// （SQLite・MySQL 9.7・MariaDB 12.3 の query の正しさを見る file）を入れる。
// MySQL は起動したままの server を使う（vitest.mutation.db.config.ts を参照）。MariaDB の接続先にも同じ
// MySQL を使う（製品に両者を区別する code は無く、mutant が通る経路が同じため）。

import base from './stryker.server.config.mjs';

const incrementalFile =
    process.env.EPGS_MUTATION_INCREMENTAL_FILE ?? 'test/server/.artifacts/mutation/incremental-db.json';

// `path:開始行-終了行` の形で範囲を絞れる。
const mutate = [
    'src/model/db/ProgramDB.ts',
    'src/model/db/RuleDB.ts',
    'src/model/db/RecordedDB.ts',
    'src/model/db/ReserveDB.ts',
    'src/model/db/RecordedTagDB.ts',
    'src/model/db/ChannelDB.ts',
    'src/model/db/VideoFileDB.ts',
    'src/model/db/ThumbnailDB.ts',
    'src/model/db/DropLogFileDB.ts',
    'src/model/db/RecordedHistoryDB.ts',
    'src/model/db/EncodeQueueDB.ts',
    'src/model/db/DBOperator.ts',
    'src/model/db/DBUtil.ts',
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
    ...base,
    vitest: {
        ...base.vitest,
        configFile: 'vitest.mutation.db.config.ts',
    },
    mutate,
    // 結合 test は 1 件が数秒かかり、DB の接続を待つので、server の既定より長くする。
    timeoutMS: 60000,
    incrementalFile,
    jsonReporter: { fileName: 'reports/mutation/db/report.json' },
    htmlReporter: { fileName: 'reports/mutation/db/report.html' },
};
