import * as apid from '../../../../api';
import { StreamingTypes } from '../../Enums';
import { ConfigApiModelInterface } from '../../Model/Api/ConfigApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';


class RecordedWatchSelectViewModel extends ViewModel {
    private config: ConfigApiModelInterface;
    private balloon: BalloonModelInterface;

    private recorded: apid.RecordedProgram | null = null;
    private openOriginalUrl: () => void;
    public streamingTypeValue: StreamingTypes | null = null;
    public streamingModeValue: number = 0;

    constructor(
        config: ConfigApiModelInterface,
        balloon: BalloonModelInterface,
    ) {
        super();

        this.config = config;
        this.balloon = balloon;
    }

    /**
     * set
     * @param recorded: apid.RecordedProgram
     * @param openOriginalUrl: () => void
     */
    public set(recorded: apid.RecordedProgram, openOriginalUrl: () => void): void {
        this.recorded = recorded;
        this.openOriginalUrl = openOriginalUrl;

        if (this.streamingTypeValue === null) {
            const options = this.getTypeOption();
            if (options.length > 0) {
                this.streamingTypeValue = options[0];
            }
        }
    }

    /**
     * get type option
     */
    public getTypeOption(): StreamingTypes[] {
        const types: StreamingTypes[] = [];
        const config = this.config.getConfig();
        if (config === null || typeof config.recordedStreaming === 'undefined') { return []; }

        if (typeof config.recordedStreaming.webm !== 'undefined') { types.push('WebM'); }
        if (typeof config.recordedStreaming.mp4 !== 'undefined') { types.push('MP4'); }

        return types;
    }

    /**
     * get mode option
     * @return string[]
     */
    public getOptions(): string[] {
        const config = this.config.getConfig();
        if (config === null || typeof config.recordedStreaming === 'undefined' || this.streamingTypeValue === null) { return []; }

        if (this.streamingTypeValue === 'WebM' && typeof config.recordedStreaming.webm !== 'undefined') {
            return config.recordedStreaming.webm;
        } else if (this.streamingTypeValue === 'MP4' && typeof config.recordedStreaming.mp4 !== 'undefined') {
            return config.recordedStreaming.mp4;
        } else {
            return [];
        }
    }

    /**
     * get name
     * @return string;
     */
    public getName(): string {
        return this.recorded !== null ? this.recorded.name : '';
    }

    /**
     * isEnabledStreaming
     * @return boolean
     */
    public isEnabledStreaming(): boolean {
        const config = this.config.getConfig();

        return config !== null
            && typeof config.recordedStreaming !== 'undefined'
            && (typeof config.recordedStreaming.webm !== 'undefined' || typeof config.recordedStreaming.mp4 !== 'undefined');
    }

    /**
     * 視聴ページへ飛ぶ
     */
    public async view(): Promise<void> {
        if (this.recorded === null || this.streamingTypeValue === null) { return; }

        this.close();
        await Util.sleep(200);
        if (this.streamingTypeValue === 'WebM') {
            // WebM
            Util.move(`/recorded/${ this.recorded.id }/watch?type=webm&mode=${ this.streamingModeValue }`);
        } else if (this.streamingTypeValue === 'MP4') {
            // WebM
            Util.move(`/recorded/${ this.recorded.id }/watch?type=webm&mode=${ this.streamingModeValue }`);
        }
    }

    /**
     * view original
     */
    public viewOriginal(): void {
        this.openOriginalUrl();
    }

    /**
     * open balloon
     */
    public open(): void {
        this.balloon.open(RecordedWatchSelectViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(RecordedWatchSelectViewModel.id);
    }
}

namespace RecordedWatchSelectViewModel {
    export const id = 'recorded-streaming-selector';
}

export default RecordedWatchSelectViewModel;

