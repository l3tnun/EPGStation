import type * as apid from '../../../api.js';
import RecordedTag from '../../db/entities/RecordedTag.js';

/**
 * 録画済み番組に付与するタグ（RecordedTag）の変化を、発生元（タグ管理）から
 * 他の module へ通知するための event の契約。`emitXxx` は発生元が呼び出してイベントを
 * 発行し、`setXxx` は購読側がコールバックを登録する。実装は `RecordedTagEvent`。
 */
export default interface IRecordedTagEvent {
    /**
     * タグが新規作成されたことを通知する。
     * @param tag 作成されたタグ
     */
    emitCreated(tag: RecordedTag): void;
    /**
     * タグの内容（名前・色）が更新されたことを通知する。
     * @param tagId 更新されたタグの id
     */
    emitUpdated(tagId: apid.RecordedTagId): void;
    /**
     * 録画情報とタグが関連付けられたことを通知する。
     * @param tagId 関連付けられたタグの id
     * @param recordedId 関連付け先の録画情報 id
     */
    emitRelated(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void;
    /**
     * タグが削除されたことを通知する。
     * @param tagId 削除されたタグの id
     */
    emitDeleted(tagId: apid.RecordedTagId): void;
    /**
     * 録画情報とタグの関連付けが解除されたことを通知する。
     * @param tagId 対象のタグの id
     * @param recordedId 対象の録画情報 id
     */
    emitDeletedRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void;
    /**
     * `emitCreated` を購読する。
     * @param callback 作成されたタグを受け取るコールバック
     */
    setCreated(callback: (tag: RecordedTag) => void): void;
    /**
     * `emitUpdated` を購読する。
     * @param callback 更新されたタグの id を受け取るコールバック
     */
    setUpdated(callback: (tagId: apid.RecordedTagId) => void): void;
    /**
     * `emitRelated` を購読する。
     * @param callback 関連付けられたタグの id と録画情報 id を受け取るコールバック
     */
    setRelated(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void;
    /**
     * `emitDeleted` を購読する。
     * @param callback 削除されたタグの id を受け取るコールバック
     */
    setDeleted(callback: (tagId: apid.RecordedTagId) => void): void;
    /**
     * `emitDeletedRelation` を購読する。
     * @param callback 関連付けが解除されたタグの id と録画情報 id を受け取るコールバック
     */
    setDeletedRelation(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void;
}
