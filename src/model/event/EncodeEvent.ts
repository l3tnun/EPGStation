import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEncodeEvent, { FinishEncodeInfo } from './IEncodeEvent';

@injectable()
class EncodeEvent implements IEncodeEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * エンコード追加イベント発行
     * @param encodeId: apid.EncodeId
     */
    public emitAddEncode(encodeId: apid.EncodeId): void {
        this.emitter.emit(EncodeEvent.ADD_ENCODE_EVENT, encodeId);
    }

    /**
     * エンコードキャンセルイベント発行
     * @param encodeId: apid.EncodeId
     */
    public emitCancelEncode(encodeId: apid.EncodeId): void {
        this.emitter.emit(EncodeEvent.CANCEL_ENCODE_EVENT, encodeId);
    }

    /**
     * エンコード完了イベント発行
     * @param info: FinishEncodeInfo
     */
    public emitFinishEncode(info: FinishEncodeInfo): void {
        this.emitter.emit(EncodeEvent.FINISH_ENCODE_EVENT, info);
    }

    /**
     * エンコード失敗イベント発行
     */
    public emitErrorEncode(): void {
        this.emitter.emit(EncodeEvent.ERROR_ENCODE_EVENT);
    }

    /**
     * エンコード進捗情報更新イベント発行
     */
    public emitUpdateEncodeProgress(): void {
        this.emitter.emit(EncodeEvent.UPDATE_ENCODE_PROGRESS_EVENT);
    }

    /**
     * エンコード更新イベント発行
     */
    public emitupdateEncode(): void {
        this.emitter.emit(EncodeEvent.UPDATE_ENCODE_EVENT);
    }

    /**
     * エンコード追加イベント登録
     * @param callback: (encodeId: apid.EncodeId) => void
     */
    public setAddEncode(callback: (encodeId: apid.EncodeId) => void): void {
        this.emitter.on(EncodeEvent.ADD_ENCODE_EVENT, async (encodeId: apid.EncodeId) => {
            try {
                await callback(encodeId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * エンコードキャンセルイベント登録
     * @param callback: (encodeId: apid.EncodeId) => void
     */
    public setCancelEncode(callback: (encodeId: apid.EncodeId) => void): void {
        this.emitter.on(EncodeEvent.CANCEL_ENCODE_EVENT, async (encodeId: apid.EncodeId) => {
            try {
                await callback(encodeId);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * エンコード完了イベント登録
     * @param callback: (info: FinishEncodeInfo) => void
     */
    public setFinishEncode(callback: (info: FinishEncodeInfo) => void): void {
        this.emitter.on(EncodeEvent.FINISH_ENCODE_EVENT, async (info: FinishEncodeInfo) => {
            try {
                await callback(info);
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * エンコード失敗イベント登録
     * @param callback: callback: () => void
     */
    public setErrorEncode(callback: () => void): void {
        this.emitter.on(EncodeEvent.ERROR_ENCODE_EVENT, async () => {
            try {
                await callback();
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * エンコード更新イベント登録
     * @param callback: callback: () => void
     */
    public setUpdateEncode(callback: () => void): void {
        this.emitter.on(EncodeEvent.UPDATE_ENCODE_EVENT, async () => {
            try {
                await callback();
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }

    /**
     * エンコード進捗更新イベント登録
     * @param callback: callback: () => void
     */
    public setUpdateEncodeProgress(callback: () => void): void {
        this.emitter.on(EncodeEvent.UPDATE_ENCODE_PROGRESS_EVENT, async () => {
            try {
                await callback();
            } catch (err) {
                this.log.system.error(err);
            }
        });
    }
}

namespace EncodeEvent {
    export const ADD_ENCODE_EVENT = 'addEncodeEvent';
    export const CANCEL_ENCODE_EVENT = 'cancelEncodeEvent';
    export const FINISH_ENCODE_EVENT = 'finishEncodeEvent';
    export const ERROR_ENCODE_EVENT = 'errorEncodeEvent';
    export const UPDATE_ENCODE_EVENT = 'updateEncodeEvent';
    export const UPDATE_ENCODE_PROGRESS_EVENT = 'updateENcodeProgressEvent';
}

export default EncodeEvent;
