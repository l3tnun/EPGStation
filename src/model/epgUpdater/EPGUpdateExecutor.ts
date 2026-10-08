import * as path from 'path';
import { fileURLToPath } from 'url';
import 'reflect-metadata';
import ILoggerModel from '../ILoggerModel.js';
import container from '../ModelContainer.js';
import * as containerSetter from '../ModelContainerSetter.js';
import IEPGUpdater from './IEPGUpdater.js';

interface EPGUpdateExecutorContainer {
    get<T>(serviceIdentifier: string): T;
}

/** `runEPGUpdateExecutor` の差し替え用オプション。主に test から DI container やログ設定を差し替えるために使う。 */
export interface RunEPGUpdateExecutorOptions {
    /** 省略時は本番用の `container`（`ModelContainerSetter.set` で構築）を使う。test 用の代替 container を渡せる。 */
    container?: EPGUpdateExecutorContainer;
    /** 省略時は `config/epgUpdaterLogConfig.yml`（このfileの配置基準で3階層上）を使う。 */
    logConfigPath?: string;
}

/**
 * EPG 更新用の子processのentry point。logger初期化・uncaughtException / unhandledRejection の
 * fatal ログ登録を行ったうえで `IEPGUpdater#start` を実行する。`start` が失敗した場合は
 * exit code 1 でprocessを終了させる。file末尾で、この file が直接起動された場合のみ
 * 引数無しで自動的に呼ばれる。
 * @param options DI container・ログ設定パスの差し替え（省略時は本番既定値）。
 */
export const runEPGUpdateExecutor = (options: RunEPGUpdateExecutorOptions = {}): void => {
    let targetContainer: EPGUpdateExecutorContainer;
    if (typeof options.container === 'undefined') {
        containerSetter.set(container);
        targetContainer = container;
    } else {
        targetContainer = options.container;
    }

    const logConfigPath =
        options.logConfigPath ?? path.join(import.meta.dirname, '..', '..', '..', 'config', 'epgUpdaterLogConfig.yml');

    const loggerModel = targetContainer.get<ILoggerModel>('ILoggerModel');
    loggerModel.initialize(logConfigPath);

    const log = loggerModel.getLogger();
    process.on('uncaughtException', err => {
        log.system.fatal(`uncaughtException: ${err}`);
    });

    process.on('unhandledRejection', err => {
        log.system.fatal(`unhandledRejection: ${err}`);
    });

    const updater = targetContainer.get<IEPGUpdater>('IEPGUpdater');

    (async () => {
        // 初回更新 or event stream 更新時にエラーが発生する
        await updater.start().catch(() => {
            process.exit(1);
        });
    })();
};

// この file が直接起動されたときだけ動かす。ESM に require.main は無いため、実行された
// script の path と自分の path を比べる。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runEPGUpdateExecutor();
}
