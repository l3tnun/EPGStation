import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IDropLogApiModel from '../../api/dropLog/IDropLogApiModel';
import IDropLogDialogState from './IDropLogDialogState';

@injectable()
export default class DropLogDialogState implements IDropLogDialogState {
    private dropLogApiModel: IDropLogApiModel;
    private name: string = '';
    private dropLogStr: string | null = null;

    constructor(@inject('IDropLogApiModel') dropLogApiModel: IDropLogApiModel) {
        this.dropLogApiModel = dropLogApiModel;
    }

    /**
     * 番組名をセットする
     * @param name: string
     */
    public setName(name: string): void {
        this.name = name;
    }

    /**
     * 指定した id のドロップログを取得する
     * @param dropLogFileId: apid.DropLogFileId
     * @return Promise<void>
     */
    public async fetchData(dropLogFileId: apid.DropLogFileId): Promise<void> {
        this.dropLogStr = null;
        this.dropLogStr = await this.dropLogApiModel.get(dropLogFileId);
    }

    /**
     * セットされた番組名を返す
     * @return string
     */
    public getName(): string {
        return this.name;
    }

    /**
     * 取得したドロップログを返す
     * @return string | null
     */
    public getDropLog(): string | null {
        return this.dropLogStr;
    }
}
