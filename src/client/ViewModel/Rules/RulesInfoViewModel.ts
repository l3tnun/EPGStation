import * as apid from '../../../../api';
import { ChannelsApiModelInterface } from '../../Model/Api/ChannelsApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import ViewModel from '../ViewModel';

/**
 * RulesInfoViewModel
 */
class RulesInfoViewModel extends ViewModel {
    private rule: apid.Rule | null = null;
    private balloon: BalloonModelInterface;
    private channels: ChannelsApiModelInterface;

    constructor(
        balloon: BalloonModelInterface,
        channels: ChannelsApiModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.channels = channels;
    }

    /**
     * rule のセット
     * @param rule: Rule
     */
    public set(rule: apid.Rule): void {
        this.rule = rule;
    }

    /**
     * rule の取得
     * @return Rule
     */
    public get(): apid.Rule | null {
        return this.rule;
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }

    /**
     * channel 名を取得する
     * @return string
     */
    public getChannelName(): string {
        if (this.rule === null || typeof this.rule.station === 'undefined') { return '-'; }
        const channel = this.channels.getChannel(this.rule.station);

        return channel === null ? String(this.rule.station) : channel.name;
    }
}

namespace RulesInfoViewModel {
    export const id = 'rules-info';
}

export default RulesInfoViewModel;

