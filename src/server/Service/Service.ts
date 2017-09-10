import * as path from 'path';
import { LoggerInterface, Logger } from '../Logger';
import Configuration from '../Configuration';
import Server from './Server';
import ModelFactorySetting from '../Model/ServiceModelFactorySetting';

/**
* Service
*/
class Service {
    private config: Configuration;
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
        Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', 'config', 'config.json'));
        this.log = Logger.getLogger();
        this.config = Configuration.getInstance();
    }

    /**
    * run
    */
    public run(): void {
        new Server().start();
    }
}

export default Service;

