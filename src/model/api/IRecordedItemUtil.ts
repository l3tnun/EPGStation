import type * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import { EncodeRecordedIdIndex } from '../service/encode/IEncodeManageModel.js';

/** DBの`Recorded`エンティティを、API応答形式の`RecordedItem`へ変換する契約。実装は`RecordedItemUtil`。 */
export default interface IRecordedItemUtil {
    /**
     * `Recorded`を`RecordedItem`へ変換する。`null`のフィールドは結果から省略し、
     * `isHalfWidth`により半角/全角どちらの名称・説明を採用するかを切り替える。
     * @param recorded 変換元のDBエンティティ。
     * @param isHalfWidth 半角文字の項目（`halfWidthName`等）を採用するか。
     * @param encodeIndex 録画IDごとの実行中エンコード情報。未指定の場合はエンコード無しとして扱う（`isEncoding`が常に`false`になる）。
     * @returns API応答用の録画項目。
     */
    convertRecordedToRecordedItem(
        recorded: Recorded,
        isHalfWidth: boolean,
        encodeIndex?: EncodeRecordedIdIndex,
    ): apid.RecordedItem;
}
