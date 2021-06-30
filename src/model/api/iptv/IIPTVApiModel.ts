export default interface IIPTVApiModel {
    getChannelList(
        host: string,
        isSecure: boolean,
        mode: number,
        isHalfWidth: boolean,
        subDirectory?: string,
    ): Promise<string>;
    getEpg(days: number, isHalfWidth: boolean): Promise<string>;
}
