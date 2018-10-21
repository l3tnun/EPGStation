import * as http from 'http';
import CreateMirakurunClient from '../../../Util/CreateMirakurunClient';
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
    public async create(reserve: ReserveProgram): Promise<http.IncomingMessage> {
        const mirakurun = CreateMirakurunClient.get();
        mirakurun.priority = reserve.isConflict ? (this.config.getConfig().conflictPriority || 1) : (this.config.getConfig().recPriority || 2);

        return await mirakurun.getProgramStream(reserve.program.id, true);
    }
}

export { RecordingStreamCreatorInterface, RecordingStreamCreator };

