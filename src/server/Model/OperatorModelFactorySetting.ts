import factory from './ModelFactory';
import { ServicesDB } from './DB/ServicesDB';
import { ProgramsDB } from './DB/ProgramsDB';
import { RulesDB } from './DB/RulesDB';
import { RecordedDB } from './DB/RecordedDB';
import { EncodedDB } from './DB/EncodedDB';
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
        factory.reg('ServicesDB', () => { return new ServicesDB() });
        factory.reg('ProgramsDB', () => { return new ProgramsDB() });
        factory.reg('RulesDB', () => { return new RulesDB() });
        factory.reg('RecordedDB', () => { return new RecordedDB() });
        factory.reg('EncodedDB', () => { return new EncodedDB() });
        factory.reg('IPCServer', () => { return IPCServer.getInstance(); });
        factory.reg('ExternalProcessModel', () => { return new ExternalProcessModel(); });
    }
}

export default ModelFactorySetting;
