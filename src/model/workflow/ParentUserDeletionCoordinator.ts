import type * as apid from '../../../api.js';
import IPreparedRecordedDeletionProvider, {
    UserDeletionPreparation,
} from '../operator/recorded/IPreparedRecordedDeletionProvider.js';

/**
 * 削除対象の録画が録画中だった場合に、その録画中の予約を止めるための窓口。実装は
 * `IPCServer`側から`IRecordingManageModel`の該当method（`hasReserve`/`cancelForDeletion`）を渡す。
 */
export interface RecordingDeletionPort {
    hasReservation(reserveId: apid.ReserveId): boolean;
    requestCancellationForDeletion(reserveId: apid.ReserveId): Promise<void>;
}

/**
 * ユーザー操作による録画情報削除を、「削除可能か検証してtokenを発行する（prepare）」
 * 「録画中なら予約を止める」「tokenを消費して実削除する（commit）」の順で調整する。
 * `IPreparedRecordedDeletionProvider`のprepare/commit二段構えと、`RecordingDeletionPort`による
 * 録画停止を組み合わせ、削除実行前に録画中の書き込みが確実に止まっていることを保証する。
 */
export default class ParentUserDeletionCoordinator {
    constructor(
        private readonly recordedDeletion: IPreparedRecordedDeletionProvider,
        private readonly recordingDeletion: RecordingDeletionPort,
    ) {}

    /**
     * 指定録画をユーザー要求として削除する。
     * @param recordedId 削除対象の録画ID。
     * @throws 録画情報が存在しない（`RecordedIdIsNotFound`）、保護されている（`RecordedIsProtected`）場合。
     */
    public async deleteFromRequest(recordedId: apid.RecordedId): Promise<void> {
        const preparation = await this.recordedDeletion.prepareUserDeletion(recordedId);
        this.rejectUnpreparedDeletion(preparation);
        await this.stopActiveRecording(preparation);
        await this.recordedDeletion.deletePrepared(preparation.token);
    }

    /**
     * `prepare`の結果が`prepared`以外なら、対応する例外を投げて処理を打ち切る。
     * @param preparation `prepareUserDeletion`の結果。
     */
    private rejectUnpreparedDeletion(
        preparation: UserDeletionPreparation,
    ): asserts preparation is Extract<UserDeletionPreparation, { readonly status: 'prepared' }> {
        if (preparation.status === 'not-found') throw new Error('RecordedIdIsNotFound');
        if (preparation.status === 'protected') throw new Error('RecordedIsProtected');
    }

    /**
     * 削除対象が録画中で、かつそれが現在把握している予約に対応する場合のみ、その予約を止める。
     * 録画中でない、または対応する予約が既に無い（`reserveId`が`null`、または
     * `recordingDeletion.hasReservation`が`false`）場合は何もしない。
     * @param preparation `prepareUserDeletion`が返した`prepared`状態の内容。
     */
    private async stopActiveRecording(
        preparation: Extract<UserDeletionPreparation, { readonly status: 'prepared' }>,
    ): Promise<void> {
        if (!preparation.isRecording || preparation.reserveId === null) return;
        if (!this.recordingDeletion.hasReservation(preparation.reserveId)) return;
        await this.recordingDeletion.requestCancellationForDeletion(preparation.reserveId);
    }
}
