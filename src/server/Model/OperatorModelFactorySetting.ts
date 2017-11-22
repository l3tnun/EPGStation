import factory from './ModelFactory';
import MySQLServicesDB from './DB/MySQL/ServicesDB';
import MySQLProgramsDB from './DB/MySQL/ProgramsDB';
import MySQLRulesDB from './DB/MySQL/RulesDB';
import MySQLRecordedDB from './DB/MySQL/RecordedDB';
import MySQLEncodedDB from './DB/MySQL/EncodedDB';
import { IPCServer } from './IPC/IPCServer';
import { ExternalProcessModel } from './ExternalProcessModel';

/**
* Operator 用の Model 設定
*/
namespace ModelFactorySetting {
    /**
    * Model をセットする
    */
    export const init = (): void => {
        factory.reg('ServicesDB', () => { return new MySQLServicesDB() });
        factory.reg('ProgramsDB', () => { return new MySQLProgramsDB() });
        factory.reg('RulesDB', () => { return new MySQLRulesDB() });
        factory.reg('RecordedDB', () => { return new MySQLRecordedDB() });
        factory.reg('EncodedDB', () => { return new MySQLEncodedDB() });
        factory.reg('IPCServer', () => { return IPCServer.getInstance(); });
        factory.reg('ExternalProcessModel', () => { return new ExternalProcessModel(); });
    }
}

export default ModelFactorySetting;

