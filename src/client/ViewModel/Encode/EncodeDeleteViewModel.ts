import * as apid from '../../../../api';
import { EncodingApiModelInterface } from '../../Model/Api/EncodingApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * EncodeDeleteViewModel
 */
class EncodeDeleteViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private encodingApiModel: EncodingApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private encode: apid.EncodingProgram | null = null;

    constructor(
        balloon: BalloonModelInterface,
        encodingApiModel: EncodingApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();

        this.balloon = balloon;
        this.encodingApiModel = encodingApiModel;
        this.snackbar = snackbar;
    }

    /**
     * encode のセット
     * @param encode: EncodingProgram
     */
    public set(encode: apid.EncodingProgram): void {
        this.encode = encode;
    }

    /**
     * get title
     * @return title
     */
    public getTitle(): string {
        return this.encode === null ? '' : `[${ this.encode.name }]${ this.encode.program.name }`;
    }

    /**
     * open dialog
     */
    public open(): void {
        this.balloon.open(EncodeDeleteViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
        this.balloon.close(EncodeDeleteViewModel.id);
    }

    /**
     * stop encode
     */
    public async stop(): Promise<void> {
        if (this.encode === null) { return; }

        try {
            await this.encodingApiModel.stop(this.encode.id);
            this.snackbar.open(`エンコード停止: ${ this.getTitle() }`);
        } catch (err) {
            this.snackbar.open(`エンコード停止失敗: ${ this.getTitle() }`);
            console.error(err);
        }
    }
}

namespace EncodeDeleteViewModel {
    export const id = 'encode-delete-menu';
}

export default EncodeDeleteViewModel;

