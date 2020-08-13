import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import RecordedTag from '../../../db/entities/RecordedTag';
import IRecordedTagDB from '../../db/IRecordedTagDB';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordedTagManadeModel from './IRecordedTagManadeModel';

@injectable()
export default class RecordedTagManadeModel implements IRecordedTagManadeModel {
    private log: ILogger;
    private recordedTagDB: IRecordedTagDB;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IRecordedTagDB') recordedTagDB: IRecordedTagDB) {
        this.log = logger.getLogger();
        this.recordedTagDB = recordedTagDB;
    }

    /**
     * 新しい tag の作成
     * @param name: tag 名
     * @return Promise<apid.RecordedTagId>
     */
    public async create(name: string): Promise<apid.RecordedTagId> {
        const newTag = new RecordedTag();
        newTag.name = name;
        const tagId = await this.recordedTagDB.insertOnce(newTag).catch(err => {
            this.log.system.error(`create tag error: ${name}`);
            throw err;
        });
        this.log.system.info(`create tag name: ${name} id: ${tagId}`);

        return tagId;
    }

    /**
     * tag 名更新
     * @param tagId: apid.RecordedTagId
     * @param name: name: string
     * @return Promise<void>
     */
    public async updateName(tagId: apid.RecordedTagId, name: string): Promise<void> {
        await this.recordedTagDB.updateName(tagId, name);
        this.log.system.info(`update tag name tagId: ${tagId}, name: ${name}`);
    }

    /**
     * tagId と recordedId の関連付け
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.recordedTagDB.setRelation(tagId, recordedId).catch(err => {
            this.log.system.error(`set tag relation error tagId: ${tagId} recordedId: ${recordedId}`);
            throw err;
        });
        this.log.system.info(`set tag relation tagId: ${tagId} recordedId: ${recordedId}`);
    }

    /**
     * tag の削除
     * @param tagId: apid.RecordedTagId
     * @return Promise<void>
     */
    public async delete(tagId: apid.RecordedTagId): Promise<void> {
        await this.recordedTagDB.deleteOnce(tagId).catch(err => {
            this.log.system.error(`delete tag error: ${name}`);
            throw err;
        });
        this.log.system.info(`delete tag id: ${tagId}`);
    }

    /**
     * tagId と recordedId の関連を削除する
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        await this.recordedTagDB.deleteRelation(tagId, recordedId).catch(err => {
            this.log.system.error(`delete tag relation error tagId: ${tagId} recordedId: ${recordedId}`);
            throw err;
        });
        this.log.system.info(`delete tag relation tagId: ${tagId} recordedId: ${recordedId}`);
    }
}
