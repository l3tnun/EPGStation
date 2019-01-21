import * as apid from '../../../../node_modules/mirakurun/api';
import StrUtil from '../../Util/StrUtil';
import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

interface ServicesDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(services: apid.Service[], isDelete?: boolean): Promise<void>;
    findId(id: number): Promise<DBSchema.ServiceSchema | null>;
    findAll(needSort?: boolean): Promise<DBSchema.ServiceSchema[]>;
    findChannelType(types: apid.ChannelType[], needSort?: boolean): Promise<DBSchema.ServiceSchema[]>;
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
    public abstract create(): Promise<void>;

    /**
     * drop table
     */
    public drop(): Promise<void> {
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.Services }`);
    }

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

        if (!isReplace) {
            queryStr += ' on conflict (id) do update set '
                + 'serviceId = excluded.serviceId, '
                + 'networkId = excluded.networkId, '
                + 'name = excluded.name, '
                + 'remoteControlKeyId = excluded.remoteControlKeyId, '
                + 'hasLogoData = excluded.hasLogoData, '
                + 'channelType = excluded.channelType, '
                + 'channelTypeId = excluded.channelTypeId, '
                + 'channel = excluded.channel, '
                + 'type = excluded.type ';
        }

        const datas: any[] = [];
        services.forEach((service) => {
            if (typeof service.channel === 'undefined') { return; }

            const data = [
                service.id,
                service.serviceId,
                service.networkId,
                service.name.replace(/\x00/g, ''), // PostgreSQL 非対応文字
                typeof service.remoteControlKeyId === 'undefined' ? null : service.remoteControlKeyId,
                Boolean(service.hasLogoData),
                service.channel.type,
                this.getChannelTypeId(service.channel.type),
                service.channel.channel,
                typeof service['type'] === 'undefined' ? null : service['type'],
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
        switch (type) {
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
        const channel = this.operator.getFirst(this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } where id = ${ id }`)));

        return channel ? this.toHalfNameChannels([channel])[0] : null;
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
     * @param needSort: boolean true ソート済みの結果を返す
     * @return Promise<DBSchema.ServiceSchema[]>
     */
    public async findAll(needSort: boolean = false): Promise<DBSchema.ServiceSchema[]> {
        const channels = this.toHalfNameChannels(this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } order by channelTypeId, remoteControlKeyId, id`)));

        return needSort ? this.sortChannels(channels) : channels;
    }

    /**
     * sort channels
     * @param channels; DBSchema.ServiceSchema[]
     * @return DBSchema.ServiceSchema[];
     */
    private sortChannels(channels: DBSchema.ServiceSchema[]): DBSchema.ServiceSchema[] {
        const config = this.config.getConfig();
        let order: number[] = [];
        let key = 'id';
        if (typeof config.serviceOrder !== 'undefined') {
            order = config.serviceOrder;
        } else if (typeof config.serviceSidOrder !== 'undefined') {
            order = config.serviceSidOrder;
            key = 'serviceId';
        }

        let cnt = 0;
        order.forEach((id) => {
            const i = channels.findIndex((c) => {
                return c[key] === id;
            });

            if (i === -1) { return; }

            // tslint:disable-next-line
            const [channel] = channels.splice(i, 1);
            channels.splice(cnt, 0, channel);
            cnt += 1;
        });

        return channels;
    }

    /**
     * チャンネル一覧からチャンネル名を半角に変換
     * @param channels; DBSchema.ServiceSchema[]
     * @return DBSchema.ServiceSchema[];
     */
    private toHalfNameChannels(channels: DBSchema.ServiceSchema[]): DBSchema.ServiceSchema[] {
        const config = this.config.getConfig();
        if (config.convertDBStr !== 'oneByteWithCH') {
            // 変換しない
            return channels;
        }

        return channels.map(channel => {
            channel.name = StrUtil.toHalf(channel.name);

            return channel;
        });
    }

    /**
     * 放送波指定取得
     * @param types GR | BS | CS | SKY
     * @param needSort: boolean true ソート済みの結果を返す
     * @return Promise<DBSchema.ServiceSchema[]>
     */
    public async findChannelType(types: apid.ChannelType[], needSort: boolean = false): Promise<DBSchema.ServiceSchema[]> {
        let str = '';
        types.forEach((type) => {
            str += `'${ type }',`;
        });
        str = str.slice(0, -1);

        const channels = this.toHalfNameChannels(this.fixResults(<DBSchema.ServiceSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Services } where channelType in (${ str }) order by channelTypeId, remoteControlKeyId, id`)));

        return needSort ? this.sortChannels(channels) : channels;
    }
}

export { ServicesDBInterface, ServicesDB };

