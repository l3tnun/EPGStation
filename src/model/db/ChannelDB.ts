import { inject, injectable } from 'inversify';
import { FindConditions } from 'typeorm';
// tslint:disable-next-line:no-submodule-imports
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Channel from '../../db/entities/Channel';
import StrUtil from '../../util/StrUtil';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IPromiseRetry from '../IPromiseRetry';
import IChannelDB, { ChannelUpdateValues } from './IChannelDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class ChannelDB implements IChannelDB {
    private log: ILogger;
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.log = logger.getLogger();
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
                channelType: channel.channel.type,
                channel: channel.channel.channel,
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
     * @return Promise<Channel[]>
     */
    public async findChannleTypes(types: apid.ChannelType[]): Promise<Channel[]> {
        const connection = await this.op.getConnection();

        const queryOption: FindConditions<Channel>[] = [];
        for (const type of types) {
            queryOption.push({
                channelType: type,
            });
        }

        const repository = connection.getRepository(Channel);

        return await this.promieRetry.run(() => {
            return repository.find({
                where: queryOption,
            });
        });
    }

    /**
     * 全件取得
     * @return Promise<Channel[]>
     */
    public async findAll(): Promise<Channel[]> {
        const connection = await this.op.getConnection();

        const repository = connection.getRepository(Channel);

        return await this.promieRetry.run(() => {
            return repository.find();
        });
    }
}
