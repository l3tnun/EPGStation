import * as path from 'path'
import * as apid from '../../../node_modules/mirakurun/api';
import Mirakurun from 'mirakurun';
import CreateMirakurunClient from '../Util/CreateMirakurunClient';
import { Logger } from '../Logger';
import Configuration from '../Configuration';
import Base from '../Base';
import DBOperator from '../Model/DB/DBOperator';
import MySQLOperator from '../Model/DB/MySQL/MySQLOperator';
import SQLite3Operator from '../Model/DB/SQLite3/SQLite3Operator';
import PostgreSQLOperator from '../Model/DB/PostgreSQL/PostgreSQLOperator';
import MySQLServicesDB from '../Model/DB/MySQL/MySQLServicesDB';
import MySQLProgramsDB from '../Model/DB/MySQL/MySQLProgramsDB';
import SQLite3ServicesDB from '../Model/DB/SQLite3/SQLite3ServicesDB';
import SQLite3ProgramsDB from '../Model/DB/SQLite3/SQLite3ProgramsDB';
import PostgreSQLServicesDB from '../Model/DB/PostgreSQL/PostgreSQLServicesDB';
import PostgreSQLProgramsDB from '../Model/DB/PostgreSQL/PostgreSQLProgramsDB';
import { ServicesDBInterface } from '../Model/DB/ServicesDB';
import { ChannelTypeHash, ProgramsDBInterface } from '../Model/DB/ProgramsDB';
import Util from '../Util/Util';

/**
* Mirakurun のデータを取得して DB を更新する
*/
class MirakurunUpdater extends Base {
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private mirakurun: Mirakurun;

    private services: apid.Service[] = [];
    private programs: apid.Program[] = [];
    private tuners: apid.TunerDevice[] = [];

    /**
    * @param servicesDB: ServicesDB
    * @param programsDB: ProgramsDB
    */
    constructor(
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
    ) {
        super();
        this.servicesDB = servicesDB;
        this.programsDB = programsDB;

        this.mirakurun = CreateMirakurunClient.get();
    }

    /**
    * mirakurun から EPG データを取得して DB へ保存する
    * @param callback: すべての更新が終わったら呼ばれる
    */
    public update(): void {
        Promise.resolve()
        .then(() => {
            return this.mirakurun.getServices();
        })
        .then((services) => {
            console.log(`mirakurun -> services: ${ services.length }`);

            const excludeServices = this.config.getConfig().excludeServices || [];
            for(let i = 0; i < services.length; i++) {
                if(excludeServices.indexOf(services[i].id) !== -1) {
                    services.splice(i, 1);
                    i -= 1;
                }
            }

            this.services = services;

            return this.servicesDB.create();
        })
        .then(() => {
            console.log('create ServicesDB done.');
            return this.servicesDB.insert(this.services);
        })
        .then(() => {
            console.log('insert Services done');
            return this.mirakurun.getPrograms();
        })
        .then((programs) => {
            console.log(`mirakurun -> programs: ${ programs.length }`);
            this.programs = programs;

            return this.programsDB.create();
        })
        .then(() => {
            console.log('create ProgramsDB done.');

            // 放送波索引
            let channelTypes: ChannelTypeHash = {};
            for(let service of this.services) {
                if(typeof service.channel === 'undefined') { continue; }
                if(typeof channelTypes[service.networkId] === 'undefined') {
                    channelTypes[service.networkId] = {}
                }
                channelTypes[service.networkId][service.serviceId] = {
                    type: service.channel.type,
                    channel: service.channel.channel
                }
            }

            return this.programsDB.insert(channelTypes, this.programs);
        })
        .then(() => {
            console.log('insert Programs done.');
            return this.mirakurun.getTuners();
        })
        .then((tuners) => {
            console.log(`mirakurun => tuners: ${ tuners.length }`);
            this.tuners = tuners;

            //DB の pool 終了
            //DBBase を継承したクラスのインスタンスならどれでも良い
            return this.servicesDB.end()
        }).then(() => {
            //tuner 情報を親プロセスへ渡す
            if(typeof process.send !== 'undefined') {
                process.send({ msg: 'tuner', tuners: updater.getTuners() });
            }

            console.log('updater done');
        })
        .catch((error: any) => {
            console.error('mirakurun updater failed');
            console.error(error);
            process.exit(1);
        });
    }

    /**
    * @return tuners
    */
    public getTuners(): apid.TunerDevice[] {
        return this.tuners;
    }
}

namespace MirakurunUpdater {
    export const MIRAKURUN_UPDATE_EVENT = 'updateMirakurun';
}

//Base クラスで必須
Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', 'config', 'config.json'));

let operator: DBOperator;
let servicesDB: ServicesDBInterface;
let programsDB: ProgramsDBInterface;
switch(Util.getDBType()) {
    case 'mysql':
        operator = new MySQLOperator();
        servicesDB = new MySQLServicesDB(operator);
        programsDB = new MySQLProgramsDB(operator);
        break;

    case 'sqlite3':
        operator = new SQLite3Operator();
        servicesDB = new SQLite3ServicesDB(operator);
        programsDB = new SQLite3ProgramsDB(operator);
        break;

    case 'postgres':
        operator = new PostgreSQLOperator();
        servicesDB = new PostgreSQLServicesDB(operator);
        programsDB = new PostgreSQLProgramsDB(operator);
        break;
}

process.on('unhandledRejection', console.dir);

let updater = new MirakurunUpdater(servicesDB!, programsDB!);
updater.update();

