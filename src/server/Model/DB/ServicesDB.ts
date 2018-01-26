import * as apid from '../../../../node_modules/mirakurun/api';
import DBTableBase from './DBTableBase';
import * as DBSchema from './DBSchema';

interface ServicesDBInterface extends DBTableBase {
    create(): Promise<void>;
    insert(services: apid.Service[], isDelete?: boolean): Promise<void>;
    findId(id: number): Promise<DBSchema.ServiceSchema | null>;
    findAll(): Promise<DBSchema.ServiceSchema[]>;
    findChannelType(types: (apid.ChannelType)[] ): Promise<DBSchema.ServiceSchema[]>;
}

abstract class ServicesDB extends DBTableBase implements ServicesDBInterface {
    /**
    * get table name
    * @return string
    */
    protected getTableName(): string {
        return DBSchema.TableName.Services;
    }

    /**
    * create table
    * @return Promise<void>
    */
    abstract create(): Promise<void>;

    /**
    * データ挿入
    * @param services: Services
    * @param isDelete: 挿入時に古いデータを削除するか true: 削除, false: 削除しない
    * @return Promise<void>
    */
    public insert(services: apid.Service[], isDelete: boolean = true): Promise<void> {
        const isReplace = this.operator.getUpsertType() === 'replace';
        let queryStr = `${ isReplace ? 'replace' : 'insert' } into ${ DBSchema.TableName.Services } (`
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
            + this.operator.createValueStr(1, 10)
        + ')';

        if(!isReplace) {
            queryStr += ' on conflict (id) do update set '
                + 'serviceId = excluded.serviceId, '
                + 'networkId = excluded.networkId, '
                + 'name = excluded.name, '
                + 'remoteControlKeyId = excluded.remoteControlKeyId, '
                + 'hasLogoData = excluded.hasLogoData, '
                + 'channelType = excluded.channelType, '
                + 'channelTypeId = excluded.channelTypeId, '
                + 'channel = excluded.channel, '
                + 'type = excluded.type '
        }

        let datas: any[] = [];
        services.forEach((service) => {
            if(typeof service.channel === 'undefined') { return; }

            let data = [
                service.id,
                service.serviceId,
                service.networkId,
                service.name.replace(/\x00/g, ''), // PostgreSQL 非対応文字
                typeof service.remoteControlKeyId === 'undefined' ? null : service.remoteControlKeyId,
                Boolean(service.hasLogoData),
                service.channel.type,
                this.getChannelTypeId(service.channel.type),
                service.channel.channel,
                typeof service['type'] === 'undefined' ? null : service['type']
            ];

            datas.push({ query: queryStr, values: data });
        });

        return this.operator.manyInsert(DBSchema.TableName.Services, datas, isDelete);
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
        return this.operator.getFirst(this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } where id = ${ id }`)));
    }

    /**
    * @param services: DBSchema.ServiceSchema[]
    * @return DBSchema.ServiceSchema[]
    */
    protected fixResults(services: DBSchema.ServiceSchema[]): DBSchema.ServiceSchema[] {
        return services;
    }

    /**
    * 全件取得
    * @return Promise<DBSchema.ServiceSchema[]>
    */
    public async findAll(): Promise<DBSchema.ServiceSchema[]> {
        return this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } order by channelTypeId, remoteControlKeyId, id`));
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

        return this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } where channelType in (${ str }) order by channelTypeId, remoteControlKeyId, id`));
    }
}

export { ServicesDBInterface, ServicesDB };

