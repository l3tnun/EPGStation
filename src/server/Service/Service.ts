import * as path from 'path';
import Configuration from '../Configuration';
import { Logger, LoggerInterface } from '../Logger';
import ModelFactorySetting from '../Model/ServiceModelFactorySetting';
import Server from './Server';

/**
 * Service
 */
class Service {
    private log: LoggerInterface;

    constructor() {
        this.init();
        process.on('uncaughtException', (error: Error) => {
            this.log.system.fatal(`uncaughtException: ${ error }`);
        });

        ModelFactorySetting.init();
    }

    /**
     * 初期設定
     */
    private init(): void {
        Logger.initialize(path.join(__dirname, '..', '..', '..', 'config', 'serviceLogConfig.json'));
        Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', 'config', 'config.json'), true);
        this.log = Logger.getLogger();
    }

    /**
     * run
     */
    public run(): void {
        new Server().start();
    }
}

export default Service;

