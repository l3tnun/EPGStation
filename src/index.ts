import * as child_process from 'child_process';
import * as path from 'path';
// tslint:disable-next-line:no-import-side-effect
import 'reflect-metadata';
import { install } from 'source-map-support';
import IEPGUpdateExecutorManageModel from './model/epgUpdater/IEPGUpdateExecutorManageModel';
import IEPGUpdateEvent from './model/event/IEPGUpdateEvent';
import IEventSetter from './model/event/IEventSetter';
import ILoggerModel from './model/ILoggerModel';
import IMirakurunClientModel from './model/IMirakurunClientModel';
import IIPCServer from './model/ipc/IIPCServer';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import IRecordingManageModel from './model/operator/recording/IRecordingManageModel';
import IReservationManageModel from './model/operator/reservation/IReservationManageModel';
install();

containerSetter.set(container);

/**
 * 初期処理
 */
const init = async () => {
    const logger = container.get<ILoggerModel>('ILoggerModel');
    logger.initialize();

    const log = logger.getLogger();
    process.on('uncaughtException', err => {
        log.system.fatal(`uncaughtException: ${err.message}`);
        log.system.fatal(err);
    });

    process.on('unhandledRejection', err => {
        log.system.fatal('unhandledRejection');
        log.system.fatal(err);
    });

    // TODO set gid & uid
    // TODO ping DB
    // TODO ping mirakurun
};

/**
 * Operator 機能起動処理
 */
const runOperator = async () => {
    const client = container.get<IMirakurunClientModel>('IMirakurunClientModel').getClient();

    const eventSetter = container.get<IEventSetter>('IEventSetter');
    eventSetter.set();

    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    const tuners = await client.getTuners();
    reservationManageModel.setTuners(tuners);
    recordingManager.setTuner(tuners);
};

/**
 * EPGUpdater 起動処理
 */
const runEPGUpdater = async () => {
    const epgUpdateExecutorManageModel = container.get<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel');
    epgUpdateExecutorManageModel.execute();
};

/**
 * Service 起動処理
 */
const runService = async () => {
    const child = child_process.spawn(
        process.argv[0],
        [path.join(__dirname, 'model', 'service', 'ServiceExecutor.js')],
        {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
    );

    // 終了したら再起動
    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    child.once('exit', () => {
        log.system.fatal('service process is down');
        log.system.fatal('restart service');
        runService();
    });
    child.once('error', () => {
        runService();
    });

    // buffer が埋まらないようにする
    if (child.stdout !== null) {
        child.stdout.on('data', () => {});
    }
    if (child.stderr !== null) {
        child.stderr.on('data', () => {});
    }

    // IPC 通信設定
    const ipcServer = container.get<IIPCServer>('IIPCServer');
    ipcServer.register(child);

    log.system.info(`start service pid: ${child.pid}`);

    // TODO ping pong
};

(async () => {
    await init();

    await runOperator();

    await runEPGUpdater();

    // await runService();
    const epgUpdateEvent = container.get<IEPGUpdateEvent>('IEPGUpdateEvent');
    epgUpdateEvent.setUpdatedOnce(async () => {
        await runService();
    });
})();
