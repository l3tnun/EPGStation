import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import Reserve from '../../../db/entities/Reserve';
import IReserveDB from '../../db/IReserveDB';
import IIPCClient from '../../ipc/IIPCClient';
import IReserveApiModel from './IReserveApiModel';

@injectable()
export default class ReserveApiModel implements IReserveApiModel {
    private ipc: IIPCClient;
    private reserveDB: IReserveDB;

    constructor(@inject('IIPCClient') ipc: IIPCClient, @inject('IReserveDB') reserveDB: IReserveDB) {
        this.ipc = ipc;
        this.reserveDB = reserveDB;
    }

    /**
     * 手動予約の追加
     * @param option: ManualReserveOption
     * @return ReserveId
     */
    public add(option: apid.ManualReserveOption): Promise<apid.ReserveId> {
        return this.ipc.reserveation.add(option);
    }

    /**
     * 手動予約の編集
     * @param reserveId: apid.ReserveId
     * @param option: apid.EditManualReserveOption
     * @return Promise<void>
     */
    public async edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void> {
        return this.ipc.reserveation.edit(reserveId, option);
    }

    /**
     * 指定した予約情報の取得
     * @param reserveId: apid.ReserveId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.ReserveItem | null>
     */
    public async get(reserveId: apid.ReserveId, isHalfWidth: boolean): Promise<apid.ReserveItem | null> {
        const reserve = await this.reserveDB.findId(reserveId);

        return reserve === null ? null : this.toReserveItem(reserve, isHalfWidth);
    }

    /**
     * 予約情報の取得
     * @param option: GetReserveOption
     * @return Promise<apid.Reserves>
     */
    public async gets(option: apid.GetReserveOption): Promise<apid.Reserves> {
        const [reserves, total] = await this.reserveDB.findAll(option);

        return {
            reserves: reserves.map(r => {
                return this.toReserveItem(r, option.isHalfWidth);
            }),
            total,
        };
    }

    /**
     * Reserve を ReserveItem へ変換する
     * @param reserves: Reserve
     * @param isHalfWidth: boolean 半角文字で返すか
     * @return ReserveItem
     */
    private toReserveItem(reserve: Reserve, isHalfWidth: boolean): apid.ReserveItem {
        const item: apid.ReserveItem = {
            id: reserve.id,
            isSkip: reserve.isSkip,
            isConflict: reserve.isConflict,
            isOverlap: reserve.isOverlap,
            allowEndLack: reserve.allowEndLack,
            isTimeSpecified: reserve.isTimeSpecified,
            isDeleteOriginalAfterEncode: reserve.isDeleteOriginalAfterEncode,
            channelId: reserve.channelId,
            startAt: reserve.startAt,
            endAt: reserve.endAt,
            name: isHalfWidth ? reserve.halfWidthName : reserve.name,
        };

        if (reserve.ruleId !== null) {
            item.ruleId = reserve.ruleId;
        }
        if (reserve.tags !== null) {
            item.tags = JSON.parse(reserve.tags);
        }
        if (reserve.parentDirectoryName !== null) {
            item.parentDirectoryName = reserve.parentDirectoryName;
        }
        if (reserve.directory !== null) {
            item.directory = reserve.directory;
        }
        if (reserve.recordedFormat !== null) {
            item.recordedFormat = reserve.recordedFormat;
        }
        if (reserve.encodeMode1 !== null) {
            item.encodeMode1 = reserve.encodeMode1;
        }
        if (reserve.encodeParentDirectoryName1 !== null) {
            item.encodeParentDirectoryName1 = reserve.encodeParentDirectoryName1;
        }
        if (reserve.encodeDirectory1 !== null) {
            item.encodeDirectory1 = reserve.encodeDirectory1;
        }
        if (reserve.encodeMode2 !== null) {
            item.encodeMode2 = reserve.encodeMode2;
        }
        if (reserve.encodeParentDirectoryName2 !== null) {
            item.encodeParentDirectoryName2 = reserve.encodeParentDirectoryName2;
        }
        if (reserve.encodeDirectory3 !== null) {
            item.encodeDirectory3 = reserve.encodeDirectory3;
        }
        if (reserve.encodeMode3 !== null) {
            item.encodeMode3 = reserve.encodeMode3;
        }
        if (reserve.encodeParentDirectoryName3 !== null) {
            item.encodeParentDirectoryName3 = reserve.encodeParentDirectoryName3;
        }
        if (reserve.encodeDirectory3 !== null) {
            item.encodeDirectory3 = reserve.encodeDirectory3;
        }
        if (reserve.programId !== null) {
            item.programId = reserve.programId;
        }
        if (reserve.description !== null) {
            if (isHalfWidth === true) {
                if (reserve.halfWidthDescription !== null) {
                    item.description = reserve.halfWidthDescription;
                }
            } else {
                item.description = reserve.description;
            }
        }
        if (reserve.extended !== null) {
            if (isHalfWidth === true) {
                if (reserve.halfWidthExtended !== null) {
                    item.extended = reserve.halfWidthExtended;
                }
            } else {
                item.extended = reserve.extended;
            }
        }
        if (reserve.genre1 !== null) {
            item.genre1 = reserve.genre1;
        }
        if (reserve.subGenre1 !== null) {
            item.subGenre1 = reserve.subGenre1;
        }
        if (reserve.genre2 !== null) {
            item.genre2 = reserve.genre2;
        }
        if (reserve.subGenre2 !== null) {
            item.subGenre2 = reserve.subGenre2;
        }
        if (reserve.genre3 !== null) {
            item.genre3 = reserve.genre3;
        }
        if (reserve.subGenre3 !== null) {
            item.subGenre3 = reserve.subGenre3;
        }
        if (reserve.videoType !== null) {
            item.videoType = <any>reserve.videoType;
        }
        if (reserve.videoResolution !== null) {
            item.videoResolution = <any>reserve.videoResolution;
        }
        if (reserve.videoStreamContent !== null) {
            item.videoStreamContent = reserve.videoStreamContent;
        }
        if (reserve.videoComponentType !== null) {
            item.videoComponentType = reserve.videoComponentType;
        }
        if (reserve.audioSamplingRate !== null) {
            item.audioSamplingRate = <any>reserve.audioSamplingRate;
        }

        return item;
    }

