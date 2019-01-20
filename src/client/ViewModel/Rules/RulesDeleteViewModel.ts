import * as apid from '../../../../api';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * RulesDeleteViewModel
 */
class RulesDeleteViewModel extends ViewModel {
    private rulesApiModel: RulesApiModelInterface;
    private balloon: BalloonModelInterface;
    private snackbar: SnackbarModelInterface;
    private rule: apid.Rule | null = null;

    public isDeleteRecorded: boolean = false;

    constructor(
        rulesApiModel: RulesApiModelInterface,
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.rulesApiModel = rulesApiModel;
        this.balloon = balloon;
        this.snackbar = snackbar;
    }

    /**
     * rule のセット
     * @param rule: Rule
     */
    public set(rule: apid.Rule): void {
        this.rule = rule;
    }

    /**
     * get keyword
     * @return keyword
     */
    public getKeyword(): string {
        return this.rule === null || typeof this.rule.keyword === 'undefined' ? '' : this.rule.keyword;
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }

    /**
     * rule 削除
     * @param rule: Rule
     */
    public async delete(): Promise<void> {
        if (this.rule === null) { return; }

        const keyword = typeof this.rule.keyword === 'undefined' ? '-' : this.rule.keyword;
        try {
            await this.rulesApiModel.delete(this.rule.id, this.isDeleteRecorded);
            this.snackbar.open(`削除: ${ keyword }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`削除失敗: ${ keyword }`);
        }
    }
}

namespace RulesDeleteViewModel {
    export const id = 'rule-delete';
}

export default RulesDeleteViewModel;

