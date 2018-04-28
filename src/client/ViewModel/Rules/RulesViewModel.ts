import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { SettingValue } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RulesViewModel
 */
class RulesViewModel extends ViewModel {
    private rulesApiModel: RulesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
    private limit: number = 0;
    private offset: number = 0;

    constructor(
        rulesApiModel: RulesApiModelInterface,
        channels: ChannelsApiModelInterface,
        snackbar: SnackbarModelInterface,
        setting: StorageTemplateModel<SettingValue>,
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
    public init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadInit(); }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.getValue().ruleLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.rulesApiModel.init();
        if (status === 'update') { m.redraw(); }

        // ルール一覧を更新
        return Util.sleep(100)
        .then(() => {
            return this.rulesApiModel.fetchRules(this.limit, this.offset);
        });
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
     * 現在のページを取得
     * @return number
     */
    public getPage(): number {
        return this.rulesApiModel.getPage();
    }

    /**
     * id を指定して channel 名を取得する
     * @param channelId: channel id
     * @return string
     */
    public getChannelName(channelId: apid.ServiceItemId): string {
        const channel = this.channels.getChannel(channelId);

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
        } catch (err) {
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
        } catch (err) {
            console.error(err);
            this.snackbar.open(`無効化失敗: ${ keyword }`);
        }
    }
}

export default RulesViewModel;

