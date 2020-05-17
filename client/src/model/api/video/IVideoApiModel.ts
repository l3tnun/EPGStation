import * as apid from '../../../../../api';

export default interface IVideoApiModel {
    delete(videoFileId: apid.VideoFileId): Promise<void>;
}
