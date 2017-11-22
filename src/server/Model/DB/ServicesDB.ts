import * as apid from '../../../../node_modules/mirakurun/api';
import DBBase from './DBBase';
import * as DBSchema from './DBSchema';

interface ServicesDBInterface extends DBBase {
    create(): Promise<void>;
    insert(services: apid.Service[], isDelete?: boolean): Promise<void>;
    findId(id: number): Promise<DBSchema.ServiceSchema | null>;
    findAll(): Promise<DBSchema.ServiceSchema[]>;
    findChannelType(types: (apid.ChannelType)[] ): Promise<DBSchema.ServiceSchema[]>;
}

export { ServicesDBInterface };

