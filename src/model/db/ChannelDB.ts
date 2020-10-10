import { inject, injectable } from 'inversify';
import { FindConditions } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Channel from '../../db/entities/Channel';
import StrUtil from '../../util/StrUtil';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IPromiseRetry from '../IPromiseRetry';
import IChannelDB, { ChannelUpdateValues } from './IChannelDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class ChannelDB implements IChannelDB {
    private log: ILogger;
    private configuration: IConfiguration;
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.log = logger.getLogger();
        this.configuration = configuration;
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * Mirakurun から取得した channel 情報を DB へ全件挿入する
     * @param channels: Service[]
     * @param needesDeleted: 更新前に全データ削除が必要か
     * @return Promise<void>
     */
    public async insert(channels: mapid.Service[], needesDeleted: boolean = true): Promise<void> {
        const values: QueryDeepPartialEntity<Channel>[] = [];

        // 挿入データ作成
        for (const channel of channels) {
            if (typeof channel.channel === 'undefined') {
                return;
            }

            const name = StrUtil.toDBStr(channel.name);
            values.push({
                id: channel.id,
                serviceId: channel.serviceId,
                networkId: channel.networkId,
                name: name,
                halfWidthName: StrUtil.toHalf(name),
                remoteControlKeyId:
                    typeof channel.remoteControlKeyId === 'undefined' ? null : channel.remoteControlKeyId,
                hasLogoData: !!channel.hasLogoData,
                channelTypeId: this.getChannelTypeId(channel.channel.type),
                channelType: channel.channel.type,
                channel: channel.channel.channel,
                type: typeof (channel as any)['type'] !== 'number' ? null : (channel as any)['type'],
            });
        }

        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        await queryRunner.startTransaction();

        let hasError = false;
        try {
            if (needesDeleted === true) {
                // 削除
                await queryRunner.manager.delete(Channel, {});
            }

            // 挿入処理
            for (const value of values) {
                await queryRunner.manager.insert(Channel, value).catch(async err => {
                    await queryRunner.manager.update(Channel, value.id, value).catch(serr => {
                        this.log.system.error('channel update error');
                        this.log.system.error(err);
                        this.log.system.error(serr);
                    });
                });
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            console.error(err);
            hasError = true;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('insert error');
        }
    }

    /**
     * ChannelTypeId を取得する
     * @paramChannelTypeId
     */
    private getChannelTypeId(type: mapid.ChannelType): number {
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
     * event stream 用更新
     * @param values ChannelUpdateValues
     * @return Promise<void>
     */
    public async update(values: ChannelUpdateValues): Promise<void> {
        const channels: mapid.Service[] = [];
        Array.prototype.push.apply(channels, values.insert);
        Array.prototype.push.apply(channels, values.update);

        await this.insert(channels, false);
    }

    /**
     * channel id を指定して検索
     * @param channelId: channel id
     * @return Promise<Channel | null>
     */
    public async findId(channelId: apid.ChannelId): Promise<Channel | null> {
        const connection = await this.op.getConnection();

        const repository = connection.getRepository(Channel);
        const result = await this.promieRetry.run(() => {
            return repository.findOne({
                where: [{ id: channelId }],
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * channelType を指定して検索
     * @param types: apid.ChannelType[]
     * @param needSort: boolean ソートが必要か default: false
     * @return Promise<Channel[]>
     */
    public async findChannleTypes(types: apid.ChannelType[], needSort: boolean = false): Promise<Channel[]> {
        const connection = await this.op.getConnection();

        const queryOption: FindConditions<Channel>[] = [];
        for (const type of types) {
            queryOption.push({
                channelType: type,
            });
        }

        const repository = connection
            .getRepository(Channel)
            .createQueryBuilder('channel')
            .where(queryOption)
            .orderBy('channel.channelTypeId, channel.remoteControlKeyId, channel.id', 'ASC');

        const result = await this.promieRetry.run(() => {
            return repository.getMany();
        });

        return needSort === true ? this.sortChannels(result) : result;
    }

    /**
     * 全件取得
     * @param needSort: boolean ソートが必要か default: false
     * @return Promise<Channel[]>
     */
    public async findAll(needSort: boolean = false): Promise<Channel[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Channel)
            .createQueryBuilder('channel')
            .orderBy('channel.channelTypeId, channel.remoteControlKeyId, channel.id', 'ASC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return needSort === true ? this.sortChannels(result) : result;
    }

    /**
     * Channel[] を config.yml に従ってソートして返す
     * @return Channel[]
     */
    private sortChannels(channels: Channel[]): Channel[] {
        const config = this.configuration.getConfig();

        let order: number[] = [];
        let key: string;
        if (typeof config.channelOrder !== 'undefined') {
            order = config.channelOrder;
            key = 'id';
        } else if (typeof config.sidOrder !== 'undefined') {
            order = config.sidOrder;
            key = 'serviceId';
        } else {
            return channels;
        }

        let cnt = 0;
        order.forEach(id => {
            const i = channels.findIndex(c => {
                return (c as any)[key] === id;
            });

            if (i === -1) {
                return;
            }

            const [channel] = channels.splice(i, 1);
            channels.splice(cnt, 0, channel);
            cnt += 1;
        });

        return channels;
    }
}
