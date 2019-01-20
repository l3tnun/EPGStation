import * as events from 'events';
import * as apid from '../../../../node_modules/mirakurun/api';
import Model from '../Model';
import { DeleteOption, ExternalFileInfo, NewRecorded } from '../Operator/Recorded/RecordedManageModel';
import { ReserveAllId, ReserveLimit } from '../Operator/Reservation/ReservationManageModel';
import { AddReserveInterface, ReserveProgram } from '../Operator/ReserveProgramInterface';
import { RuleInterface } from '../Operator/RuleInterface';
import { EncodeManageModelInterface } from '../Service/Encode/EncodeManageModel';
import { SocketIoManageModelInterface } from '../Service/SocketIoManageModel';
import { IPCClientMessage, IPCMessageDefinition, IPCServerEncodeMessage, IPCServerEncodingProgramgStatusUpdateMessage, IPCServerMessage, IPCServerSocketIoMessage } from './IPCMessageInterface';

interface IPCClientInterface extends Model {
    getTuners(): Promise<apid.TunerDevice[]>;
    getReserveAllId(): Promise<ReserveAllId>;
    getReserve(programId: number): Promise<ReserveProgram | null>;
    getReserves(limit: number, offset: number): Promise<ReserveLimit>;
    getReserveConflicts(limit: number, offset: number): Promise<ReserveLimit>;
    getReserveSkips(limit: number, offset: number): Promise<ReserveLimit>;
    getReserveOverlaps(limit: number, offset: number): Promise<ReserveLimit>;
    getReservePosition(programId: number): Promise<number | null>;
    addReserve(option: AddReserveInterface): Promise<number>;
    editReserve(option: AddReserveInterface): Promise<void>;
    cancelReserve(programId: apid.ProgramId): Promise<void>;
    removeReserveSkip(programId: apid.ProgramId): Promise<void>;
    disableReserveOverlap(programId: apid.ProgramId): Promise<void>;
    recordedDelete(recordedId: number): Promise<void>;
    recordedDeletes(recordedId: number[], option: DeleteOption): Promise<number[]>;
    recordedDeleteFile(recordedId: number): Promise<void>;
    recordedDeleteEncodeFile(encodedId: number): Promise<void>;
    recordedCleanup(): Promise<void>;
    recordedRegenerateThumbnail(): Promise<void>;
    ruleDisable(ruleId: number): Promise<void>;
    ruleEnable(ruleId: number): Promise<void>;
    ruleDelete(ruleId: number): Promise<void>;
    ruleDeletes(ruleIds: number[]): Promise<number[]>;
    ruleAdd(rule: RuleInterface): Promise<number>;
    ruleUpdate(ruleId: number, rule: RuleInterface): Promise<void>;
    addEncodeFile(recordedId: number, name: string, filePath: string): Promise<number>;
    addRecordedExternalFile(info: ExternalFileInfo): Promise<void>;
    createNewRecorded(info: NewRecorded): Promise<number>;
    updateTsFileSize(recordedId: number): Promise<void>;
    updateEncodedFileSize(encodedId: number): Promise<void>;
    updateReserves(): Promise<void>;
}

/**
 * IPC 通信クライアント
 * @throws IPCClientCreateInstanceError init が呼ばれていないとき
 * @throws IPCClientIsNotChildProcess fork で起動していないとき
 */
class IPCClient extends Model implements IPCClientInterface {
    private encodeManage: EncodeManageModelInterface;
    private socketIo: SocketIoManageModelInterface;
    private listener: events.EventEmitter = new events.EventEmitter();

