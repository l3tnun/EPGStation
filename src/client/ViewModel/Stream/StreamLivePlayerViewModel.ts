import * as m from 'mithril';
import * as apid from '../../../../api';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import ViewModel from '../ViewModel';

type StreamTypes = 'webm' | 'mp4';

/**
 * StreamLivePlayerViewModel
 */
class StreamLivePlayerViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private channel: apid.ScheduleServiceItem | null = null;
    private type: StreamTypes | null = null;
    private mode: number | null = null;

    constructor(
        balloon: BalloonModelInterface,
    ) {
        super();
        this.balloon = balloon;

        this.balloon.regDisableCloseAllId(StreamLivePlayerViewModel.id);
    }

    /**
     * channel, mode のセット
     * @param channel: apid.ScheduleServiceItem
     * @param mode: number
     */
    public set(channel: apid.ScheduleServiceItem, type: StreamTypes, mode: number): void {
        this.channel = channel;
        this.type = type;
        this.mode = mode;

        m.redraw();
    }

    /**
     * get src
     * @return string | null
     */
    public getSrc(): string | null {
        if (this.channel === null || this.type === null || this.mode === null) { return null; }

        return `/api/streams/live/${ this.channel.id }/${ this.type }?mode=${ this.mode }`;
    }

    /**
     * open balloon
     */
    public open(): void {
        this.balloon.open(StreamLivePlayerViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(StreamLivePlayerViewModel.id);
    }

    /**
     * set close callback
     */
    public setCloseCallback(callback: () => void): void {
        this.balloon.setCloseCallback(StreamLivePlayerViewModel.id, () => {
            this.channel = null;
            this.mode = null;

            callback();
        });
    }
}

namespace StreamLivePlayerViewModel {
    export const id = 'stream-live-player';
    export const maxWidth = 800;
}

export default StreamLivePlayerViewModel;

