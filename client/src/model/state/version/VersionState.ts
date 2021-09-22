import { inject, injectable } from 'inversify';
import IVersionApiModel from '../../api/version/IVersionApiModel';
import IVersionState, { VersionInfo } from './IVersionState';

@injectable()
export default class VersionState implements IVersionState {
    private versionApiModel: IVersionApiModel;

    private info: VersionInfo | null = null;

    constructor(@inject('IVersionApiModel') versionApiModel: IVersionApiModel) {
        this.versionApiModel = versionApiModel;
    }

    /**
     * 取得したバージョン情報をクリア
     */
    public clearData(): void {
        this.info = null;
    }

    /**
     * バージョン情報の取得
     */
    public async fetchData(): Promise<void> {
        const version = await this.versionApiModel.getInfo();

        this.info = version;
    }

    /**
     * 取得したバージョン情報を返す
     * @return VersionInfo
     */
    public getInfo(): VersionInfo | null {
        return this.info;
    }

    /**
     * バージョン文字列を返す
     * @return string
     */
    public getVersionString(): string {
        return this.info == null ? 'EPGStation' : `EPGStation v${this.info.version}`;
    }
}
