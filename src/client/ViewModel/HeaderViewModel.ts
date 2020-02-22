import * as apid from '../../../api';
import { ChannelsApiModelInterface } from '../Model/Api/ChannelsApiModel';
import { ConfigApiModelInterface } from '../Model/Api/ConfigApiModel';
import { BalloonModelInterface } from '../Model/Balloon/BallonModel';
import ViewModel from './ViewModel';

/**
 * HeaderViewModel
 */
class HeaderViewModel extends ViewModel {
    private configApiModel: ConfigApiModelInterface;
    private balloon: BalloonModelInterface;
    private channels: ChannelsApiModelInterface;

    constructor(
        configApiModel: ConfigApiModelInterface,
        balloon: BalloonModelInterface,
        channels: ChannelsApiModelInterface,
    ) {
        super();
        this.configApiModel = configApiModel;
        this.balloon = balloon;
        this.channels = channels;
    }

    /**
     * init
     */
    public init(): void {
        super.init();
        this.channels.fetchChannel();
    }

    /**
     * getConfig
     * @return apid.Config | null
     */
    public getConfig(): apid.Config | null {
        return this.configApiModel.getConfig();
    }

    /**
     * close menu
     */
    public close(): void {
        this.balloon.close();
    }
}

namespace HeaderViewModel {
    export const menuId = 'header-menu';
}

export default HeaderViewModel;

