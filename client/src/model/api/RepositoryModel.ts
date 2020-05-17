import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, CancelTokenSource } from 'axios';
import { injectable } from 'inversify';
import stringify from 'json-stable-stringify';
import IRepositoryModel from './IRepositoryModel';

type MethodType = 'GET' | 'DELETE' | 'POST' | 'PUT';

/**
 * RepositoryModel
 * axios のラッパー
 */
@injectable()
export default class RepositoryModel implements IRepositoryModel {
    private repo: AxiosInstance;
    private cancelSourceIndex: { [key: string]: CancelTokenSource } = {};

    constructor() {
        this.repo = axios.create({
            baseURL: './api',
            headers: {
                'Content-Type': 'application/json',
            },
            responseType: 'json',
        });
    }

    /**
     * get リクエスト
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     * @return Promise<AxiosResponse<any>>
     */
    public get(url: string, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>> {
        const key = this.setToken('GET', url, config);
        const result = this.repo.get(url, config);
        delete this.cancelSourceIndex[key];

        return result;
    }

    /**
     * delete リクエスト
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     * @return Promise<AxiosResponse<any>>
     */
    public delete(url: string, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>> {
        const key = this.setToken('DELETE', url, config);
        const result = this.repo.delete(url, config);
        delete this.cancelSourceIndex[key];

        return result;
    }

    /**
     * put リクエスト
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     * @return Promise<AxiosResponse<any>>
     */
    public put(url: string, data?: any, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>> {
        const key = this.setToken('PUT', url, config);
        const result = this.repo.put(url, data, config);
        delete this.cancelSourceIndex[key];

        return result;
    }

    /**
     * post リクエスト
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     * @return Promise<AxiosResponse<any>>
     */
    public post(url: string, data?: any, config?: AxiosRequestConfig | undefined): Promise<AxiosResponse<any>> {
        const key = this.setToken('POST', url, config);
        const result = this.repo.post(url, data, config);
        delete this.cancelSourceIndex[key];

        return result;
    }

    /**
     * config に cancel token を追加
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     * @return string token source key
     */
    private setToken(type: MethodType, url: string, config?: AxiosRequestConfig | undefined): string {
        const sourceKey = this.getCancelTokenKey(type, url, config);
        const oldTokenSource = this.cancelSourceIndex[sourceKey];
        if (typeof oldTokenSource !== 'undefined') {
            // 前回の通信が完了していない場合は cancel
            oldTokenSource.cancel();
        }

        // token source 作成
        const tokenSource = axios.CancelToken.source();
        this.cancelSourceIndex[sourceKey] = tokenSource;

        // config に toke 追加
        if (typeof config === 'undefined') {
            config = {
                cancelToken: tokenSource.token,
            };
        } else {
            config.cancelToken = tokenSource.token;
        }

        return sourceKey;
    }

    /**
     * config に cancel token を追加
     * @param type: MethodType
     * @param url: string
     * @param config?: AxiosRequestConfig | undefined
     */
    private getCancelTokenKey(type: MethodType, url: string, config?: AxiosRequestConfig | undefined): string {
        let key = `${type}:${url}`;
        if (typeof config !== 'undefined') {
            key += `:${stringify(config)}}`;
        }

        return key;
    }
}
