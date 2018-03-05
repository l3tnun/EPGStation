import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import { StreamsApiModelInterface } from '../../Model/Api/StreamsApiModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * StreamWatchViewModel
 */
class StreamWatchViewModel extends ViewModel {
    private streamApiModel: StreamsApiModelInterface;
    private streamNumber: number | null = null;
    private snackbar: SnackbarModelInterface;

    constructor(
        streamApiModel: StreamsApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.streamApiModel = streamApiModel;
        this.snackbar = snackbar;
    }

    /**
     * init
     */
    public init(status: ViewModelStatus = 'init'): void {
        super.init(status);

        this.streamNumber = typeof m.route.param('stream') === 'undefined' ? null : Number(m.route.param('stream'));

        this.streamApiModel.init();

        setTimeout(async() => {
            await this.streamApiModel.fetchInfos();
        }, 100);
    }

    /**
     * get info
     * @return apid.StreamInfo | null
     */
    public getInfo(): apid.StreamInfo | null {
        const info = this.streamApiModel.getInfos().find((stream) => {
            return stream.streamNumber === this.streamNumber;
        });

        return typeof info === 'undefined' ? null : info;
    }

    /**
     * isEnable
     * @return boolean true: ビデオ再生可能, false: ビデオ再生不可能
     */
    public isEnable(): boolean {
        const info = this.getInfo();

        return info === null ? false : info.isEnable;
    }

    /**
     * video の src を返す
     * @return string
     */
    public getSource(): string {
        return this.streamNumber === null ? '' : `/streamfiles/stream${ this.streamNumber }.m3u8`;
    }

    /**
     * ストリームの停止
     */
    public async stop(): Promise<void> {
        if (this.streamNumber === null) { return; }

        await this.streamApiModel.stop(this.streamNumber);
    }

    /**
     * open snackbar
     * @param msg: message
     */
    public openSnackbar(msg: string): void {
        this.snackbar.open(msg);
    }
}

export default StreamWatchViewModel;

