import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { ReservesApiModelInterface, RuleReservesCount } from '../../Model/Api/ReservesApiModel';
import { RuleFindQueryOption, RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { SettingValue } from '../../Model/Setting/SettingModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import StorageTemplateModel from '../../Model/Storage/StorageTemplateModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

/**
 * RulesViewModel
 */
class RulesViewModel extends ViewModel {
    public isDeleteRecorded: boolean = false;

    private rulesApiModel: RulesApiModelInterface;
    private channels: ChannelsApiModelInterface;
    private reservesApiModel: ReservesApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private setting: StorageTemplateModel<SettingValue>;
    private limit: number = 0;
    private offset: number = 0;
    private option: RuleFindQueryOption = {};
    private ruleReservesCount: RuleReservesCount = {};

    private isEditMode: boolean = false;
    private editSelectIndex: { [key: number]: boolean } = {};

    constructor(
        rulesApiModel: RulesApiModelInterface,
        channels: ChannelsApiModelInterface,
        reservesApiModel: ReservesApiModelInterface,
        snackbar: SnackbarModelInterface,
        setting: StorageTemplateModel<SettingValue>,
    ) {
        super();
        this.rulesApiModel = rulesApiModel;
        this.channels = channels;
        this.reservesApiModel = reservesApiModel;
        this.snackbar = snackbar;
        this.setting = setting;
    }

    /**
     * init
     * @param status: ViewModelStatus
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'reload' || status === 'updateIo') { return this.reloadInit(); }

        this.limit = typeof m.route.param('length') === 'undefined' ? this.setting.getValue().ruleLength : Number(m.route.param('length'));
        this.offset = typeof m.route.param('page') === 'undefined' ? 0 : (Number(m.route.param('page')) - 1) * this.limit;

        this.option = {};
        if (typeof m.route.param('keyword') !== 'undefined') { this.option.keyword = m.route.param('keyword'); }

        this.rulesApiModel.init();
        this.reservesApiModel.init();
        if (status === 'update') { m.redraw(); }

        // ルール一覧を更新
        await Util.sleep(100);
        await this.fetchData();
    }

    /**
     * reload 時の init
     */
    private reloadInit(): Promise<void> {
        return this.fetchData();
    }

    /**
     * fetchData
     */
    private async fetchData(): Promise<void> {
        await this.rulesApiModel.fetchRules(this.limit, this.offset, this.option);
        this.ruleReservesCount = await this.reservesApiModel.fetchRuleReservesCountCount();

        if (this.isEditing()) {
            this.setEditSelectIndex();
        }
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
     * 編集中か
     * @return boolean
     */
    public isEditing(): boolean {
        return this.isEditMode;
    }

    /**
     * 編集中に切り替え
     */
    public startEditMode(): void {
        this.setEditSelectIndex();
        this.isEditMode = true;
        this.isDeleteRecorded = false;
    }

    /**
     * 編集モード終了
     */
    public endEditMode(): void {
        this.editSelectIndex = {};
        this.isEditMode = false;
        this.isDeleteRecorded = false;
    }

    /**
     * set edit select Index
     */
    private setEditSelectIndex(): void {
        const rules = this.getRules().rules;
        const newSelectIndex: { [key: number]: boolean } = {};
        for (const r of rules) {
            const oldData = this.editSelectIndex[r.id];
            newSelectIndex[r.id] = typeof oldData === 'undefined' ? false : oldData;
        }

        // update
        this.editSelectIndex = newSelectIndex;
    }

    /**
     * select
     * @param ruleId: rule id
     */
    public select(ruleId: number): void {
        if (!this.isEditing()) { return; }
        if (typeof this.editSelectIndex[ruleId] === 'undefined') {
            throw new Error(`${ ruleId } is not found.`);
        }

        this.editSelectIndex[ruleId] = !this.editSelectIndex[ruleId];

        m.redraw();
    }

    /**
     * select all
     * 全て選択済みであれば選択を解除する
     */
    public selectAll(): void {
        let isUnselect = true;
        for (const key in this.editSelectIndex) {
            if (!this.editSelectIndex[key]) {
                isUnselect = false;
            }
            this.editSelectIndex[key] = true;
        }

        if (isUnselect) {
            for (const key in this.editSelectIndex) {
                this.editSelectIndex[key] = false;
            }
        }

        m.redraw();
    }

    /**
     * is selecting
     * @param ruleId: rule id
     * @return boolean
     */
    public isSelecting(ruleId: number): boolean {
        if (!this.isEditing()) { return false; }

        return this.editSelectIndex[ruleId];
    }

    /**
     * 選択した要素の件数を返す
     * @return number
     */
    public getSelectedCnt(): number {
        if (!this.isEditing()) { return 0; }

        let cnt = 0;
        for (const key in this.editSelectIndex) {
            if (this.editSelectIndex[key]) { cnt += 1; }
        }

        return cnt;
    }

    /**
     * 指定した rule id の予約件数を返す
     * @param ruleId: number
     * @return number;
     */
    public getRuleReservesCount(ruleId: number): number | string {
        const count = this.ruleReservesCount[ruleId];

        return typeof count === 'undefined' ? '-' : count;
    }

    /**
     * rule 有効化
     * @param rule: Rule
     */
    public async enable(rule: apid.Rule): Promise<void> {
        const keyword = typeof rule.keyword === 'undefined' ? '-' : rule.keyword;

        try {
            await this.rulesApiModel.enable(rule.id);
            this.openSnackbar(`有効化: ${ keyword }`);
        } catch (err) {
            console.error(err);
            this.openSnackbar(`有効化失敗: ${ keyword }`);
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
            this.openSnackbar(`無効化: ${ keyword }`);
        } catch (err) {
            console.error(err);
            this.openSnackbar(`無効化失敗: ${ keyword }`);
        }
    }

    /**
     * 選択したルールを削除
     * @return Promise<void>
     */
    public async deleteSelectedRules(): Promise<void> {
        const ids: number[] = [];
        for (const key in this.editSelectIndex) {
            if (this.editSelectIndex[key]) {
                ids.push(parseInt(key, 10));
            }
        }

        try {
            await this.rulesApiModel.deleteMultiple(ids, this.isDeleteRecorded);
            this.openSnackbar('選択したルールを削除しました。');
        } catch (err) {
            this.openSnackbar('一部のルールが削除されませんでした。');
        }

        this.endEditMode();
        m.redraw();
    }

    /**
     * open snack bar
     * @param str: string
     */
    public openSnackbar(str: string): void {
        this.snackbar.open(str);
    }
}

namespace RulesViewModel {
    export const multipleDeleteId = 'rules-multiple-delete';
}

export default RulesViewModel;

