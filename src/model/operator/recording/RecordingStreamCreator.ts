import * as http from 'http';
import { inject, injectable } from 'inversify';
import Mirakurun from 'mirakurun';
import { finished } from 'stream';
import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';
import Util from '../../../util/Util';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IRecordingStreamCreator from './IRecordingStreamCreator';

interface TunerProgram {
    reserve: Reserve;
    stream: http.IncomingMessage | null;
}

interface TunerStatus {
    types: mapid.ChannelType[];
    programs: TunerProgram[];
}

interface TimerIndex {
    [key: number]: NodeJS.Timeout;
}

@injectable()
export default class RecordingStreamCreator implements IRecordingStreamCreator {
    private log: ILogger;
    private config: IConfigFile;
    private mirakurunClientModel: IMirakurunClientModel;
    private tuners: TunerStatus[] = [];
    private timerIndex: TimerIndex = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IMirakurunClientModel')
        mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.mirakurunClientModel = mirakurunClientModel;
    }

    /**
     * tuner 情報セット
     * @param tuners: mapid.TunerDevice[]
     */
    public setTuner(tuners: mapid.TunerDevice[]): void {
        // 一度だけ tuner 情報をセット
        if (this.tuners.length !== 0) {
            return;
        }

        this.tuners = tuners.map(tuner => {
            return {
                types: tuner.types,
                programs: [],
            };
        });

        // 念の為 30 分毎ににゴミを削除
        setInterval(
            () => {
                const now = new Date().getTime();
                for (const tuner of this.tuners) {
                    tuner.programs = tuner.programs.filter(p => {
                        return now - p.reserve.endAt < 12 * 60 * 60 * 1000;
                    });
                }
            },
            30 * 60 * 1000,
        );
    }

    /**
     * 指定した reserveId の情報を削除する
     * @param reserveId: apid.ReserveId
     */
    private deleteReserve(reserveId: apid.ReserveId): void {
        // delete timer
        clearTimeout(this.timerIndex[reserveId]);
        delete this.timerIndex[reserveId];

        for (const tuner of this.tuners) {
            for (let i = 0; i < tuner.programs.length; i++) {
                if (tuner.programs[i].reserve.id === reserveId) {
                    const programStream = tuner.programs[i].stream;
                    if (programStream !== null) {
                        programStream.destroy();
                        programStream.push(null); // eof 通知
                    }
                    tuner.programs.splice(i, 1);
                    this.log.system.debug(`delete stream: ${reserveId}`);

                    return;
                }
            }
        }
    }

    /**
     * stream を生成する
     * @param reserve: Reserve
     * @return Promise<http.IncomingMessage>
     */
    public async create(reserve: Reserve, abortSignal?: AbortSignal): Promise<http.IncomingMessage> {
        if (reserve.isConflict === true) {
            // tuner の割当がないのでそのままストリームを取得
            return this.getStream(reserve, abortSignal);
        }

        const tunerId = await this.getTunerId(reserve);
        if (tunerId === null) {
            // 割り当てられる tuner がなかった
            this.log.system.warn(`TunerAssignmentError programId: ${reserve.id}`);

            return this.getStream(reserve, abortSignal);
        }

        // stream 取得
        const stream = this.getStream(reserve, abortSignal);

        // create tuner program
        const tunerProgram: TunerProgram = {
            reserve: reserve,
            stream: null,
        };

        // tuner に追加
        this.tuners[tunerId].programs.push(tunerProgram);

        try {
            // stream 登録
            const s = await stream;
            tunerProgram.stream = s;

            // stream 停止時に programs から削除する
            finished(tunerProgram.stream, {}, err => {
                if (err) {
                    this.log.system.error(`RecordingStreamCreator stream error: ${reserve.id}`);
                }
                this.deleteReserve(reserve.id);
            });
        } catch (err: any) {
            this.deleteReserve(reserve.id);
        }

        return stream;
    }

    /**
     * 割当可能な tunerId を返す
     * @param reserve: ReserveProgram
     * @return Promise<number | null>
     */
    private async getTunerId(reserve: Reserve): Promise<number | null> {
        // tuner に空きがないかチェック
        for (let i = 0; i < this.tuners.length; i++) {
            // tuner の放送波が一致 && 録画していない or channel が同一
            if (
                this.tuners[i].types.indexOf(<any>reserve.channelType) !== -1 &&
                (this.tuners[i].programs.length === 0 || this.tuners[i].programs[0].reserve.channel === reserve.channel)
            ) {
                return i;
            }
        }

        // 末尾を削ることで終了できる tuner を探す
        const now = new Date().getTime();
        for (let i = 0; i < this.tuners.length; i++) {
            if (this.tuners[i].types.indexOf(<any>reserve.channelType) !== -1) {
                let isOk = true;
                for (const p of this.tuners[i].programs) {
                    if (p.reserve.allowEndLack === false || p.reserve.endAt - now > IRecordingStreamCreator.PREP_TIME) {
                        isOk = false;
                        break;
                    }
                }

                // 末尾が削れない or 終了時刻が合わない
                if (isOk === false) {
                    continue;
                }

                // Mirakurun から最新の番組情報を取得して延長がないか確認
                const mirakurun = this.mirakurunClientModel.getClient();
                for (const p of this.tuners[i].programs) {
                    // 時刻指定予約はスキップ
                    if (p.reserve.programId === null) {
                        continue;
                    }

                    try {
                        const newProgram = await mirakurun.getProgram(p.reserve.programId);
                        if (newProgram.startAt + newProgram.duration - now > IRecordingStreamCreator.PREP_TIME) {
                            // 延長があった
                            isOk = false;
                            break;
                        }
                    } catch (err: any) {
                        this.log.system.warn(`tuner program get error: ${p.reserve.id}`);
                    }
                }

                // 延長があった
                if (isOk === false) {
                    continue;
                }

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
    private getStream(reserve: Reserve, abortSignal?: AbortSignal): Promise<http.IncomingMessage> {
        const mirakurun = this.mirakurunClientModel.getClient();
        mirakurun.priority = reserve.isConflict ? this.config.conflictPriority : this.config.recPriority;

        if (reserve.programId === null) {
            // 時刻指定予約
            return this.getTimeSpecifiedStream(reserve, mirakurun, abortSignal);
        } else {
            // programId 指定予約
            return mirakurun.getProgramStream({ id: reserve.programId, decode: true, signal: abortSignal });
        }
    }

    /**
     * 時刻指定予約の stream を返す
     * @param reserve: Reserve
     * @param mirakurun: Mirakurun
     * @return Promise<http.IncomingMessage>
     */
    private async getTimeSpecifiedStream(
        reserve: Reserve,
        mirakurun: Mirakurun,
        abortSignal?: AbortSignal,
    ): Promise<http.IncomingMessage> {
        const now = new Date().getTime();
        if (reserve.endAt < now) {
            // 終了時刻が過ぎていないかチェック
            throw new Error('TimeSpecifiedStreamTimeoutError');
        }

        // 予約終了時刻を過ぎたら stream を停止する
        this.timerIndex[reserve.id] = setTimeout(
            () => {
                this.destroyStream(reserve);
            },
            reserve.endAt - now + 1000 * this.config.timeSpecifiedEndMargin,
        );

        // mirakurun から channel stream を受け取る
        const channelStream = await mirakurun
            .getServiceStream({ id: reserve.channelId, decode: true, signal: abortSignal })
            .catch(err => {
                this.log.system.error(`stream get error ${reserve.channelId}`);
                this.log.system.error(err);
                clearTimeout(this.timerIndex[reserve.id]);
                delete this.timerIndex[reserve.id];
                throw err;
            });

        // 終了時に timer をリセット
        channelStream.once('end', () => {
            clearTimeout(this.timerIndex[reserve.id]);
            delete this.timerIndex[reserve.id];
        });

        // 予約時間まで待つ
        if (now < reserve.startAt) {
            channelStream.on('data', () => {}); // 読み込まないと stream がバッファに貯まるため
            await Util.sleep(reserve.startAt - now - 1000 * this.config.timeSpecifiedStartMargin);
            channelStream.removeAllListeners('data'); // clear
        }

        return channelStream;
    }

    /**
     * stream 停止
     * @param reserve: Reserve
     */
    private destroyStream(reserve: Reserve): void {
        clearTimeout(this.timerIndex[reserve.id]);
        delete this.timerIndex[reserve.id];

        let stream: http.IncomingMessage | null = null;
        for (const tuner of this.tuners) {
            for (const program of tuner.programs) {
                if (program.reserve.id === reserve.id) {
                    stream = program.stream;
                }
            }
        }

        if (stream !== null) {
            stream.destroy();
            stream.push(null); // eof 通知
        }
    }

    /**
     * 時刻指定予約の endAt を変更する
     * @param reserve
     */
    public changeEndAt(reserve: Reserve): void {
        if (reserve.programId !== null || typeof this.timerIndex[reserve.id] === 'undefined') {
            throw new Error('StreamChangeAtError');
        }

        // timer 再設定
        this.timerIndex[reserve.id] = setTimeout(
            () => {
                this.destroyStream(reserve);
            },
            reserve.endAt - new Date().getTime() + 1000 * this.config.timeSpecifiedEndMargin,
        );
    }
}
