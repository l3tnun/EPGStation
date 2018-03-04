import Mirakurun from 'mirakurun';
import Base from './Base';
import DBTableBase from './Model/DB/DBTableBase';
import factory from './Model/ModelFactory';
import CreateMirakurunClient from './Util/CreateMirakurunClient';
import Util from './Util/Util';

/**
 * ConnectionChecker
 */
class ConnectionChecker extends Base {
    private mirakurun: Mirakurun;
    private db: DBTableBase;

    constructor() {
        super();

        this.mirakurun = CreateMirakurunClient.get();
        this.db = <DBTableBase> factory.get('ProgramsDB');
    }

    /**
     * check mirakurun
     * @param mirakurun: Mirakurun
     */
    public async checkMirakurun(): Promise<void> {
        try {
            await this.mirakurun.getStatus();
        } catch (err) {
            this.log.system.info('wait mirakurun');
            await Util.sleep(1000);

            return await this.checkMirakurun();
        }
    }

    /**
     * check db
     */
    public async checkDB(): Promise<void> {
        try {
            await this.db.ping();
        } catch (err) {
            this.log.system.info('wait DB');
            await Util.sleep(5000);
            await this.checkDB();
        }
    }
}

export default ConnectionChecker;

