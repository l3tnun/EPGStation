import * as apid from '../../../../../node_modules/mirakurun/api';
import SQLite3Base from './SQLite3Base';
import * as DBSchema from '../DBSchema';
import { ServicesDBInterface } from '../ServicesDB';

/**
* ServicesDB
*/
class ServicesDB extends SQLite3Base implements ServicesDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Services } (`
            + 'id integer primary key unique, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'name text not null, '
            + 'remoteControlKeyId integer null, '
            + 'hasLogoData integer, '
            + 'channelType text, '
            + 'channelTypeId integer, '
            + 'channel text, '
            + 'type integer null'
            + ');'

        return this.runQuery(query);
    }

    /**
    * データ挿入
    * @param services: Services
    * @param isDelete: 挿入時に古いデータを削除するか true: 削除, false: 削除しない
    * @return Promise<void>
    */
    public insert(services: apid.Service[], isDelete: boolean = true): Promise<void> {
        let queryStr = `replace into ${ DBSchema.TableName.Services } (`
            + 'id, '
            + 'serviceId, '
            + 'networkId, '
            + 'name, '
            + 'remoteControlKeyId, '
            + 'hasLogoData, '
            + 'channelType, '
            + 'channelTypeId, '
            + 'channel, '
            + 'type '
        + ') VALUES ('
            + '?, ?, ?, ?, ?, ?, ?, ?, ?, ?'
        + ');';

        let datas: any[] = [];
        services.forEach((service) => {
            if(typeof service.channel === 'undefined') { return; }

            let data = [
                service.id,
                service.serviceId,
                service.networkId,
                service.name,
                typeof service.remoteControlKeyId === 'undefined' ? null : service.remoteControlKeyId,
                Boolean(service.hasLogoData),
                service.channel.type,
                this.getChannelTypeId(service.channel.type),
                service.channel.channel,
                typeof service['type'] === 'undefined' ? null : service['type']
            ];

            datas.push({ query: queryStr, values: data });
        });

        return this.manyInsert(DBSchema.TableName.Services, datas, isDelete);
    }

    /**
    * ChannelTypeId を取得する
    * @paramChannelTypeId
    */
    private getChannelTypeId(type: string): number {
        switch(type) {
            case 'GR':
                return 0;
            case 'BS':
                return 1;
            case 'CS':
                return 2;
            case 'SKY':
                return 3;
            default:
                return 4;
        }
    }

    /**
    * id 検索
    * @param id: id
    * @return Promise<DBSchema.ServiceSchema | null>
    */
    public async findId(id: number): Promise<DBSchema.ServiceSchema | null> {
        return this.getFirst(this.fixResult(<DBSchema.ServiceSchema[]> await this.runQuery(`select * from ${ DBSchema.TableName.Services } where id = ${ id }`)));
    }

    /**
    * @param services: DBSchema.ServiceSchema[]
    * @return DBSchema.ServiceSchema[]
    */
    private fixResult(services: DBSchema.ServiceSchema[]): DBSchema.ServiceSchema[] {
        return services.map((service) => {
            service.hasLogoData = Boolean(service.hasLogoData);
            return service;
        });
    }

    /**
    * 全件取得
    * @return Promise<DBSchema.ServiceSchema[]>
    */
    public async findAll(): Promise<DBSchema.ServiceSchema[]> {
        return this.fixResult(<DBSchema.ServiceSchema[]> await this.runQuery(`select * from ${ DBSchema.TableName.Services } order by channelTypeId, remoteControlKeyId, id`));
    }

    /**
    * 放送波指定取得
    * @param types GR | BS | CS | SKY
    * @return Promise<DBSchema.ServiceSchema[]>
    */
    public async findChannelType(types: (apid.ChannelType)[] ): Promise<DBSchema.ServiceSchema[]> {
        let str = '';
        types.forEach((type) => {
            str += `'${ type }',`
        });
        str = str.slice(0, -1);

        return this.fixResult(<DBSchema.ServiceSchema[]> await this.runQuery(`select * from ${ DBSchema.TableName.Services } where channelType in (${ str }) order by channelTypeId, remoteControlKeyId, id`));
    }
}

export default ServicesDB;

