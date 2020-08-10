import { AxiosRequestConfig, AxiosResponse } from 'axios';

export default interface IRepositoryModel {
    get(url: string, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>>;
    getText(url: string, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>>;
    delete(url: string, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>>;
    put(url: string, data?: any, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>>;
    post(url: string, data?: any, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>>;
}
