import { ChildProcess } from 'child_process';
import Model from '../Model';
import { IPCClientMessage, IPCServerMessage, IPCMessageDefinition } from './IPCMessageInterface';
import { ReservationManagerInterface } from '../../Operator/ReservationManager';
import { EncodeInterface } from '../../Operator/RuleInterface';
import { RecordingManagerInterface } from '../../Operator/RecordingManager';
import { RuleManagerInterface } from '../../Operator/RuleManager';
import { RuleInterface } from '../../Operator/RuleInterface';
import * as apid from '../../../../node_modules/mirakurun/api';
import * as events from '../../IoEvents';
import { EncodeProgram } from '../../Service/EncodeManager';
import { MirakurunManagerInterface } from '../../Operator/MirakurunManager';
import Util from '../../Util/Util';

interface IPCServerInterface extends Model {
    setManagers(managers: Managers): void;
    register(child: ChildProcess): void;
    notifIo(): void;
    setEncode(program: EncodeProgram): void;
}

interface Managers {
    reservation: ReservationManagerInterface;
    recording: RecordingManagerInterface;
    rule: RuleManagerInterface;
    mirakurun: MirakurunManagerInterface;
}

/**
* IPC 通信サーバ
*/
class IPCServer extends Model implements IPCServerInterface {
    private static instance: IPCServerInterface;
    private child: ChildProcess;
    private managers: Managers;
    private functions: {
        [key: string]: ((id: number, args: any) => void)
    } = {};

    public static getInstance(): IPCServerInterface {
        if(!this.instance) {
            this.instance = new IPCServer();
        }

        return this.instance;
    }

    private constructor() {
        super();
        this.init();
    }

    /**
    * manager をセット
    */
    public setManagers(managers: Managers): void {
        this.managers = managers;
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
            let value = this.managers.reservation.getReservesAllId();
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserves] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.managers.reservation.getReserves(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveConflicts] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.managers.reservation.getConflicts(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveSkips] = (id: number, args: any) => {
            let limit: number = args.limit;
            let offset: number = args.offset;
            let value = this.managers.reservation.getSkips(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.addReserve] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;
            let encode: EncodeInterface = args.encode;

            try {
                await this.managers.reservation.addReserve(programId, encode);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.cancelReserve] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;

            try {
                await this.managers.reservation.cancel(programId);
                await this.managers.recording.stop(programId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.removeReserveSkip] = async (id: number, args: any) => {
            let programId: apid.ProgramId = args.programId;

            await this.managers.reservation.removeSkip(programId);
            this.send({ id: id });
        };

        // Recorded
        this.functions[IPCMessageDefinition.recordedDeleteAll] = async (id: number, args: any) => {
            let recordedId: number = args.recordedId;

            try {
                await this.managers.recording.deleteAll(recordedId);
                this.send({ id: id });
            } catch(err) {
                 this.send({ id: id, error: err.message });
            }
        };

        //Rule
        this.functions[IPCMessageDefinition.ruleDisable] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.managers.rule.disable(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleEnable] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.managers.rule.enable(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleDelete] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;

            try {
                await this.managers.rule.delete(ruleId);
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleAdd] = async (id: number, args: any) => {
            let rule: RuleInterface = args.rule;

            try {
                let ruleId = await this.managers.rule.add(rule);
                this.send({ id: id,  value: ruleId });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleUpdate] = async (id: number, args: any) => {
            let ruleId: number = args.ruleId;
            let rule: RuleInterface = args.rule;

            try {
                await this.managers.rule.update(ruleId, rule);
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
                let encodedId = await this.managers.recording.addEncodeFile(recordedId, name, filePath, delTs);
                this.send({ id: id, value: encodedId });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        }

        // update Reserves
        this.functions[IPCMessageDefinition.updateReserves] = async (id: number) => {
            try {
                if(Util.isContinuousEPGUpdater()) {
                    await this.managers.reservation.updateAll();
                } else {
                    this.managers.mirakurun.update();
                }
                this.send({ id: id });
            } catch(err) {
                this.send({ id: id, error: err.message });
            }
        }
    }
}

export { IPCServerInterface, IPCServer };

