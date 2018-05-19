import RecordedWatchViewModel from '../../../ViewModel/Recorded/RecordedWatchViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import VideoContainerComponent from '../../Video/VideoContainerComponent';

/**
 * RecordedWatchVideoContainerComponent
 */
class RecordedWatchVideoContainerComponent extends VideoContainerComponent {
    private viewModel: RecordedWatchViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedWatchViewModel> factory.get('RecordedWatchViewModel');
    }

    /**
     * get video duration
     * @return number
     */
    protected getVideoDuration(): number {
        return this.viewModel.getDuration();
    }

    /**
     * get video current time
     * @return number
     */
    protected getVideoCurrentTime(): number {
        return this.viewModel.getPlayBackStartPosition() + super.getVideoCurrentTime();
    }

    /**
     * update video currentTime
     * @param position: number
     */
    protected updateVideoCurrentTime(position: number): void {
        this.viewModel.changePLayBackPosition(position);
    }
}

export default RecordedWatchVideoContainerComponent;

