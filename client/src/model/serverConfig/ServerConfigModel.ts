import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfigApiModel from '../api/config/IConfigApiModel';
import IServerConfigModel from './IServerConfigModel';

@injectable()
export default class ServerConfigModel implements IServerConfigModel {
    private configApiModel: IConfigApiModel;
    private config: apid.Config | null = null;

    constructor(@inject('IConfigApiModel') configApiModel: IConfigApiModel) {
        this.configApiModel = configApiModel;
    }

    /**
     * config 情報取得
     * @return Promise<void>
     */
    public async fetchConfig(): Promise<void> {
        this.config = await this.configApiModel.getConfig();
    }

    /**
     * 取得した config 情報を返す
     * @return apid.Config | null
     */
    public getConfig(): apid.Config | null {
        return this.config;
    }

    /**
     * エンコード設定が有効か
     * @return boolean true で有効
     */
    public isEnableEncode(): boolean {
        return this.config !== null && this.config.encode.length > 0;
    }
}
