import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import ILoggerModel from '../ILoggerModel.js';
import container from '../ModelContainer.js';
import * as containerSetter from '../ModelContainerSetter.js';
import IEncodeFinishModel from './encode/IEncodeFinishModel.js';
import IEncodeManageModel from './encode/IEncodeManageModel.js';
import IServiceServer from './IServiceServer.js';
install();

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(import.meta.dirname, '..', '..', '..', 'config', 'serviceLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

const encodeFinishModel = container.get<IEncodeFinishModel>('IEncodeFinishModel');
encodeFinishModel.set();

// 記録されたエンコードの依頼を一度だけ待機列へ戻す。HTTP の受付開始は待たせず、受付側が復元の完了を待つ。
// restore は失敗をログへ記録して reject しない（想定外の reject は上の unhandledRejection の監視が記録する）
void container.get<IEncodeManageModel>('IEncodeManageModel').restore();

const serviceServer = container.get<IServiceServer>('IServiceServer');
try {
    serviceServer.start();
} catch (err: any) {
    log.system.fatal(err);
    process.exit(1);
}
