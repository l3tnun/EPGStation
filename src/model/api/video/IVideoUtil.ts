import * as apid from '../../../../api';

export default interface IVideoUtil {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<string | null>;
    getParentDirPath(name: string): string | null;
}
