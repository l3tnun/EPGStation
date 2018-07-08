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
    public cleanup(): void {
        this.status = 'CleaningUp';

        Util.sleep(500)
        .then(() => {
            return this.recorded.cleanup();
        })
        .then(async() => {
            this.status = 'Completed';
            this.close();
            await Util.sleep(200);
            this.snackbar.open('クリーンアップ完了');
        })
        .catch(async(err) => {
            console.error(`clean up error: ${ err }`);
            this.status = 'Failed';
            this.close();
            await Util.sleep(200);
            this.snackbar.open('クリーンアップ失敗');
        });

    }

    /**
     * open balloon
     */
    public open(): void {
        this.balloon.open(RecordedCleanupViewModel.cleanupId);
    }

    /**
     * close balloon
     */
    private close(): void {
        this.balloon.close(RecordedCleanupViewModel.cleanupId);
    }
}

namespace RecordedCleanupViewModel {
    export const cleanupId = 'cleanup';
}

export default RecordedCleanupViewModel;

