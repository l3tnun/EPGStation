import factory from './ModelFactory';
import MySQLServicesDB from './DB/MySQL/ServicesDB';
import MySQLProgramsDB from './DB/MySQL/ProgramsDB';
import MySQLRulesDB from './DB/MySQL/RulesDB';
import MySQLRecordedDB from './DB/MySQL/RecordedDB';
import MySQLEncodedDB from './DB/MySQL/EncodedDB';
import SQLite3ServicesDB from './DB/SQLite3/ServicesDB';
import SQLite3ProgramsDB from './DB/SQLite3/ProgramsDB';
import SQLite3RulesDB from './DB/SQLite3/RulesDB';
import SQLite3RecordedDB from './DB/SQLite3/RecordedDB';
import SQLite3EncodedDB from './DB/SQLite3/EncodedDB';
import { IPCServer } from './IPC/IPCServer';
import { ExternalProcessModel } from './ExternalProcessModel';
import Util from '../Util/Util';

/**
* Operator 用の Model 設定
*/
namespace ModelFactorySetting {
    /**
    * Model をセットする
    */
    export const init = (): void => {
        if(Util.getDBType() === 'mysql') {
            // mysql
            factory.reg('ServicesDB', () => { return new MySQLServicesDB() });
            factory.reg('ProgramsDB', () => { return new MySQLProgramsDB() });
            factory.reg('RulesDB', () => { return new MySQLRulesDB() });
            factory.reg('RecordedDB', () => { return new MySQLRecordedDB() });
            factory.reg('EncodedDB', () => { return new MySQLEncodedDB() });
        } else {
            // sqlite3
            factory.reg('ServicesDB', () => { return new SQLite3ServicesDB() });
            factory.reg('ProgramsDB', () => { return new SQLite3ProgramsDB() });
            factory.reg('RulesDB', () => { return new SQLite3RulesDB() });
            factory.reg('RecordedDB', () => { return new SQLite3RecordedDB() });
            factory.reg('EncodedDB', () => { return new SQLite3EncodedDB() });
        }

        factory.reg('IPCServer', () => { return IPCServer.getInstance(); });
        factory.reg('ExternalProcessModel', () => { return new ExternalProcessModel(); });
    }
}

export default ModelFactorySetting;