    constructor() {
        super();

        if (typeof process.send === 'undefined') {
            this.log.system.error('IPCClient is not child process');
            throw new Error('IPCClientIsNotChildProcess');
        }

        process.on('message', async(msg: IPCServerMessage | IPCServerSocketIoMessage | IPCServerEncodeMessage) => {
            if (typeof (<IPCServerMessage> msg).id === 'undefined') {
                if ((<IPCServerEncodeMessage> msg).msg === IPCMessageDefinition.setEncodeToClient) {
                    // server からのエンコード依頼
                    this.encodeManage.push((<IPCServerEncodeMessage> msg).program);
                } else if ((<IPCServerEncodingProgramgStatusUpdateMessage> msg).msg === IPCMessageDefinition.updateEncodingProgramgStatusToClient) {
                    // server から encoding 番組の状態更新依頼
                    await this.encodeManage.updateProgram((<IPCServerEncodingProgramgStatusUpdateMessage> msg).recordedId);
                    this.socketIo.notifyClient();
                } else {
                    // server からの socket.io message 送信依頼
                    this.socketIo.notifyClient();
                }
            } else {
                // client -> server の返答
                this.listener.emit(String((<IPCServerMessage> msg).id), msg);
            }
        });
    }

    public setModels(
        encodeManage: EncodeManageModelInterface,
        socketIo: SocketIoManageModelInterface,
    ): void {
        this.encodeManage = encodeManage;
        this.socketIo = socketIo;
    }

    /**
     * tuner 一覧を取得
     * @return Promise<apid.TunerDevice[]>
     */
    public async getTuners(): Promise<apid.TunerDevice[]> {
        const id = this.send(IPCMessageDefinition.getTuners);
        const result = await this.receive(id);

        return <apid.TunerDevice[]> result.value;
    }

    /**
     * 予約に含まれるの program id だけを取得する
     * @return Promise<ReserveAllId>
     */
    public async getReserveAllId(): Promise<ReserveAllId> {
        const id = this.send(IPCMessageDefinition.getReserveAllId);
        const result = await this.receive(id);

        return <ReserveAllId> result.value;
    }

    /**
     * 予約を取得する
     * @param programId: program id
     * @return  Promise<ReserveProgram | null>
     */
    public async getReserve(programId: number): Promise<ReserveProgram | null> {
        const id = this.send(IPCMessageDefinition.getReserve, { programId: programId });
        const result = await this.receive(id);

        return <ReserveProgram | null> result.value;
    }

    /**
     * 予約一覧を取得する
     * @return Promise<ReserveLimit>
     */
    public async getReserves(limit: number, offset: number): Promise<ReserveLimit> {
        const id = this.send(IPCMessageDefinition.getReserves, { limit: limit, offset: offset });
        const result = await this.receive(id);

        return <ReserveLimit> result.value;
    }

    /**
     * 重複を取得する
     * @return Promise<ReserveLimit>
     */
    public async getReserveConflicts(limit: number, offset: number): Promise<ReserveLimit> {
        const id = this.send(IPCMessageDefinition.getReserveConflicts, { limit: limit, offset: offset });
        const result = await this.receive(id);

        return <ReserveLimit> result.value;
    }

    /**
     * スキップを取得する
     * @return Promise<ReserveLimit>
     */
    public async getReserveSkips(limit: number, offset: number): Promise<ReserveLimit> {
        const id = this.send(IPCMessageDefinition.getReserveSkips, { limit: limit, offset: offset });
        const result = await this.receive(id);

        return <ReserveLimit> result.value;
    }

    /**
     * overlap を取得する
     * @return Promise<ReserveLimit>
     */
    public async getReserveOverlaps(limit: number, offset: number): Promise<ReserveLimit> {
        const id = this.send(IPCMessageDefinition.getReserveOverlaps, { limit: limit, offset: offset });
        const result = await this.receive(id);

        return <ReserveLimit> result.value;
    }

    /**
     * 指定した programId の予約位置を取得する
     * @return Promise<number | null>
     */
    public async getReservePosition(programId: number): Promise<number | null> {
        const id = this.send(IPCMessageDefinition.getReservePosition, { programId: programId });
        const result = await this.receive(id);

        return <number | null> result.value;
    }

