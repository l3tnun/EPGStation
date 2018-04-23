import { ChildProcess } from 'child_process';
import * as apid from '../../../../node_modules/mirakurun/api';
import * as events from '../../IoEvents';
import Model from '../Model';
import { MirakurunManageModelInterface } from '../Operator/EPGUpdate/MirakurunManageModel';
import { RecordedManageModelInterface } from '../Operator/Recorded/RecordedManageModel';
import { RecordingManageModelInterface } from '../Operator/Recording/RecordingManageModel';
import { ReservationManageModelInterface } from '../Operator/Reservation/ReservationManageModel';
import { AddReserveInterface } from '../Operator/ReserveProgramInterface';
import { RuleManageModelInterface } from '../Operator/Rule/RuleManageModel';
import { RuleInterface } from '../Operator/RuleInterface';
import { EncodeProgram } from '../Service/Encode/EncodeManageModel';
import { IPCClientMessage, IPCMessageDefinition, IPCServerMessage } from './IPCMessageInterface';

interface IPCServerInterface extends Model {
    setModels(
        mirakurunManage: MirakurunManageModelInterface,
        reservationManage: ReservationManageModelInterface,
        recordingManage: RecordingManageModelInterface,
        recordedManage: RecordedManageModelInterface,
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
    private recordedManage: RecordedManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private ruleManage: RuleManageModelInterface;
    private child: ChildProcess;
    private functions: {
        [key: string]: ((id: number, args: any) => void);
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
        recordedManage: RecordedManageModelInterface,
        ruleManage: RuleManageModelInterface,
    ): void {
        this.mirakurunManage = mirakurunManage;
        this.reservationManage = reservationManage;
        this.recordingManage = recordingManage;
        this.recordedManage = recordedManage;
        this.ruleManage = ruleManage;
    }

    /**
     * メッセージ登録処理
     */
    public register(child: ChildProcess): void {
        this.child = child;

        this.child.on('message', async(msg: IPCClientMessage) => {
            if (typeof this.functions[msg.msg] !== 'undefined') {
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
            const value = this.reservationManage.getReservesAllId();
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserve] = (id: number, args: any) => {
            const programId: number = args.programId;
            const value = this.reservationManage.getReserve(programId);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserves] = (id: number, args: any) => {
            const limit: number = args.limit;
            const offset: number = args.offset;
            const value = this.reservationManage.getReserves(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveConflicts] = (id: number, args: any) => {
            const limit: number = args.limit;
            const offset: number = args.offset;
            const value = this.reservationManage.getConflicts(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.getReserveSkips] = (id: number, args: any) => {
            const limit: number = args.limit;
            const offset: number = args.offset;
            const value = this.reservationManage.getSkips(limit, offset);
            this.send({ id: id, value: value });
        };

        this.functions[IPCMessageDefinition.addReserve] = async(id: number, args: any) => {
            const option: AddReserveInterface = args.option;

            try {
                await this.reservationManage.addReserve(option);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.editReserve] = async(id: number, args: any) => {
            const option: AddReserveInterface = args.option;

            try {
                await this.reservationManage.editReserve(option);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.cancelReserve] = async(id: number, args: any) => {
            const programId: apid.ProgramId = args.programId;

            try {
                await this.reservationManage.cancel(programId);
                await this.recordingManage.stop(programId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.removeReserveSkip] = async(id: number, args: any) => {
            const programId: apid.ProgramId = args.programId;

            await this.reservationManage.removeSkip(programId);
            this.send({ id: id });
        };

        // Recorded
        this.functions[IPCMessageDefinition.recordedDelete] = async(id: number, args: any) => {
            const recordedId: number = args.recordedId;

            try {
                await this.recordedManage.delete(recordedId);
                this.send({ id: id });
            } catch (err) {
                 this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.recordedDeletes] = async(id: number, args: any) => {
            const recordedIds: number[] = args.recordedIds;

            try {
                const value = await this.recordedManage.deletes(recordedIds);
                this.send({ id: id,  value: value });
            } catch (err) {
                 this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.recordedFileDelete] = async(id: number, args: any) => {
            const recordedId: number = args.recordedId;

            try {
                await this.recordedManage.deleteFile(recordedId);
                this.send({ id: id });
            } catch (err) {
                 this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.recordedEncodeFileDelete] = async(id: number, args: any) => {
            const encodedId: number = args.encodedId;

            try {
                await this.recordedManage.deleteEncodedFile(encodedId);
                this.send({ id: id });
            } catch (err) {
                 this.send({ id: id, error: err.message });
            }
        };


        // Rule
        this.functions[IPCMessageDefinition.ruleDisable] = async(id: number, args: any) => {
            const ruleId: number = args.ruleId;

            try {
                await this.ruleManage.disable(ruleId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleEnable] = async(id: number, args: any) => {
            const ruleId: number = args.ruleId;

            try {
                await this.ruleManage.enable(ruleId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleDelete] = async(id: number, args: any) => {
            const ruleId: number = args.ruleId;

            try {
                await this.ruleManage.delete(ruleId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleAdd] = async(id: number, args: any) => {
            const rule: RuleInterface = args.rule;

            try {
                const ruleId = await this.ruleManage.add(rule);
                this.send({ id: id,  value: ruleId });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        this.functions[IPCMessageDefinition.ruleUpdate] = async(id: number, args: any) => {
            const ruleId: number = args.ruleId;
            const rule: RuleInterface = args.rule;

            try {
                await this.ruleManage.update(ruleId, rule);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        // add encoded file
        this.functions[IPCMessageDefinition.addEncodeFile] = async(id: number, args: any) => {
            const recordedId: number = args.recordedId;
            const name: string = args.name;
            const filePath: string = args.filePath;

            try {
                const encodedId = await this.recordedManage.addEncodeFile(recordedId, name, filePath);
                this.send({ id: id, value: encodedId });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        // update TS file size
        this.functions[IPCMessageDefinition.updateTsFileSize] = async(id: number, args: any) => {
            const recordedId: number = args.recordedId;

            try {
                await this.recordedManage.updateTsFileSize(recordedId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        // update encoded file size
        this.functions[IPCMessageDefinition.updateEncodedFileSize] = async(id: number, args: any) => {
            const encodedId: number = args.encodedId;

            try {
                await this.recordedManage.updateEncodedFileSize(encodedId);
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };

        // update Reserves
        this.functions[IPCMessageDefinition.updateReserves] = async(id: number) => {
            try {
                this.mirakurunManage.update();
                this.send({ id: id });
            } catch (err) {
                this.send({ id: id, error: err.message });
            }
        };
    }
}

export { IPCServerInterface, IPCServer };

