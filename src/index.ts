import * as child_process from 'child_process';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import IEPGUpdateExecutorManageModel from './model/epgUpdater/IEPGUpdateExecutorManageModel.js';
import IEventSetter from './model/event/IEventSetter.js';
import IConfiguration from './model/IConfiguration.js';
import IConnectionCheckModel from './model/IConnectionCheckModel.js';
import ILoggerModel from './model/ILoggerModel.js';
import IIPCServer from './model/ipc/IIPCServer.js';
import container from './model/ModelContainer.js';
import * as containerSetter from './model/ModelContainerSetter.js';
import IRecordingManageModel from './model/operator/recording/IRecordingManageModel.js';
import IReservationManageModel from './model/operator/reservation/IReservationManageModel.js';
import IStorageManageModel from './model/operator/storage/IStorageManageModel.js';
import { TunerServerAccess } from './model/tuner/types.js';
import RuntimeStartupWorkflowPort, {
    RuntimeStartupWorkflowInput,
} from './model/workflow/RuntimeStartupWorkflowPort.js';
import observeStartupStage from './StartupStageObserver.js';
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

    const config = container.get<IConfiguration>('IConfiguration').getConfig();

    // set uid & gid
    if (process.platform !== 'win32' && typeof process.getuid !== 'undefined' && process.getuid() === 0) {
        // gid
        if (typeof process.setgid !== 'undefined') {
            if (typeof config.gid === 'string' || typeof config.gid === 'number') {
                process.setgid(config.gid);
            } else {
                process.setgid('video');
            }
        }

        // uid
        if (typeof process.setuid !== 'undefined') {
            if (typeof config.uid === 'string' || typeof config.uid === 'number') {
                process.setuid(config.uid);
            }
        }
    }

    // uid, gid が設定されてから再度 log 再設定
    logger.initialize(path.join(import.meta.dirname, '..', 'config', 'operatorLogConfig.yml'));

    // 接続確認
    const connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
    // wait mirakurun
    await connectionChecker.checkMirakurun();

    // wait DB
    await connectionChecker.checkDB();
};

/**
 * Operator 機能起動処理
 */
const runOperator = async () => {
    const tunerServerAccess = container.get<TunerServerAccess>('TunerServerAccess');

    const eventSetter = container.get<IEventSetter>('IEventSetter');
    eventSetter.set();

    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    const tuners = await tunerServerAccess.getTuners();
    reservationManageModel.setTuners(tuners);
    recordingManager.setTuner(tuners);

    const storageManageModel = container.get<IStorageManageModel>('IStorageManageModel');
    storageManageModel.start();
};

/**
 * Service 起動処理
 */
let activeServiceChild: child_process.ChildProcess | null = null;
let activeServiceGeneration: object | null = null;

const runService = async () => {
    const child = child_process.spawn(
        process.argv[0],
        [path.join(import.meta.dirname, 'model', 'service', 'ServiceExecutor.js')],
        {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
    );

    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    const generation = {};
    let terminalSettled = false;
    const onStdout = () => {};
    const onStderr = () => {};
    const onTerminal = () => {
        if (terminalSettled || activeServiceChild !== child || activeServiceGeneration !== generation) {
            return;
        }
        terminalSettled = true;
        const onLateError = () => {};
        const onLateClose = () => {
            child.removeListener('error', onLateError);
        };
        child.on('error', onLateError);
        child.once('close', onLateClose);
        detachListeners();
        activeServiceChild = null;
        activeServiceGeneration = null;
        log.system.fatal('service process is down');
        log.system.fatal('restart service');
        void runService();
    };
    const onError = () => {
        onTerminal();
    };
    const detachListeners = () => {
        child.removeListener('exit', onTerminal);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        if (child.stdout !== null) {
            child.stdout.removeListener('data', onStdout);
        }
        if (child.stderr !== null) {
            child.stderr.removeListener('data', onStderr);
        }
    };
    const onClose = () => {
        detachListeners();
    };
    child.once('exit', onTerminal);
    child.on('error', onError);
    child.once('close', onClose);

    // buffer が埋まらないようにする
    if (child.stdout !== null) {
        child.stdout.on('data', onStdout);
    }
    if (child.stderr !== null) {
        child.stderr.on('data', onStderr);
    }

    // IPC 通信設定
    const ipcServer = container.get<IIPCServer>('IIPCServer');
    activeServiceChild = child;
    activeServiceGeneration = generation;
    registerServiceAndStartWorkflow(ipcServer, child);

    log.system.info(`start service pid: ${child.pid}`);

    // TODO ping pong
};

const initializeIPC = async () => {
    const ipcServer = container.get<IIPCServer>('IIPCServer');
    await ipcServer.initialize();
};

type StartupStageName = 'recording-reconciliation' | 'recording-candidates-and-start' | 'expired-reservation-cleanup';

const recordStartupStageOverdue = (stage: StartupStageName): void => {
    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    log.system.error(`startup stage overdue: ${stage}`);
};

let epgSupervisorStarted = false;

const runEPGUpdater = async () => {
    const epgUpdateExecutorManageModel = container.get<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel');
    epgUpdateExecutorManageModel.execute();
};

const createObservedStartupWorkflowInput = (): RuntimeStartupWorkflowInput => {
    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    return {
        runRecordingReconciliation: () =>
            observeStartupStage(
                () => recordingManager.cleanup(),
                () => recordStartupStageOverdue('recording-reconciliation'),
            ),
        runRecordingCandidatesAndStart: () =>
            observeStartupStage(
                () => recordingManager.rebuildCandidatesAndStart(),
                () => recordStartupStageOverdue('recording-candidates-and-start'),
            ),
        runExpiredReservationCleanup: () =>
            observeStartupStage(
                () => reservationManageModel.cleanup(),
                () => recordStartupStageOverdue('expired-reservation-cleanup'),
            ),
        startEpgSupervisor: async () => {
            if (epgSupervisorStarted) return;
            epgSupervisorStarted = true;
            await runEPGUpdater();
        },
    };
};

let startupWorkflowStarted = false;

const runStartupWorkflow = (): void => {
    if (startupWorkflowStarted) return;
    startupWorkflowStarted = true;

    const startupWorkflow = container.get<RuntimeStartupWorkflowPort>('IRuntimeStartupWorkflowPort');
    void startupWorkflow
        .runAfterServiceSupervisionAccepted(createObservedStartupWorkflowInput())
        .then(outcome => {
            // The typed `Failed` outcome fulfils (it never rejects), so it must be recorded here
            // through the existing fatal path instead of relying on process-level unhandledRejection.
            if (outcome.kind === 'Failed') {
                const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
                const reason = outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause);
                log.system.fatal(`startup workflow failed at stage "${outcome.stage}": ${reason}`);
            }
        })
        .catch(() => undefined);
};

const registerServiceAndStartWorkflow = (ipcServer: IIPCServer, child: child_process.ChildProcess): void => {
    ipcServer.register(child);
    runStartupWorkflow();
};

(async () => {
    try {
        await init();
    } catch (err: any) {
        console.error('initialize error');
        console.error(err);
        process.exit(1);
    }

    await initializeIPC();

    await runOperator();

    await runService();
})();
