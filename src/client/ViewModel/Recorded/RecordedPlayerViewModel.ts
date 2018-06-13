import * as m from 'mithril';
import * as apid from '../../../../api';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import ViewModel from '../ViewModel';

/**
 * RecordedPlayerViewModel
 */
class RecordedPlayerViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private recorded: apid.RecordedProgram | null = null;
    private encodedId: number | null = null;

    constructor(
        balloon: BalloonModelInterface,
    ) {
        super();
        this.balloon = balloon;

        this.balloon.regDisableCloseAllId(RecordedPlayerViewModel.id);
    }

    /**
     * recorded のセット
     * @param recorded: recorded
     * @param encodedId: number | null
     */
    public set(recorded: apid.RecordedProgram, encodedId: number | null = null): void {
        this.recorded = recorded;
        this.encodedId = encodedId;

        m.redraw();
    }

    /**
     * get src
     * @return string | null
     */
    public getSrc(): string | null {
        if (this.recorded === null) { return null; }

        let src = `./api/recorded/${ this.recorded.id }/file`;
        if (this.encodedId !== null) { src += `?encodedId=${ this.encodedId }`; }

        return src;
    }

    /**
     * open balloon
     */
    public open(): void {
        this.balloon.open(RecordedPlayerViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close(RecordedPlayerViewModel.id);
    }

    /**
     * set close callback
     */
    public setCloseCallback(callback: () => void): void {
        this.balloon.setCloseCallback(RecordedPlayerViewModel.id, () => {
            this.recorded = null;
            this.encodedId = null;

            callback();
        });
    }
}

namespace RecordedPlayerViewModel {
    export const id = 'recorded-player';
    export const maxWidth = 800;
}

export default RecordedPlayerViewModel;

