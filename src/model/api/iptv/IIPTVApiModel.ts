export default interface IIPTVApiModel {
    getChannelList(host: string, isSecure: boolean, mode: number, isHalfWidth: boolean): Promise<string>;
    getEpg(days: number, isHalfWidth: boolean): Promise<string>;
}
