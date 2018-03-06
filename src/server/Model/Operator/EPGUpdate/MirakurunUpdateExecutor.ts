import * as path from 'path';
import Configuration from '../../../Configuration';
import { Logger } from '../../../Logger';
import Util from '../../../Util/Util';
import DBOperator from '../../DB/DBOperator';
import MySQLOperator from '../../DB/MySQL/MySQLOperator';
import MySQLProgramsDB from '../../DB/MySQL/MySQLProgramsDB';
import MySQLServicesDB from '../../DB/MySQL/MySQLServicesDB';
import PostgreSQLOperator from '../../DB/PostgreSQL/PostgreSQLOperator';
import PostgreSQLProgramsDB from '../../DB/PostgreSQL/PostgreSQLProgramsDB';
import PostgreSQLServicesDB from '../../DB/PostgreSQL/PostgreSQLServicesDB';
import { ProgramsDBInterface } from '../../DB/ProgramsDB';
import { ServicesDBInterface } from '../../DB/ServicesDB';
import SQLite3Operator from '../../DB/SQLite3/SQLite3Operator';
import SQLite3ProgramsDB from '../../DB/SQLite3/SQLite3ProgramsDB';
import SQLite3ServicesDB from '../../DB/SQLite3/SQLite3ServicesDB';
import MirakurunUpdater from './MirakurunUpdater';


// Base クラスで必須
Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', '..', '..', 'config', 'config.json'));

let operator: DBOperator;
let servicesDB: ServicesDBInterface;
let programsDB: ProgramsDBInterface;
switch (Util.getDBType()) {
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

const updater = new MirakurunUpdater(servicesDB!, programsDB!);
updater.update();

