import * as http from 'http';
import { inject, injectable } from 'inversify';
import { finished } from 'stream';
import type * as apid from '../../../../api.js';
import Reserve from '../../../db/entities/Reserve.js';
import Util from '../../../util/Util.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { BroadcastType, TunerInfo, TunerServerAccess, TunerStreamHandle } from '../../tuner/types.js';
import IRecordingStreamCreator, { RecordingStreamCreationOptions } from './IRecordingStreamCreator.js';

interface TunerProgram {
    reserve: Reserve;
    stream: http.IncomingMessage | null;
}

interface TunerStatus {
    types: BroadcastType[];
    programs: TunerProgram[];
}

interface TimerIndex {
    [key: number]: NodeJS.Timeout;
}

/** `IRecordingStreamCreator` の実装。詳細は `IRecordingStreamCreator` を参照。 */
@injectable()
export default class RecordingStreamCreator implements IRecordingStreamCreator {
    private log: ILogger;
    private config: IConfigFile;
    private tunerServerAccess: TunerServerAccess;
    /** tuner ごとに、現在その tuner を使っている予約（`programs`）を保持する。同一 tuner を
     *  複数の予約で共有できるか（同一放送波の重複録画等）の判定に使う。`setTuner`で
     *  1度だけ初期化される。 */
    private tuners: TunerStatus[] = [];
    /** reserveId → 「時刻指定予約のストリームを終了時刻に破棄する」timer の対応表。
     *  終了時刻の変更（`registerTimeSpecifiedEnd`）のたびに張り直される。 */
    private timerIndex: TimerIndex = {};
    /** `create`が返した`http.IncomingMessage`から、close操作を持つ元の`TunerStreamHandle`を
     *  引けるようにする対応表（streamそのものにはclose操作が無いため）。 */
    private readonly streamHandleIndex = new WeakMap<http.IncomingMessage, TunerStreamHandle>();
    /** 既に`close()`済みの`TunerStreamHandle`の集合。ストリーム終了検知（`finished`）と
     *  明示的な`closeStream`呼び出しが両方起こり得るため、二重closeを防ぐのに使う。 */
    private readonly closedStreamHandles = new WeakSet<TunerStreamHandle>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.tunerServerAccess = tunerServerAccess;
    }

    /**
     * tuner 情報セット
     * @param tuners: TunerInfo[]
     */
    public setTuner(tuners: TunerInfo[]): void {
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
                    const [program] = tuner.programs.splice(i, 1);
                    const programStream = program.stream;
                    if (programStream !== null) {
                        this.closeStream(programStream);
                    }
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
    public async create(
        reserve: Reserve,
        abortSignal?: AbortSignal,
        options?: RecordingStreamCreationOptions,
    ): Promise<http.IncomingMessage> {
        if (reserve.isConflict === true) {
            // tuner の割当がないのでそのままストリームを取得
            return this.getStream(reserve, abortSignal, options);
        }

        const tunerId = await this.getTunerId(reserve);
        if (tunerId === null) {
            // 割り当てられる tuner がなかった
            this.log.system.warn(`TunerAssignmentError programId: ${reserve.id}`);

            return this.getStream(reserve, abortSignal, options);
        }

        // stream 取得
        const stream = this.getStream(reserve, abortSignal, options);

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
                for (const p of this.tuners[i].programs) {
                    // 時刻指定予約はスキップ
                    if (p.reserve.programId === null) {
                        continue;
                    }

                    try {
                        const newProgram = await this.tunerServerAccess.getProgram(p.reserve.programId);
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
                const endingPrograms = this.tuners[i].programs;
                this.tuners[i].programs = [];
                for (const p of endingPrograms) {
                    if (p.stream !== null) {
                        this.closeStream(p.stream);
                    }
                    this.log.system.debug(`delete stream: ${p.reserve.id}`);
                }

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
    private getStream(
        reserve: Reserve,
        abortSignal?: AbortSignal,
        options?: RecordingStreamCreationOptions,
    ): Promise<http.IncomingMessage> {
        const priority = reserve.isConflict ? this.config.conflictPriority : this.config.recPriority;

        if (reserve.programId === null) {
            // 時刻指定予約
            return this.getTimeSpecifiedStream(reserve, priority, abortSignal, options);
        } else {
            // programId 指定予約
            return this.tunerServerAccess
                .openProgramStream({ programId: reserve.programId, priority, signal: abortSignal })
                .then(handle => this.adoptStream(handle));
        }
    }

    private adoptStream(handle: TunerStreamHandle): http.IncomingMessage {
        const stream = handle.stream as http.IncomingMessage;
        this.streamHandleIndex.set(stream, handle);
        finished(stream, {}, () => {
            this.closeStreamHandle(handle);
        });
        return stream;
    }

    private closeStream(stream: http.IncomingMessage): void {
        const handle = this.streamHandleIndex.get(stream);
        if (handle !== undefined) {
            this.closeStreamHandle(handle);
        }
        stream.destroy();
        stream.push(null); // eof 通知
    }

    private closeStreamHandle(handle: TunerStreamHandle): void {
        if (this.closedStreamHandles.has(handle)) {
            return;
        }
        this.closedStreamHandles.add(handle);
        handle.close();
    }

    /**
     * 時刻指定予約の stream を返す
     * @param reserve: Reserve
     * @param mirakurun: Mirakurun
     * @return Promise<http.IncomingMessage>
     */
    private async getTimeSpecifiedStream(
        reserve: Reserve,
        priority: number,
        abortSignal?: AbortSignal,
        options?: RecordingStreamCreationOptions,
    ): Promise<http.IncomingMessage> {
        const now = new Date().getTime();
        if (reserve.endAt < now) {
            // 終了時刻が過ぎていないかチェック
            throw new Error('TimeSpecifiedStreamTimeoutError');
        }

        const ownsTimeSpecifiedEnd = options?.isTimeSpecifiedEndExternallyScheduled !== true;
        if (ownsTimeSpecifiedEnd) {
            // 予約終了時刻を過ぎたら stream を停止する
            this.timerIndex[reserve.id] = setTimeout(
                () => {
                    this.destroyStream(reserve);
                },
                reserve.endAt - now + 1000 * this.config.timeSpecifiedEndMargin,
            );
        }

        // mirakurun から channel stream を受け取る
        const channelStream = await this.tunerServerAccess
            .openServiceStream({ serviceId: reserve.channelId, priority, signal: abortSignal })
            .then(handle => this.adoptStream(handle))
            .catch(err => {
                this.log.system.error(`stream get error ${reserve.channelId}`);
                this.log.system.error(err);
                if (ownsTimeSpecifiedEnd) {
                    clearTimeout(this.timerIndex[reserve.id]);
                    delete this.timerIndex[reserve.id];
                }
                throw err;
            });

        if (ownsTimeSpecifiedEnd) {
            // 終了時に timer をリセット
            channelStream.once('end', () => {
                clearTimeout(this.timerIndex[reserve.id]);
                delete this.timerIndex[reserve.id];
            });
        }

        // 予約時間まで待つ
        const remaining = Math.max(0, reserve.startAt - 1000 * this.config.timeSpecifiedStartMargin - Date.now());
        if (remaining > 0) {
            const drainStream = (): void => undefined;
            channelStream.on('data', drainStream); // 読み込まないと stream がバッファに貯まるため
            try {
                await Util.sleep(remaining);
            } finally {
                channelStream.removeListener('data', drainStream);
            }
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
            this.closeStream(stream);
        }
    }

    public releaseTimeSpecifiedEnd(reserveId: number): void {
        clearTimeout(this.timerIndex[reserveId]);
        delete this.timerIndex[reserveId];
    }

    /**
     * 時刻指定予約の endAt を変更する
     * @param reserve
     */
    public changeEndAt(reserve: Reserve): void {
        if (reserve.programId !== null || typeof this.timerIndex[reserve.id] === 'undefined') {
            throw new Error('StreamChangeAtError');
        }

        // timer 再設定（旧 end の handle を clear してから差し替え、最新 end のみが発火する）
        clearTimeout(this.timerIndex[reserve.id]);
        this.timerIndex[reserve.id] = setTimeout(
            () => {
                this.destroyStream(reserve);
            },
            reserve.endAt - new Date().getTime() + 1000 * this.config.timeSpecifiedEndMargin,
        );
    }
}
