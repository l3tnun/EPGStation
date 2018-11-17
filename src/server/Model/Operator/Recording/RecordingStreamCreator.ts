import * as http from 'http';
import Mirakurun from 'mirakurun';
import CreateMirakurunClient from '../../../Util/CreateMirakurunClient';
import Util from '../../../Util/Util';
import Model from '../../Model';
import { ReserveProgram } from '../ReserveProgramInterface';

interface RecordingStreamCreatorInterface extends Model {
    create(reserve: ReserveProgram): Promise<http.IncomingMessage>;
}

/**
 * RecordingStreamCreator
 * 録画時に Mirakurun から受ける stream を抽象化する
 */
class RecordingStreamCreator extends Model implements RecordingStreamCreatorInterface {
    /**
     * ストリーム生成
     * @param reserve: ReserveProgram
     * @return Promise<http.IncomingMessage>
     */
    public create(reserve: ReserveProgram): Promise<http.IncomingMessage> {
        const mirakurun = CreateMirakurunClient.get();
        mirakurun.priority = reserve.isConflict ? (this.config.getConfig().conflictPriority || 1) : (this.config.getConfig().recPriority || 2);

        if (reserve.program.id >= 0) {
            // programId 指定予約
            return mirakurun.getProgramStream(reserve.program.id, true);
        } else {
            // 時刻指定予約
            return this.getTimeSpecifiedStream(reserve, mirakurun);
        }
    }

    /**
     * 時刻指定予約用の stream を返す
     * @param reserve: ReserveProgram
     * @param mirakurun: Mirakurun
     * @return http.IncomingMessage
     */
    private async getTimeSpecifiedStream(reserve: ReserveProgram, mirakurun: Mirakurun): Promise<http.IncomingMessage> {
        const config = this.config.getConfig();
        const startMargin = config.timeSpecifiedStartMargin || 1;
        const endMargin = config.timeSpecifiedEndMargin || 1;

        const now = new Date().getTime();
        if (reserve.program.endAt < now) {
            // 終了時刻が過ぎていないかチェック
            throw new Error('TimeSpecifiedStreamTimeoutError');
        }

        // mirakurun から channel stream を受け取る
        const channelStream = await mirakurun.getServiceStream(reserve.program.channelId);

        // 予約終了時刻を過ぎたら stream を停止する
        const endTimer = setTimeout(() => {
            if (channelStream !== null) {
                channelStream.destroy();
            }
        }, reserve.program.endAt - now + (1000 * endMargin));

        // 終了時に timer をリセット
        channelStream.once('end', () => { clearTimeout(endTimer); });

        // 予約時間まで待つ
        if (now < reserve.program.startAt) {
            channelStream.on('data', () => {}); // 読み込まないと stream がバッファに貯まるため
            await Util.sleep(reserve.program.startAt - now - (1000 * startMargin));
            channelStream.removeAllListeners('data'); // clear
        }

        return channelStream;
    }
}

export { RecordingStreamCreatorInterface, RecordingStreamCreator };

