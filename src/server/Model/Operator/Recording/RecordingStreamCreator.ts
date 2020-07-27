import * as http from 'http';
import Mirakurun from 'mirakurun';
import * as apid from '../../../../../node_modules/mirakurun/api';
import CreateMirakurunClient from '../../../Util/CreateMirakurunClient';
import Util from '../../../Util/Util';
import Model from '../../Model';
import { RecordingManageModelInterface } from '../Recording/RecordingManageModel';
import { ManualReserveProgram, ReserveProgram } from '../ReserveProgramInterface';

interface TunerProgram {
    reserve: ReserveProgram;
    stream: http.IncomingMessage | null;
}

interface TunerStatus {
    types: apid.ChannelType[];
    programs: TunerProgram[];
}

interface RecordingStreamCreatorInterface extends Model {
    setTuners(tuners: apid.TunerDevice[]): void;
    deleteProgram(deleteProgramId: apid.ProgramId): void;
    create(reserve: ReserveProgram): Promise<http.IncomingMessage>;
}

/**
 * RecordingStreamCreator
 * 録画時に Mirakurun から受ける stream を抽象化する
 */
class RecordingStreamCreator extends Model implements RecordingStreamCreatorInterface {
    private tuners: TunerStatus[] = [];
    private allowEndLack: boolean;

    constructor() {
        super();

        const config = this.config.getConfig();
        this.allowEndLack = typeof config.allowEndLack === 'undefined' ? true : config.allowEndLack;
    }

    /**
     * チューナ情報をセット
     * @param tuners: TunerDevice[]
     */
    public setTuners(tuners: apid.TunerDevice[]): void {
        // 一度だけ tuner 情報をセット
        if (this.tuners.length !== 0) { return; }

        this.tuners = tuners.map((tuner) => {
            return {
                types: tuner.types,
                programs: [],
            };
        });

        // 念の為 30 分毎ににゴミを削除
        setInterval(() => {
            const now = new Date().getTime();
            for (const tuner of this.tuners) {
                tuner.programs = tuner.programs.filter((p) => {
                    return now - p.reserve.program.endAt < (12 * 60 * 60 * 1000);
                });
            }
        }, 30 * 60 * 1000);
    }

    /**
     * 指定した programId のプログラムを削除する
     * @param programId: apid.ProgramId
     */
    public deleteProgram(programId: apid.ProgramId): void {
        for (const tuner of this.tuners) {
            for (let i = 0; i < tuner.programs.length; i++) {
                if (tuner.programs[i].reserve.program.id === programId) {
                    if (tuner.programs[i].stream !== null) {
                        tuner.programs[i].stream!.destroy();
                        tuner.programs[i].stream!.push(null); // eof 通知
                    }
                    tuner.programs.splice(i, 1);

                    return;
                }
            }
        }
    }

    /**
     * ストリーム生成
     * @param reserve: ReserveProgram
     * @return Promise<http.IncomingMessage>
     */
    public async create(reserve: ReserveProgram): Promise<http.IncomingMessage> {
        if (!this.allowEndLack || reserve.isConflict) {
            return this.getStream(reserve);
        }

        const tunerId = await this.getTunerId(reserve);
        // tuner が割り当てられなかった
        if (tunerId === null) {
            this.log.system.warn(`TunerAssignmentError programId: ${ reserve.program.id }, ${ reserve.program.name }`);

            return this.getStream(reserve);
        }

        // stream 取得
        const stream = this.getStream(reserve);

        // tuner に追加
        this.tuners[tunerId].programs.push({
            reserve: reserve,
            stream: null,
        });

        // stream 登録
        (async() => {
            // programs の位置を取得する
            const findProgram = () => {
                for (let i = 0; i < this.tuners[tunerId].programs.length; i++) {
                    if (this.tuners[tunerId].programs[i].reserve.program.id === reserve.program.id) {
                        return i;
                    }
                }

                return -1;
            };

            // プログラム位置取得
            const programPosition = findProgram();
            if (programPosition === -1) { return; } // プログラムが無かった

            try {
                // stream 登録
                const s = await stream;
                this.tuners[tunerId].programs[programPosition].stream = s;

                // stream 停止時に programs から削除する
                s.once('end', () => {
                    const position = findProgram();
                    if (position === -1) { return; }

                    this.tuners[tunerId].programs.splice(position, 1);
                });
            } catch (err) {
                this.tuners[tunerId].programs.splice(programPosition, 1);
            }
        })();

        return stream;
    }

