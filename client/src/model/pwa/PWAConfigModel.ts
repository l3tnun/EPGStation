import { inject, injectable } from 'inversify';
import { ISettingStorageModel } from '../storage/setting/ISettingStorageModel';
import IPWAConfigModel from './IPWAConfigModel';

@injectable()
export default class PWAConfigModel implements IPWAConfigModel {
    private settingModel: ISettingStorageModel;

    constructor(@inject('ISettingStorageModel') settingModel: ISettingStorageModel) {
        this.settingModel = settingModel;
    }

    /**
     * iOS 用の PWA 設定を行う
     */
    public setting(): void {
        const head = document.getElementsByTagName('head')[0];

        // PWA 設定が無効か?
        if (this.settingModel.getSavedValue().isEnablePWA === false) {
            // manifest 削除
            const links = head.getElementsByTagName('link');
            for (let i = 0; i < links.length; i++) {
                if (links[i].rel === 'manifest') {
                    head.removeChild(links[i]);
                    break;
                }
            }

            return;
        }

        // ios 用設定追加
        this.addMeta(head, {
            name: 'apple-mobile-web-app-title',
            content: 'EPGStation',
        });
        this.addMeta(head, {
            name: 'apple-mobile-web-app-capable',
            content: 'yes',
        });
        this.addMeta(head, {
            name: 'apple-mobile-web-app-status-bar-style',
            content: 'black',
        });

        // service worker 読み込み
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('./serviceWorker.js')
                .then(function (registration) {
                    if (typeof registration.update == 'function') {
                        registration.update();
                    }
                })
                .catch(function (error) {
                    console.log('Error Log: ' + error);
                });
        }
    }

    /**
     * head に meta 要素を追加する
     * @param head: HTMLHeadElement
     * @param param: { [key: string]: string }
     */
    private addMeta(head: HTMLHeadElement, param: { [key: string]: string }) {
        const link = document.createElement('meta');
        for (const key in param) {
            link.setAttribute(key, param[key]);
        }
        head.appendChild(link);
    }
}
