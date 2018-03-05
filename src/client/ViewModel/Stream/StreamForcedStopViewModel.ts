import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import ViewModel from '../ViewModel';

/**
 * StreamForcedStopViewModel
 */
class StreamForcedStopViewModel extends ViewModel {
    private streamsApiModel: StreamsApiModelInterface;

    constructor(streamsApiModel: StreamsApiModelInterface) {
        super();
        this.streamsApiModel = streamsApiModel;
    }

    /**
     * forecd stop all
     */
    public async forcedStopAll(): Promise<void> {
        await this.streamsApiModel.forcedStopAll();
    }
}

export default StreamForcedStopViewModel;

