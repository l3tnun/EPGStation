export default interface IEncodeFileManageModel {
    getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string>;
    release(filePath: string): void;
}
