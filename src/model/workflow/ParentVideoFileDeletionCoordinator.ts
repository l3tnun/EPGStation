import type * as apid from '../../../api.js';
import IPreparedRecordedDeletionProvider from '../operator/recorded/IPreparedRecordedDeletionProvider.js';
import IPreparedVideoFileDeletionProvider, {
    VideoFileDeletionPreparation,
    VideoFileDeletionResult,
} from '../operator/recorded/IPreparedVideoFileDeletionProvider.js';
import ParentUserDeletionCoordinator, { RecordingDeletionPort } from './ParentUserDeletionCoordinator.js';

/**
 * ユーザー操作によるビデオファイル単体の削除を調整する。単体削除できない場合
 * （録画中、または最後の1本）は`ParentUserDeletionCoordinator`へ委譲し、録画情報ごと削除する
 * （`IPreparedVideoFileDeletionProvider`の`whole-recorded-deletion-required`判定に従う）。
 */
export default class ParentVideoFileDeletionCoordinator {
    /** 単体削除できない場合の委譲先。`recordedDeletion`/`recordingDeletion`から自前で組み立てる。 */
    private readonly wholeDeletion: ParentUserDeletionCoordinator;

    constructor(
        private readonly videoDeletion: IPreparedVideoFileDeletionProvider,
        recordedDeletion: IPreparedRecordedDeletionProvider,
        recordingDeletion: RecordingDeletionPort,
    ) {
        this.wholeDeletion = new ParentUserDeletionCoordinator(recordedDeletion, recordingDeletion);
    }

    /**
     * 指定ビデオファイルをユーザー要求として削除する。単体削除できない場合は録画情報ごと削除する。
     * @param videoFileId 削除対象のビデオファイルID。
     * @throws ビデオファイルが存在しない、保護されている場合。
     */
    public async deleteVideoFileFromRequest(videoFileId: apid.VideoFileId): Promise<void> {
        const preparation = await this.videoDeletion.prepareVideoFileDeletion(videoFileId);
        await this.deletePreparation(preparation);
    }

    /**
     * `prepareVideoFileDeletion`の結果に応じて、単体削除の実行か録画情報ごとの削除への切り替えを行う。
     * @param preparation `prepareVideoFileDeletion`の結果。
     */
    private async deletePreparation(preparation: VideoFileDeletionPreparation): Promise<void> {
        if (preparation.status === 'not-found') throw new Error('VideoFileIsNotFound');
        if (preparation.status === 'protected') throw new Error('RecordedIsProtected');
        if (preparation.status === 'whole-recorded-deletion-required') {
            await this.wholeDeletion.deleteFromRequest(preparation.recordedId);
            return;
        }

        const result = await this.videoDeletion.deletePreparedVideoFile(preparation.token);
        await this.deleteResult(result);
    }

    /**
     * `deletePreparedVideoFile`の結果を処理する。単体削除が実は不可だった（prepare後に状態が
     * 変わった等で`whole-recorded-deletion-required`が返った）場合も、録画情報ごとの削除へ切り替える。
     * @param result `deletePreparedVideoFile`の結果。
     */
    private async deleteResult(result: VideoFileDeletionResult): Promise<void> {
        if (result.status === 'video-file-deleted') return;
        if (result.status === 'not-found') throw new Error('VideoFileIsNotFound');
        if (result.status === 'protected') throw new Error('RecordedIsProtected');
        await this.wholeDeletion.deleteFromRequest(result.recordedId);
    }
}
