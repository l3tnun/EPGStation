import factory from './ModelFactory';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import SQLite3Operator from './DB/SQLite3/SQLite3Operator';
import MySQLServicesDB from './DB/MySQL/MySQLServicesDB';
import MySQLProgramsDB from './DB/MySQL/MySQLProgramsDB';
import MySQLRulesDB from './DB/MySQL/MySQLRulesDB';
import MySQLRecordedDB from './DB/MySQL/MySQLRecordedDB';
import MySQLEncodedDB from './DB/MySQL/MySQLEncodedDB';
import SQLite3ServicesDB from './DB/SQLite3/SQLite3ServicesDB';
import SQLite3ProgramsDB from './DB/SQLite3/SQLite3ProgramsDB';
import SQLite3RulesDB from './DB/SQLite3/SQLite3RulesDB';
import SQLite3RecordedDB from './DB/SQLite3/SQLite3RecordedDB';
import SQLite3EncodedDB from './DB/SQLite3/SQLite3EncodedDB';
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
            const operator = new MySQLOperator();
            factory.reg('ServicesDB', () => { return new MySQLServicesDB(operator) });
            factory.reg('ProgramsDB', () => { return new MySQLProgramsDB(operator) });
            factory.reg('RulesDB', () => { return new MySQLRulesDB(operator) });
            factory.reg('RecordedDB', () => { return new MySQLRecordedDB(operator) });
            factory.reg('EncodedDB', () => { return new MySQLEncodedDB(operator) });
        } else {
            // sqlite3
            const operator = new SQLite3Operator();
            factory.reg('ServicesDB', () => { return new SQLite3ServicesDB(operator) });
            factory.reg('ProgramsDB', () => { return new SQLite3ProgramsDB(operator) });
            factory.reg('RulesDB', () => { return new SQLite3RulesDB(operator) });
            factory.reg('RecordedDB', () => { return new SQLite3RecordedDB(operator) });
            factory.reg('EncodedDB', () => { return new SQLite3EncodedDB(operator) });
        }

        factory.reg('IPCServer', () => { return IPCServer.getInstance(); });
        factory.reg('ExternalProcessModel', () => { return new ExternalProcessModel(); });
    }
}

export default ModelFactorySetting;