    /**
     * 予約追加
     * @param option: AddReserveInterface
     * @return Promise<number> ProgramId
     */
    public async addReserve(option: AddReserveInterface): Promise<number> {
        const id = this.send(IPCMessageDefinition.addReserve, { option: option });
        const result = await this.receive(id);

        return <number> result.value;
    }

    /**
     * 手動予約編集
     * @param option: AddReserveInterface
     * @return Promise<void>
     */
    public async editReserve(option: AddReserveInterface): Promise<void> {
        const id = this.send(IPCMessageDefinition.editReserve, { option: option });
        await this.receive(id);
    }

    /**
     * 予約キャンセル
     * @param programId: program id
     * @return Promise<void>
     */
    public async cancelReserve(programId: apid.ProgramId): Promise<void> {
        const id = this.send(IPCMessageDefinition.cancelReserve, { programId: programId });
        await this.receive(id);
    }

    /**
     * 予約対象から除外され状態を解除する
     * @param programId: program id
     * @return Promise<void>
     */
    public async removeReserveSkip(programId: apid.ProgramId): Promise<void> {
        const id = this.send(IPCMessageDefinition.removeReserveSkip, { programId: programId });
        await this.receive(id);
    }

    /**
     * overlap を解除する
     * @param programId: program id
     * @return Promise<void>
     */
    public async disableReserveOverlap(programId: apid.ProgramId): Promise<void> {
        const id = this.send(IPCMessageDefinition.disableReserveOverlap, { programId: programId });
        await this.receive(id);
    }

