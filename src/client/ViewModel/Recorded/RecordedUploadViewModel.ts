import { ViewModelStatus } from '../../Enums';
import ViewModel from '../ViewModel';

/**
 * RecordedUploadViewModel
 */
class RecordedUploadViewModel extends ViewModel {
    /**
     * init
     */
    public async init(status: ViewModelStatus = 'init'): Promise<void> {
        super.init(status);
    }
}

export default RecordedUploadViewModel;

