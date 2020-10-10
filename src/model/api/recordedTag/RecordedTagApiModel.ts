import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedTagDB from '../../db/IRecordedTagDB';
import IIPCClient from '../../ipc/IIPCClient';
import IRecordedTagApiModel from './IRecordedTagApiModel';

@injectable()
export default class RecordedTagApiModel implements IRecordedTagApiModel {
    private ipc: IIPCClient;
    private recordedTagDB: IRecordedTagDB;

    constructor(@inject('IIPCClient') ipc: IIPCClient, @inject('IRecordedTagDB') recordedTagDB: IRecordedTagDB) {
        this.ipc = ipc;
        this.recordedTagDB = recordedTagDB;
    }

    /**
     * 新しい tag の作成
     * @param name: tag 名
     * @param color: string
     * @return Promise<apid.RecordedTagId>
     */
    public async create(name: string, color: string): Promise<apid.RecordedTagId> {
        const tagId = await this.ipc.recordedTag.create(name, color);

        return tagId;
    }

    /**
     * tag 名更新
     * @param tagId: apid.RecordedTagId
     * @param name: string
     * @param color: string
     * @return Promise<void>
     */
    public async update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void> {
        await this.ipc.recordedTag.update(tagId, name, color);
    }

    /**
     * tagId と recordedId の関連付け
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.ipc.recordedTag.setRelation(tagId, recordedId);
    }

    /**
     * tag の削除
     * @param tagId: apid.RecordedTagId
     * @return Promise<void>
     */
    public async delete(tagId: apid.RecordedTagId): Promise<void> {
        await this.ipc.recordedTag.delete(tagId);
    }

    /**
     * tagId と recordedId の関連を削除する
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.ipc.recordedTag.deleteRelation(tagId, recordedId);
    }

    /**
     * tag 情報の取得
     * @return Promise<apid.RecordedTags>
     */
    public async gets(option: apid.GetRecordedTagOption): Promise<apid.RecordedTags> {
        const [tags, total] = await this.recordedTagDB.findAll(option);

        return {
            tags: tags.map(t => {
                return {
                    id: t.id,
                    name: t.name,
                    color: t.color,
                };
            }),
            total: total,
        };
    }
}