    /**
     * 録画を削除する
     * @param recordedId: recorded id
     * @return Promise<void>
     */
    public async recordedDelete(recordedId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.recordedDelete, { recordedId: recordedId });
        await this.receive(id);
    }

    /**
     * 録画を複数削除する
     * @param recordedIds: recorded ids
     * @param option: DeleteOption
     * @return Promise<number[]> 削除できなかった要素を返す
     */
    public async recordedDeletes(recordedIds: number[], option: DeleteOption): Promise<number[]> {
        const id = this.send(IPCMessageDefinition.recordedDeletes, {
            recordedIds: recordedIds,
            option: option,
        });
        const result = await this.receive(id, null);

        return <number[]> result.value;
    }

    /**
     * 録画の ts ファイルを削除する
     * @param recordedId: recorded id
     * @return Promise<void>
     */
    public async recordedDeleteFile(recordedId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.recordedFileDelete, { recordedId: recordedId });
        await this.receive(id);
    }

    /**
     * 録画の encoded ファイルを削除する
     * @param encodedId: encoded id
     * @return Promise<void>
     */
    public async recordedDeleteEncodeFile(encodedId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.recordedEncodeFileDelete, { encodedId: encodedId });
        await this.receive(id);
    }

    /**
     * 録画 cleanup
     * @return Promise<void>
     */
    public async recordedCleanup(): Promise<void> {
        const id = this.send(IPCMessageDefinition.recordedClenaup);
        await this.receive(id, null);
    }

    /**
     * 録画 サムネイル再生成
     * @return Promise<void>
     */
    public async recordedRegenerateThumbnail(): Promise<void> {
        const id = this.send(IPCMessageDefinition.recordedRegenerateThumbnail);
        await this.receive(id, null);
    }

    /**
     * rule を無効化する
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public async ruleDisable(ruleId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.ruleDisable, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
     * rule を有効化する
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public async ruleEnable(ruleId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.ruleEnable, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
     * rule を削除する
     * @param ruleId: rule id
     * @return Promise<void>
     */
    public async ruleDelete(ruleId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.ruleDelete, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
     * 指定した複数の rule を削除する
     * @param ruleIds: rule ids
     * @return Promise<number[]> 削除できなかった要素を返す
     */
    public async ruleDeletes(ruleIds: number[]): Promise<number[]> {
        const id = this.send(IPCMessageDefinition.ruleDeletes, {
            ruleIds: ruleIds,
        });
        const result = await this.receive(id, null);

        return <number[]> result.value;
    }

    /**
     * rule を追加する
     * @param rule: RuleInterface
     * @return Promise<number>: rule id
     */
    public async ruleAdd(rule: RuleInterface): Promise<number> {
        const id = this.send(IPCMessageDefinition.ruleAdd, { rule: rule });
        const result = await this.receive(id);

        return <number> result.value;
    }

    /**
     * rule を更新する
     * @param rule: RuleInterface
     * @return Promise<void>
     */
    public async ruleUpdate(ruleId: number, rule: RuleInterface): Promise<void> {
        const id = this.send(IPCMessageDefinition.ruleUpdate, { ruleId: ruleId, rule: rule });
        await this.receive(id);
    }

    /**
     * エンコード済みファイルを追加する
     * @return Promise<number> encodedId
     */
    public async addEncodeFile(recordedId: number, name: string, filePath: string): Promise<number> {
        const id = this.send(IPCMessageDefinition.addEncodeFile, {
            recordedId: recordedId,
            name: name,
            filePath: filePath,
        });
        const result = await this.receive(id);

        return <number> result.value;
    }

    /**
     * アップロードした動画ファイルを追加する
     * @param info: ExternalFileInfo
     * @return Promise<void>
     */
    public async addRecordedExternalFile(info: ExternalFileInfo): Promise<void> {
        const id = this.send(IPCMessageDefinition.addRecordedExternalFile, {
            info: info,
        });
        await this.receive(id, 30 * 60 * 1000);
    }

    /**
     * recorded を新規作成
     * @param info: NewRecorded
     * @return Promise<number> recordedId
     */
    public async createNewRecorded(info: NewRecorded): Promise<number> {
        const id = this.send(IPCMessageDefinition.createNewRecorded, {
            info: info,
        });
        const result = await this.receive(id);

        return <number> result.value;
    }

    /**
     * ts ファイルのサイズを更新
     * @param recordedId: recorded id
     * @return Promise<void>
     */
    public async updateTsFileSize(recordedId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.updateTsFileSize, {
            recordedId: recordedId,
        });
        await this.receive(id);
    }

    /**
     * encoded ファイルのファイルサイズを更新
     * @param encodedId: encoded id
     * @return Promise<void>
     */
    public async updateEncodedFileSize(encodedId: number): Promise<void> {
        const id = this.send(IPCMessageDefinition.updateEncodedFileSize, {
            encodedId: encodedId,
        });
        await this.receive(id);
    }

    /**
     * 予約情報の更新
     * @return Promise<void>
     */
    public async updateReserves(): Promise<void> {
        const id = this.send(IPCMessageDefinition.updateReserves);
        await this.receive(id);
    }

    /**
     * message 送信
     * @param msg: string
     * @param value: any
     * @return id
     */
    private send(msg: string, value: any | null = null): number {
        const data: IPCClientMessage = {
            id: new Date().getTime(),
            msg: msg,
        };

        if (value !== null) {
            data.value = value;
        }

        setTimeout(() => { process.send!(data); }, 0);

        return data.id;
    }

    /**
     * 受信
     * @param id: number
     * @param timeout: number | null
     * @return Promise<IPCServerMessage>
     */
    private receive(id: number, timeout: number | null = 5000): Promise<IPCServerMessage> {
        return new Promise<IPCServerMessage>((resolve: (msg: IPCServerMessage) => void, reject: (err: Error) => void) => {
            this.listener.once(String(id), (msg: IPCServerMessage) => {
                if (typeof msg.error !== 'undefined') {
                    reject(new Error(msg.error));
                } else {
                    resolve(msg);
                }
            });

            if (timeout !== null) {
                // timeout
                setTimeout(() => {
                    reject(new Error('IPCTimeout'));
                }, timeout);
            }
        });
    }
}

export { IPCClientInterface, IPCClient };

