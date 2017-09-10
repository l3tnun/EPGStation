import * as m from 'mithril';
import ApiModel from './ApiModel';
import * as apid from '../../../../api';

interface ConfigApiModelInterface extends ApiModel {
    update(): Promise<void>;
    getConfig(): apid.Config | null;
}

/**
* ConfigApiModel
* /api/config を取得
*/
class ConfigApiModel extends ApiModel implements ConfigApiModelInterface {
    private config: apid.Config | null = null;

    /**
    * config 取得
    */
    public async update(): Promise<void> {
        // 一度取得できれば良い
        if(this.config !== null) { return; }

        try {
            this.config = <apid.Config> await m.request({
                method: 'GET',
                url: '/api/config'
            });
        } catch(err) {
            this.config = null;
            console.error('/api/config');
            console.error(err);
            this.openSnackbar('サーバー設定情報取得に失敗しました');
        }
    }

    /**
    * get Config
    */
    public getConfig(): apid.Config | null {
        return this.config;
    }
}

export { ConfigApiModelInterface, ConfigApiModel };

