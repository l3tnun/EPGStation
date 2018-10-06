import { RecordedApiModelInterface } from '../../Model/Api/RecordedApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import Util from '../../Util/Util';
import ViewModel from '../ViewModel';

type CleanupStatus = 'none' | 'CleaningUp' | 'Failed' | 'Completed';

/**
 * RecordedCleanupViewModel
 */
class RecordedCleanupViewModel extends ViewModel {
    private recorded: RecordedApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private balloon: BalloonModelInterface;
    private status: CleanupStatus = 'none';

    constructor(
        recorded: RecordedApiModelInterface,
        snackbar: SnackbarModelInterface,
        balloon: BalloonModelInterface,
    ) {
        super();
        this.recorded = recorded;
        this.snackbar = snackbar;
        this.balloon = balloon;

        this.balloon.regDisableCloseAllId(RecordedCleanupViewModel.cleanupId);
    }

    /**
     * init
     */
    public init(): void {
        this.status = 'none';
    }

    /**
     * getStatus
     * @return CleanupStatus
     */
    public getStatus(): CleanupStatus {
        return this.status;
    }

    /**
     * start cleanup
     */
    public async cleanup(): Promise<void> {
        this.status = 'CleaningUp';

        try {
            await Util.sleep(500);
            await this.recorded.cleanup();
            this.status = 'Completed';
            await Util.sleep(200);
            this.snackbar.open('クリーンアップ完了');
        } catch (err) {
            console.error(`clean up error: ${ err }`);
            this.status = 'Failed';
            await Util.sleep(200);
            this.snackbar.open('クリーンアップ失敗');
        }

        this.balloon.close(RecordedCleanupViewModel.cleanupId);

    }

    /**
     * cleanup 中であることを表示するダイアログを開く
     */
    public open(): void {
        this.balloon.open(RecordedCleanupViewModel.cleanupId);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }
}

namespace RecordedCleanupViewModel {
    export const cleanupCheckId = 'cleanup-check';
    export const cleanupId = 'cleanup';
}

export default RecordedCleanupViewModel;

