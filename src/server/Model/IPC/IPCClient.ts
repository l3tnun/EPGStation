import * as events from 'events';
import Model from '../Model';
import { IPCClientMessage, IPCServerMessage, IPCServerSocketIoMessage, IPCServerEncodeMessage, IPCMessageDefinition } from './IPCMessageInterface';
import { ReserveAllId, ReserveLimit } from '../../Operator/ReservationManager';
import { EncodeInterface } from '../../Operator/RuleInterface';
import { RuleInterface } from '../../Operator/RuleInterface';
import * as apid from '../../../../node_modules/mirakurun/api';
import SocketIoServer from '../../Service/SocketIoServer';
import { EncodeModelInterface } from '../Encode/EncodeModel';

interface IPCClientInterface extends Model {
    getReserveAllId(): Promise<ReserveAllId>;
    getReserves(limit: number, offset: number): Promise<ReserveLimit>;
    getReserveConflicts(limit: number, offset: number): Promise<ReserveLimit>;
    getReserveSkips(limit: number, offset: number): Promise<ReserveLimit>;
    addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void>;
    cancelReserve(programId: apid.ProgramId): Promise<void>;
    removeReserveSkip(programId: apid.ProgramId): Promise<void>;
    recordedDelete(recordedId: number): Promise<void>;
    ruleDisable(ruleId: number): Promise<void>;
    ruleEnable(ruleId: number): Promise<void>;
    ruleDelete(ruleId: number): Promise<void>;
    ruleAdd(rule: RuleInterface): Promise<number>;
    ruleUpdate(ruleId: number, rule: RuleInterface): Promise<void>;
    addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number>;
    updateReserves(): Promise<void>;
}

/**
* IPC 通信クライアント
* @throws IPCClientCreateInstanceError init が呼ばれていないとき
* @throws IPCClientIsNotChildProcess fork で起動していないとき
*/
class IPCClient extends Model implements IPCClientInterface {
    private static isInited: boolean = false;
    private static instance: IPCClientInterface;
    private encodeModel: EncodeModelInterface;
    private listener: events.EventEmitter = new events.EventEmitter();

    public static getInstance(): IPCClientInterface {
        if(!this.isInited) {
            throw new Error('IPCClientCreateInstanceError');
        }

        return this.instance;
    }

    public static init(encodeModel: EncodeModelInterface) {
        if(this.isInited) { return; }
        this.instance = new IPCClient(encodeModel);
        this.isInited = true;
    }

    private constructor(encodeModel: EncodeModelInterface) {
        super();

        this.encodeModel = encodeModel;
        if(typeof process.send === 'undefined') {
            this.log.system.error('IPCClient is not child process');
            throw new Error('IPCClientIsNotChildProcess');
        }

        process.on('message', (msg: IPCServerMessage | IPCServerSocketIoMessage | IPCServerEncodeMessage) => {
            if(typeof (<IPCServerMessage>msg).id === 'undefined') {
                if((<IPCServerEncodeMessage>msg).msg === IPCMessageDefinition.setEncodeToClient) {
                    // server からのエンコード依頼
                    this.encodeModel.push((<IPCServerEncodeMessage>msg).program);
                } else {
                    // server からの socket.io message 送信依頼
                    SocketIoServer.getInstance().notifyClient();
                }
            } else {
                // client -> server の返答
                this.listener.emit(String((<IPCServerMessage>msg).id), msg);
            }
        });
    }

    /**
    * 予約に含まれるの program id だけを取得する
    * @return Promise<ReserveAllId>
    */
    public async getReserveAllId(): Promise<ReserveAllId> {
        let id = this.send(IPCMessageDefinition.getReserveAllId);
        let result = await this.receive(id);

        return <ReserveAllId>(result.value);
    }

    /**
    * 予約一覧を取得する
    * @return Promise<ReserveLimit>
    */
    public async getReserves(limit: number, offset: number): Promise<ReserveLimit> {
        let id = this.send(IPCMessageDefinition.getReserves, { limit: limit, offset: offset });
        let result = await this.receive(id);

        return <ReserveLimit>(result.value)
    }

    /**
    * 重複を取得する
    * @return Promise<ReserveLimit>
    */
    public async getReserveConflicts(limit: number, offset: number): Promise<ReserveLimit> {
        let id = this.send(IPCMessageDefinition.getReserveConflicts, { limit: limit, offset: offset });
        let result = await this.receive(id);

        return <ReserveLimit>(result.value)
    }

