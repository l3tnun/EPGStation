import Model from '../../Model';
import * as DBSchema from '../../DB/DBSchema';
import { EncodeInterface } from '../../Operator/RuleInterface';
import { RecordingManageModelInterface } from '../../Operator/Recording/RecordingManageModel';
import { ThumbnailManageModelInterface } from '../../Operator/Thumbnail/ThumbnailManageModel';
import { ExternalProcessModelInterface } from '../../Operator/ExternalProcessModel';
import { IPCServerInterface } from '../../IPC/IPCServer';

interface RecordingFinModelInterface extends Model {
    set(): void;
}

/**
* RecordingFinModel
* 録画終了後の処理
*/
class RecordingFinModel extends Model implements RecordingFinModelInterface {
    private recordingManage: RecordingManageModelInterface;
    private thumbnailManage: ThumbnailManageModelInterface;
    private externalProcess: ExternalProcessModelInterface;
    private ipc: IPCServerInterface;

    constructor(
        recordingManage: RecordingManageModelInterface,
        thumbnailManage: ThumbnailManageModelInterface,
        externalProcess: ExternalProcessModelInterface,
        ipc: IPCServerInterface,
    ) {
        super();

        this.recordingManage = recordingManage;
        this.thumbnailManage = thumbnailManage;
        this.externalProcess = externalProcess;
        this.ipc = ipc;
    }

    public set(): void {
        this.recordingManage.recEndListener((program, encode) => { this.callback(program, encode); });
    }

    /**
    * @param program: DBSchema.RecordedSchema | null
    * @param encodeOption: EncodeInterface | null
    * program が null の場合は録画中に recorded から削除された
    */
    private async callback(program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null): Promise<void> {
        if(program === null) { return; }

        //サムネイル生成
        this.thumbnailManage.push(program);

        const config = this.config.getConfig();

        // ts 前処理
        if(typeof config.tsModify !== 'undefined' && program.recPath !== null) {
            await this.ipc.setEncode({
                recordedId: program.id,
                source: program.recPath,
                delTs: false,
                recordedProgram: program,
            });
        }

        //エンコード
        if(encodeOption !== null) {
            //エンコードオプションを生成
            let settings: { mode: number, directory?: string }[] = [];
            let encCnt = 0;
            if(typeof encodeOption.mode1 !== 'undefined') {
                settings.push({ mode: encodeOption.mode1, directory: encodeOption.directory1 }); encCnt += 1;
            }
            if(typeof encodeOption.mode2 !== 'undefined') {
                settings.push({ mode: encodeOption.mode2, directory: encodeOption.directory2 }); encCnt += 1;
            }
            if(typeof encodeOption.mode3 !== 'undefined') {
                settings.push({ mode: encodeOption.mode3, directory: encodeOption.directory3 }); encCnt += 1;
            }

            //エンコードを依頼する
            for(let i = 0; i < settings.length; i++) {
                if(program.recPath === null) { continue; }
                await this.ipc.setEncode({
                    recordedId: program.id,
                    source: program.recPath,
                    mode: settings[i].mode,
                    directory: settings[i].directory,
                    delTs: i === encCnt - 1 ? encodeOption.delTs : false,
                    recordedProgram: program,
                });
            }
        }

        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        let cmd = config.recordedEndCommand;
        if(typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program);
        }
    }
}

export { RecordingFinModelInterface, RecordingFinModel };

