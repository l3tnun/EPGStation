import { ChildProcess } from 'child_process';
import Model from '../Model';
import { IPCClientMessage, IPCServerMessage, IPCMessageDefinition } from './IPCMessageInterface';
import { MirakurunManageModelInterface } from '../Operator/EPGUpdate/MirakurunManageModel';
import { ReservationManageModelInterface } from '../Operator/Reservation/ReservationManageModel';
import { RecordingManageModelInterface } from '../Operator/Recording/RecordingManageModel';
import { RuleManageModelInterface } from '../Operator/Rule/RuleManageModel';
import { RuleInterface, EncodeInterface } from '../Operator/RuleInterface';
import * as apid from '../../../../node_modules/mirakurun/api';
import * as events from '../../IoEvents';
import { EncodeProgram } from '../Service/Encode/EncodeManageModel';

interface IPCServerInterface extends Model {
    setModels(
        mirakurunManage: MirakurunManageModelInterface,
        reservationManage: ReservationManageModelInterface,
        recordingManage: RecordingManageModelInterface,
        ruleManage: RuleManageModelInterface,
    ): void;
    register(child: ChildProcess): void;
    notifIo(): void;
    setEncode(program: EncodeProgram): void;
}

/**
* IPC 通信サーバ
*/
class IPCServer extends Model implements IPCServerInterface {
    private mirakurunManage: MirakurunManageModelInterface;
    private reservationManage: ReservationManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private ruleManage: RuleManageModelInterface;
    private child: ChildProcess;
    private functions: {
        [key: string]: ((id: number, args: any) => void)
    } = {};

    constructor() {
        super();
        this.init();
    }

    /**
    * Model をセット
    */
    public setModels(
        mirakurunManage: MirakurunManageModelInterface,
        reservationManage: ReservationManageModelInterface,
        recordingManage: RecordingManageModelInterface,
        ruleManage: RuleManageModelInterface,
    ): void {
        this.mirakurunManage = mirakurunManage;
        this.reservationManage = reservationManage;
        this.recordingManage = recordingManage;
        this.ruleManage = ruleManage;
    }

    /**
    * メッセージ登録処理
    */
    public register(child: ChildProcess): void {
        this.child = child;

        this.child.on('message', async (msg: IPCClientMessage) => {
            if(typeof this.functions[msg.msg] !== 'undefined') {
                this.functions[msg.msg](msg.id, msg.value);
            }
        });
    }

    /**
    * クライアントに socket.io message を依頼する
    */
    public notifIo(): void {
        this.child.send({ msg: events.updateStatus });
        this.log.access.debug('noifIo');
    }

    /**
    * クライアントへエンコードを依頼する
    */
    public setEncode(program: EncodeProgram): void {
        this.child.send({ msg: IPCMessageDefinition.setEncodeToClient, program: program });
    }

    /**
    * クライアントにメッセージを送信
    */
    private send(msg: IPCServerMessage): void {
        this.child.send(msg);
    }

    /**
    * init
    */
    private init(): void {
        // Reserves
        this.functions[IPCMessageDefinition.getReserveAllId] = (id: number) => {
            let value = this.reservationManage.getReservesAllId();
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserves] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.reservationManage.getReserves(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveConflicts] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.reservationManage.getConflicts(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveSkips] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.reservationManage.getSkips(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.addReserve] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;
            let encode: EncodeInterface = args.encode;

            try {
                await this.reservationManage.addReserve(programId, encode);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.cancelReserve] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;

            try {
                await this.reservationManage.cancel(programId);
                await this.recordingManage.stop(programId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.removeReserveSkip] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;

            await this.reservationManage.removeSkip(programId);
            this.send({ id: id });
        };

        // Recorded
        this.functions[IPCMessageDefinition.recordedDeleteAll] = async (id: number, args: any) => {
            let recordedId: number = args.recordedId;

            try {
                await this.recordingManage.deleteAll(recordedId);
                this.send({ id: id });
            } catch(err) {
                 this.send({ id: id, error: err.message });
            }
        };

        //Rule
        this.functions[IPCMessageDefinition.ruleDisable] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.ruleManage.disable(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleEnable] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.ruleManage.enable(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleDelete] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.ruleManage.delete(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleAdd] = async (id: number, args: any) => {
            let rule: RuleInterface = args.rule;

            try {
                let ruleId = await this.ruleManage.add(rule);
                this.send({ id: id,  value: ruleId });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleUpdate] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;
            let rule: RuleInterface = args.rule;

            try {
                await this.ruleManage.update(ruleId, rule);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        // add encoded file
        this.functions[IPCMessageDefinition.addEncodeFile] = async (id: number, args: any) => {
            let recordedId: number = args.recordedId;
            let name: string = args.name;
            let filePath: string = args.filePath;
            let delTs: boolean = args.delTs;

            try {
                let encodedId = await this.recordingManage.addEncodeFile(recordedId, name, filePath, delTs);
                this.send({ id: id, value: encodedId });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        }

        // update Reserves
        this.functions[IPCMessageDefinition.updateReserves] = async (id: number) => {
            try {
                this.mirakurunManage.update();
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        }
    }
}

export { IPCServerInterface, IPCServer };