    /**
    * スキップを取得する
    * @return Promise<ReserveLimit>
    */
    public async getReserveSkips(limit: number, offset: number): Promise<ReserveLimit> {
        let id = this.send(IPCMessageDefinition.getReserveSkips, { limit: limit, offset: offset });
        let result = await this.receive(id);

        return <ReserveLimit>(result.value)
    }

    /**
    * 予約追加
    * @param programId: program id
    * @param encode: EncodeInterface
    * @return Promise<void>
    */
    public async addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void> {
        let args = { programId: programId };
        if(typeof encode !== 'undefined') { args['encode'] = encode; }
        let id = this.send(IPCMessageDefinition.addReserve, args);
        await this.receive(id);
    }

    /**
    * 予約キャンセル
    * @param programId: program id
    * @return Promise<void>
    */
    public async cancelReserve(programId: apid.ProgramId): Promise<void> {
        let id = this.send(IPCMessageDefinition.cancelReserve, { programId: programId });
        await this.receive(id);
    }

    /**
    * 予約対象から除外され状態を解除する
    * @param programId: program id
    * @return Promise<void>
    */
    public async removeReserveSkip(programId: apid.ProgramId): Promise<void> {
        let id = this.send(IPCMessageDefinition.removeReserveSkip, { programId: programId });
        await this.receive(id);
    }

    /**
    * 録画を削除する
    * @param recordedId: recorded id
    * @return Promise<void>
    */
    public async recordedDelete(recordedId: number): Promise<void> {
        let id = this.send(IPCMessageDefinition.recordedDelete, { recordedId: recordedId });
        await this.receive(id);
    }

    /**
    * rule を無効化する
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async ruleDisable(ruleId: number): Promise<void> {
        let id = this.send(IPCMessageDefinition.ruleDisable, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
    * rule を有効化する
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async ruleEnable(ruleId: number): Promise<void> {
        let id = this.send(IPCMessageDefinition.ruleEnable, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
    * rule を削除する
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async ruleDelete(ruleId: number): Promise<void> {
        let id = this.send(IPCMessageDefinition.ruleDelete, { ruleId: ruleId });
        await this.receive(id);
    }

    /**
    * rule を追加する
    * @param rule: RuleInterface
    * @return Promise<number>: rule id
    */
    public async ruleAdd(rule: RuleInterface): Promise<number> {
        let id = this.send(IPCMessageDefinition.ruleAdd, { rule: rule });
        let result = await this.receive(id);

        return <number>(result.value);
    }

    /**
    * rule を更新する
    * @param rule: RuleInterface
    * @return Promise<void>
    */
    public async ruleUpdate(ruleId: number, rule: RuleInterface): Promise<void> {
        let id = this.send(IPCMessageDefinition.ruleUpdate, { ruleId: ruleId, rule: rule });
        await this.receive(id);
    }

    /**
    * エンコード済みファイルを追加する
    * @return Promise<number> encodedId
    */
    public async addEncodeFile(recordedId: number, name: string, filePath: string, delTs: boolean): Promise<number> {
        let id = this.send(IPCMessageDefinition.addEncodeFile, {
            recordedId: recordedId,
            name: name,
            filePath: filePath,
            delTs: delTs,
        });
        let result = await this.receive(id);

        return <number>(result.value);
    }

    /**
    * 予約情報の更新
    * @return Promise<void>
    */
    public async updateReserves(): Promise<void> {
        let id = this.send(IPCMessageDefinition.updateReserves);
        await this.receive(id);
    }

    /**
    * message 送信
    * @param msg: string
    * @param value: any
    * @return id
    */
    private send(msg: string, value: any | null = null): number {
        let data: IPCClientMessage = {
            id: new Date().getTime(),
            msg: msg,
        }

        if(value !== null) {
            data.value = value;
        }

        setTimeout(() => { process.send!(data); }, 0);

        return data.id;
    }

    /**
    * 受信
    * @param id: number
    * @return Promise<IPCServerMessage>
    */
    private receive(id: number): Promise<IPCServerMessage> {
        return new Promise<IPCServerMessage>((resolve: (msg: IPCServerMessage) => void, reject: (err: Error) => void) => {
            this.listener.once(String(id), (msg: IPCServerMessage) => {
                if(typeof msg.error !== 'undefined') {
                    reject(new Error(msg.error));
                } else {
                    resolve(msg);
                }
            });

            // timeout
            setTimeout(() => {
                reject(new Error('IPCTimeout'));
            }, 5000);
        });
    }
}

export { IPCClientInterface, IPCClient }
