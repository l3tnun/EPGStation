import {
    RecordedPlaybackReader,
    RecordedPlaybackSource,
} from '../../../operator/recorded/IRecordedPlaybackSourceProvider.js';
import { VideoInfo } from '../../../api/video/IVideoUtil.js';

/**
 * `RecordedPlaybackSource`（種別が `encoded-direct` かどうかで形が異なる判別共用体）を、
 * `RecordedStreamBaseModel` が扱いやすい単一の形へ正規化した結果。
 */
export interface ConsumedRecordedPlaybackSource {
    readonly inputPath: string;
    readonly playPosition: number;
    /** エンコードプロセスへ直接渡す入力パス。`encoded-direct` 以外では null（reader 経由で読む）。 */
    readonly processInput: string | null;
    readonly recordedId: number;
    /** `encoded-direct` 以外の種別でのみ存在する、実データを読み出す reader。 */
    readonly reader?: RecordedPlaybackReader;
    readonly videoFileId: number;
    readonly videoInfo: VideoInfo;
}

/**
 * `RecordedPlaybackSource` の種別差（`encoded-direct` か否か）を吸収し、
 * `ConsumedRecordedPlaybackSource` という単一の形へ変換する。
 */
export default class RecordedPlaybackSourceConsumer {
    /**
     * ソースの種別に応じて `processInput`（直接入力パス）または `reader`（読み出し用 reader）
     * のいずれかを埋めた形へ変換する。
     */
    public consume(source: RecordedPlaybackSource): ConsumedRecordedPlaybackSource {
        if (source.kind === 'encoded-direct') {
            return {
                inputPath: source.inputPath,
                playPosition: source.playPosition,
                processInput: source.inputPath,
                recordedId: source.recordedId,
                videoFileId: source.videoFileId,
                videoInfo: source.videoInfo,
            };
        }

        return {
            inputPath: source.inputPath,
            playPosition: source.playPosition,
            processInput: null,
            recordedId: source.recordedId,
            reader: source.reader,
            videoFileId: source.videoFileId,
            videoInfo: source.videoInfo,
        };
    }
}
