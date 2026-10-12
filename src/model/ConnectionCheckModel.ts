import { inject, injectable } from 'inversify';
import Util from '../util/Util.js';
import IDBOperator from './db/IDBOperator.js';
import IConnectionCheckModel from './IConnectionCheckModel.js';
import ILogger from './ILogger.js';
import ILoggerModel from './ILoggerModel.js';
import { TunerServerAccess } from './tuner/types.js';

/**
 * `IConnectionCheckModel` の実装。起動直後に依存先（チューナーサーバー・DB）が使えるように
 * なるまで待つための、無限リトライのポーリングヘルパー。`checkMirakurun`/`checkDB` は
 * それぞれ対象への疎通が成功するまで、1秒間隔で再試行し続ける（失敗しても例外を投げない）。
 */
@injectable()
export default class ConnectionCheckModel implements IConnectionCheckModel {
    private log: ILogger;
    private tunerServerAccess: TunerServerAccess;
    private dbOperator: IDBOperator;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
        @inject('IDBOperator') dbOperator: IDBOperator,
    ) {
        this.log = logger.getLogger();
        this.tunerServerAccess = tunerServerAccess;
        this.dbOperator = dbOperator;
    }

    /**
     * mirakurun との接続を待つ
     * @return Promise<void>
     */
    public async checkMirakurun(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('check mirakurun');
                await this.tunerServerAccess.checkAvailability();
                break;
            } catch (err: any) {
                await Util.sleep(1000);
            }
        }
    }

    /**
     * DB との接続を待つ
     */
    public async checkDB(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('check db');
                await this.dbOperator.checkConnection();
                break;
            } catch (err: any) {
                await Util.sleep(1000);
            }
        }
    }
}
