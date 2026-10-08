import type * as apid from '../../../api.js';
import IEncodeManageModel from '../service/encode/IEncodeManageModel.js';

/**
 * 実際の削除要求を親process側へ送るための窓口。実装は`RecordedApiModel`が
 * `this.ipc.recorded.delete`（IPC経由で親processの削除処理を呼ぶ）を渡す。
 */
export interface ChildUserDeletionRequestPort {
    requestUserDeletion(recordedId: apid.RecordedId): Promise<void>;
}

/**
 * service child process側で、ユーザーによる録画削除要求を扱う。削除要求を親processへ送る前に、
 * 同録画に対する進行中のencode処理を先に止める（削除後にencodeが存在しないfileへ書き込むのを防ぐ）。
 */
export default class ServiceChildUserDeletionCoordinator {
    constructor(
        private readonly encode: Pick<IEncodeManageModel, 'cancelEncodeByRecordedId'>,
        private readonly request: ChildUserDeletionRequestPort,
    ) {}

    /**
     * 指定録画のencodeを停止してから、親processへ削除要求を送る。
     * @param recordedId 削除対象の録画ID。
     */
    public async deleteByUser(recordedId: apid.RecordedId): Promise<void> {
        await this.encode.cancelEncodeByRecordedId(recordedId);
        await this.request.requestUserDeletion(recordedId);
    }
}
