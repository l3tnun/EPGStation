import type * as apid from '../../../api.js';
import Channel from '../../db/entities/Channel.js';
import { TunerService } from '../tuner/types.js';

/**
 * insert/update で channel を新規登録・更新する際に、追加分と更新分をまとめて渡すための入れ物。
 * tuner から取得した service 一覧を「新規に増えた channel」と「既存の channel の更新」に
 * 呼び出し側で仕分けた結果を保持する。
 */
export interface ChannelUpdateValues {
    insert: TunerService[];
    update: TunerService[];
}

/**
 * channel 情報の永続化を担う DB 層の契約。tuner から取得した service 一覧の反映と、
 * 番組表・API から参照するための channel 検索を提供する。実装は `ChannelDB`。
 */
export default interface IChannelDB {
    /**
     * tuner から取得した channel 一覧で DB を全件洗い替えする。
     * @param channels 洗い替え後の channel として登録する tuner service の一覧
     */
    insert(channels: TunerService[]): Promise<void>;
    /**
     * channel の変更差分（追加・更新）だけを反映する。全件削除は行わない点で `insert` と異なる。
     * @param values 追加分・更新分に仕分け済みの channel 一覧
     */
    update(values: ChannelUpdateValues): Promise<void>;
    /**
     * channel id を指定して 1 件取得する。
     * @param channelId 検索対象の channel id
     * @returns 該当する channel。存在しない場合は `null`
     */
    findId(channelId: apid.ChannelId): Promise<Channel | null>;
    /**
     * 指定した放送種別（地上波・BS 等）に属する channel を検索する。
     * @param types 絞り込み対象の放送種別の一覧
     * @param needSort `true` の場合、config.yml の channelOrder/sidOrder に従った並び順で返す
     * @returns 該当する channel の一覧
     */
    findChannleTypes(types: apid.ChannelType[], needSort?: boolean): Promise<Channel[]>;
    /**
     * 登録済みの channel を全件取得する。
     * @param needSort `true` の場合、config.yml の channelOrder/sidOrder に従った並び順で返す
     * @returns channel の一覧
     */
    findAll(needSort?: boolean): Promise<Channel[]>;
}
