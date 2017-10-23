import * as m from 'mithril';
import ViewModel from '../ViewModel';
import { ViewModelStatus } from '../../Enums';
import * as apid from '../../../../api';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import { SettingModelInterface } from '../../Model/Setting/SettingModel';

/**
* RulesViewModel
*/
class RulesViewModel extends ViewModel {
    private rulesApiModel: RulesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private setting: SettingModelInterface;
    private limit: number = 0;
    private offset: number = 0;

    constructor(
        rulesApiModel: RulesApiModelInterface,
        channels: ChannelsApiModelInterface,
        snackbar: SnackbarModelInterface,
        setting: SettingModelInterface,
    ) {
        super();
        this.rulesApiModel = rulesApiModel;
        this.channels = channels;
        this.snackbar = snackbar;
        this.setting = setting;
    }

    /**
    * init
    * @param status: ViewModelStatus
    */
    public init(status: ViewModelStatus = 'init'): void {
        super.init(status);

        if(status === 'reload' || status === 'updateIo') { this.reloadInit(); return; }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.value.ruleLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.rulesApiModel.init();
        m.redraw();

        //ルール一覧を更新
        setTimeout(async () => {
            await this.rulesApiModel.fetchRules(this.limit, this.offset);
        }, 100);
    }

    /**
    * reload 時の init
    */
     private async reloadInit(): Promise<void> {
        await this.rulesApiModel.fetchRules(this.limit, this.offset);
     }

    /**
    * rule 一覧を返す
    * @return apid.Rules
    */
    public getRules(): apid.Rules {
        return this.rulesApiModel.getRules();
    }

    /**
    * id を指定して channel 名を取得する
    * @param channelId: channel id
    * @return string
    */
    public getChannelName(channelId: apid.ServiceItemId): string {
        let channel = this.channels.getChannel(channelId);
        return channel === null ? String(channelId) : channel.name;
    }

    /**
    * limit を返す
    */
    public getLimit(): number {
        return this.limit;
    }

    /**
    * rule 有効化
    * @param rule: Rule
    */
    public async enable(rule: apid.Rule): Promise<void> {
        const keyword = typeof rule.keyword === 'undefined' ? '-' : rule.keyword;

        try {
            await this.rulesApiModel.enable(rule.id);
            this.snackbar.open(`有効化: ${ keyword }`);
        } catch(err) {
            console.error(err);
            this.snackbar.open(`有効化失敗: ${ keyword }`);
        }
    }

    /**
    * rule 無効化
    * @param rule: Rule
    */
    public async disable(rule: apid.Rule): Promise<void> {
        const keyword = typeof rule.keyword === 'undefined' ? '-' : rule.keyword;

        try {
            await this.rulesApiModel.disable(rule.id);
            this.snackbar.open(`無効化: ${ keyword }`);
        } catch(err) {
            console.error(err);
            this.snackbar.open(`無効化失敗: ${ keyword }`);
        }
    }
}

export default RulesViewModel;