    /**
     * 予約情報のリスト
     * 予約, 除外, 重複, 競合の reserveId リストを返す
     * @param option: GetReserveListsOption
     * @return Promise<apid.ReserveLists>
     */
    public async getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists> {
        const reserves = await this.reserveDB.findLists(option);

        const result: apid.ReserveLists = {
            normal: [],
            conflicts: [],
            skips: [],
            overlaps: [],
        };

        for (const reserve of reserves) {
            const item = this.toReserveListItem(reserve);
            if (reserve.isConflict === true) {
                result.conflicts.push(item);
            } else if (reserve.isSkip === true) {
                result.skips.push(item);
            } else if (reserve.isOverlap === true) {
                result.overlaps.push(item);
            } else {
                result.normal.push(item);
            }
        }

        return result;
    }

    /**
     * 予約数を返す
     * @return Promise<apid.ReserveCnts>
     */
    public async getCnts(): Promise<apid.ReserveCnts> {
        const reserves = await this.reserveDB.findLists();

        const result: apid.ReserveCnts = {
            normal: 0,
            conflicts: 0,
            skips: 0,
            overlaps: 0,
        };

        for (const reserve of reserves) {
            if (reserve.isConflict === true) {
                result.conflicts++;
            } else if (reserve.isSkip === true) {
                result.skips++;
            } else if (reserve.isOverlap === true) {
                result.overlaps++;
            } else {
                result.normal++;
            }
        }

        return result;
    }

    /**
     * Reserve を ReserveListItem へ変換する
     * @param reserve: Reserve
     * @return ReserveListItem
     */
    private toReserveListItem(reserve: Reserve): apid.ReserveListItem {
        const result: apid.ReserveListItem = {
            reserveId: reserve.id,
        };

        if (reserve.programId !== null) {
            result.programId = reserve.programId;
        }
        if (reserve.ruleId !== null) {
            result.ruleId = reserve.ruleId;
        }

        return result;
    }

    /**
     * 予約キャンセル
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public cancel(reserveId: apid.ReserveId): Promise<void> {
        return this.ipc.reserveation.cancel(reserveId);
    }

    /**
     * 予約の除外状態を解除する
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public removeSkip(reserveId: apid.ReserveId): Promise<void> {
        return this.ipc.reserveation.removeSkip(reserveId);
    }

    /**
     * 予約の重複状態を解除する
     * @param reserveId: ReserveId
     * @return Promise<void>
     */
    public removeOverlap(reserveId: apid.ReserveId): Promise<void> {
        return this.ipc.reserveation.removeOverlap(reserveId);
    }

    /**
     * 全ての予約情報の更新
     * @return Promise<void>
     */
    public updateAll(): Promise<void> {
        return this.ipc.reserveation.updateAll(false);
    }
}
