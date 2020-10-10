import * as path from 'path';
import 'reflect-metadata';
import ILoggerModel from '../ILoggerModel';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IEPGUpdater from './IEPGUpdater';

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'epgUpdaterLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

const updater = container.get<IEPGUpdater>('IEPGUpdater');

(async () => {
    // 初回更新 or event stream 更新時にエラーが発生する
    await updater.start().catch(() => {
        process.exit(1);
    });
})();
