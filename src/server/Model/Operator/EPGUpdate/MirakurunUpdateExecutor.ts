import * as path from 'path'
import { Logger } from '../../../Logger';
import Configuration from '../../../Configuration';
import DBOperator from '../../DB/DBOperator';
import MySQLOperator from '../../DB/MySQL/MySQLOperator';
import SQLite3Operator from '../../DB/SQLite3/SQLite3Operator';
import PostgreSQLOperator from '../../DB/PostgreSQL/PostgreSQLOperator';
import MySQLServicesDB from '../../DB/MySQL/MySQLServicesDB';
import MySQLProgramsDB from '../../DB/MySQL/MySQLProgramsDB';
import SQLite3ServicesDB from '../../DB/SQLite3/SQLite3ServicesDB';
import SQLite3ProgramsDB from '../../DB/SQLite3/SQLite3ProgramsDB';
import PostgreSQLServicesDB from '../../DB/PostgreSQL/PostgreSQLServicesDB';
import PostgreSQLProgramsDB from '../../DB/PostgreSQL/PostgreSQLProgramsDB';
import { ServicesDBInterface } from '../../DB/ServicesDB';
import { ProgramsDBInterface } from '../../DB/ProgramsDB';
import Util from '../../../Util/Util';
import MirakurunUpdater from './MirakurunUpdater';


//Base クラスで必須
Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', '..', '..', 'config', 'config.json'));

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

    case 'postgresql':
        operator = new PostgreSQLOperator();
        servicesDB = new PostgreSQLServicesDB(operator);
        programsDB = new PostgreSQLProgramsDB(operator);
        break;
}

process.on('unhandledRejection', console.dir);

let updater = new MirakurunUpdater(servicesDB!, programsDB!);
updater.update();