    /**
     * 割当可能な tunerId を返す
     * @param reserve: ReserveProgram
     * @return Promise<number | null>
     */
    private async getTunerId(reserve: ReserveProgram): Promise<number | null> {
        // tuner に空きがないかチェック
        for (let i = 0; i < this.tuners.length; i++) {
            // tuner の放送波が一致 && 録画していない or channel が同一
            if (this.tuners[i].types.indexOf(reserve.program.channelType) !== -1 && (
                this.tuners[i].programs.length === 0
                || this.tuners[i].programs[0].reserve.program.channel === reserve.program.channel
            )) {
                return i;
            }
        }

        // 末尾を削ることで終了できる tuner を探す
        const now = new Date().getTime();
        for (let i = 0; i < this.tuners.length; i++) {
            if (this.tuners[i].types.indexOf(reserve.program.channelType) !== -1) {
                let isOk = true;
                for (const p of this.tuners[i].programs) {
                    if (!(!!p.reserve.allowEndLack) || p.reserve.program.endAt - now > RecordingManageModelInterface.prepTime) {
                        isOk = false;
                        break;
                    }
                }

                // 末尾が削れない or 終了時刻が合わない
                if (!isOk) { continue; }

                // Mirakurun から最新の番組情報を取得して延長がないか確認
                const mirakurun = CreateMirakurunClient.get();
                for (const p of this.tuners[i].programs) {
                    // 時刻指定予約はスキップ
                    if (!!(<ManualReserveProgram> p.reserve).isTimeSpecified) { continue; }

                    try {
                        const newProgram = await mirakurun.getProgram(p.reserve.program.id);
                        if ((newProgram.startAt + newProgram.duration) - now > RecordingManageModelInterface.prepTime) {
                            // 延長があった
                            isOk = false;
                            break;
                        }
                    } catch (err) {
                        this.log.system.warn(`tuner program get error: ${ p.reserve.program.id }`);
                    }
                }

                // 延長があった
                if (!isOk) { continue; }

                // ストリーム停止
                for (const p of this.tuners[i].programs) {
                    if (p.stream !== null) {
                        p.stream.destroy();
                        p.stream.push(null); // eof 通知
                    }
                }

                // program 削除
                this.tuners[i].programs = [];

                return i;
            }
        }

        // 割り当てられる tuner が無かった
        return null;
    }

    /**
     * ストリーム取得
     * @param reserve: ReserveProgram
     * @return Promise<http.IncomingMessage>
     */
    private getStream(reserve: ReserveProgram): Promise<http.IncomingMessage> {
        const mirakurun = CreateMirakurunClient.get();
        const config = this.config.getConfig();
        const priority = reserve.isConflict ? (config.conflictPriority || 1) : (config.recPriority || 2);
        mirakurun.priority = priority;

        if (reserve.program.id >= 0) {
            // programId 指定予約
            return mirakurun.getProgramStream(reserve.program.id, true, priority);
        } else {
            // 時刻指定予約
            return this.getTimeSpecifiedStream(reserve, mirakurun, priority);
        }
    }

    /**
     * 時刻指定予約用の stream を返す
     * @param reserve: ReserveProgram
     * @param mirakurun: Mirakurun
     * @param priority: number
     * @return http.IncomingMessage
     */
    private async getTimeSpecifiedStream(reserve: ReserveProgram, mirakurun: Mirakurun, priority: number): Promise<http.IncomingMessage> {
        const config = this.config.getConfig();
        const startMargin = config.timeSpecifiedStartMargin || 1;
        const endMargin = config.timeSpecifiedEndMargin || 1;

        const now = new Date().getTime();
        if (reserve.program.endAt < now) {
            // 終了時刻が過ぎていないかチェック
            throw new Error('TimeSpecifiedStreamTimeoutError');
        }

        // mirakurun から channel stream を受け取る
        const channelStream = await mirakurun.getServiceStream(reserve.program.channelId, true, priority);

        // 予約終了時刻を過ぎたら stream を停止する
        const endTimer = setTimeout(() => {
            if (channelStream !== null) {
                channelStream.destroy();
                channelStream.push(null); // eof 通知
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

