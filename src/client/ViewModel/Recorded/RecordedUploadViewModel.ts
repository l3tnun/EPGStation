import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { genre1, genre2 } from '../../lib/event';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { RulesApiModelInterface } from '../../Model/Api/RulesApiModel';
import ViewModel from '../ViewModel';

/**
 * RecordedUploadViewModel
 */
class RecordedUploadViewModel extends ViewModel {
    private channels: ChannelsApiModelInterface;
    private rules: RulesApiModelInterface;

    public station: number = 0;
    public genrelv1: apid.ProgramGenreLv1 = -1;
    public genrelv2: apid.ProgramGenreLv1 = -1;
    public ruleId: number = 0;
    public title: string = '';
    public description: string = '';
    public extended: string = '';

    constructor(
        channels: ChannelsApiModelInterface,
        rules: RulesApiModelInterface,
    ) {
        super();

        this.channels = channels;
        this.rules = rules;
    }

    /**
     * init
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);

        if (status === 'init' || status === 'update') {
            this.initInput();

            await this.rules.fetchRuleList();
        }
    }

    /**
     * init input
     */
    public initInput(): void {
        this.station = 0;
        this.genrelv1 = -1;
        this.initGenre2();
        this.ruleId = 0;
        this.title = '';
        this.description = '';
        this.extended = '';
    }

    /**
     * get channels
     * @return channels
     */
    public getChannels(): apid.ServiceItem[] {
        return this.channels.getChannels();
    }

    /**
     * get genre1
     * @return genre1
     */
    public getGenre1(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        for (let i = 0x0; i <= 0xF; i++) {
            if (genre1[i].length === 0) { continue; }
            result.push({ value: i, name: genre1[i] });
        }

        return result;
    }

    /**
     * get genre2
     * @return genre2
     */
    public getGenre2(): { value: number; name: string }[] {
        const result: { value: number; name: string }[] = [];
        if (typeof genre2[this.genrelv1] === 'undefined') { return []; }

        for (let i = 0x0; i <= 0xF; i++) {
            if (genre2[this.genrelv1][i].length === 0) { continue; }
            result.push({ value: i, name: genre2[this.genrelv1][i] });
        }

        return result;
    }

    /**
     * init genre2
     */
    public initGenre2(): void {
        this.genrelv2 = -1;
    }

    /**
     * get rule list
     * @return
     */
    public getRuleList(): apid.RuleList[] {
        return this.rules.getRuleList();
    }
}

export default RecordedUploadViewModel;

