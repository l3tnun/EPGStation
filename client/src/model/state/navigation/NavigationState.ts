import { inject, injectable } from 'inversify';
import { Route } from 'vue-router';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import INavigationState, { NavigationItem, NavigationType } from './INavigationState';

@injectable()
export default class NavigationState implements INavigationState {
    public openState: null | boolean = null;
    public isClipped: boolean = false;
    public type: NavigationType = 'default';
    public items: NavigationItem[] = [];
    public navigationPosition: number = -1;

    private serverConfig: IServerConfigModel;
    private setting: ISettingStorageModel;

    constructor(@inject('IServerConfigModel') serverConfig: IServerConfigModel, @inject('ISettingStorageModel') setting: ISettingStorageModel) {
        this.serverConfig = serverConfig;
        this.setting = setting;
    }

    /**
     * ナビゲーションの表示内容を更新
     * @param currentRoute: Route
     */
    public updateItems(currentRoute: Route): void {
        const newItems: NavigationItem[] = [];
        newItems.push({
            icon: 'mdi-view-dashboard',
            title: 'ダッシュボード',
            herf: {
                path: '/',
            },
        });

        const config = this.serverConfig.getConfig();

        if (config !== null && config.isEnableTSLiveStream === true) {
            newItems.push({
                icon: 'mdi-television-play',
                title: '放映中',
                herf: {
                    path: '/onair',
                },
            });
        }

        if (this.setting.getSavedValue().isEnableDisplayForEachBroadcastWave === true && config !== null) {
            const types: string[] = [];
            if (config.broadcast.GR === true) {
                types.push('GR');
            }
            if (config.broadcast.BS === true) {
                types.push('BS');
            }
            if (config.broadcast.CS === true) {
                types.push('CS');
            }
            if (config.broadcast.SKY === true) {
                types.push('SKY');
            }

            for (const type of types) {
                newItems.push({
                    icon: 'mdi-television-guide',
                    title: `番組表${type}`,
                    herf: {
                        path: '/guide',
                        query: {
                            type: type,
                        },
                    },
                });
            }
        } else {
            newItems.push({
                icon: 'mdi-television-guide',
                title: '番組表',
                herf: {
                    path: '/guide',
                },
            });
        }

        newItems.push({
            icon: 'mdi-radiobox-marked',
            title: '録画中',
            herf: {
                path: '/recording',
            },
        });
        newItems.push({
            icon: 'mdi-filmstrip-box-multiple',
            title: '録画済み',
            herf: {
                path: '/recorded',
            },
        });
        newItems.push({
            icon: 'mdi-sync',
            title: 'エンコード',
            herf: {
                path: '/encode',
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '予約',
            herf: {
                path: '/reserves',
                query: {
                    type: 'normal',
                },
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '競合',
            herf: {
                path: '/reserves',
                query: {
                    type: 'conflict',
                },
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '重複',
            herf: {
                path: '/reserves',
                query: {
                    type: 'overlap',
                },
            },
        });
        newItems.push({
            icon: 'mdi-magnify',
            title: '検索',
            herf: {
                path: '/search',
            },
        });
        newItems.push({
            icon: 'mdi-calendar',
            title: 'ルール',
            herf: {
                path: '/rule',
            },
        });
        newItems.push({
            icon: 'mdi-sd',
            title: 'ストレージ',
            herf: {
                path: '/storages',
            },
        });
        newItems.push({
            icon: 'settings',
            title: '設定',
            herf: {
                path: '/settings',
            },
        });

        this.items = newItems;
        this.updateNavigationPosition(currentRoute);
    }

    /**
     * ナビゲーションの選択位置を返す
     * @param currentRoute: Route
     * @return number 選択位置がない場合は -1 を返す
     */
    public updateNavigationPosition(currentRoute: Route): void {
        this.navigationPosition = this.items.findIndex(item => {
            if (item.herf === null || item.herf.path !== currentRoute.path) {
                return false;
            }

            if (typeof item.herf.query === 'undefined') {
                return true;
            } else if (typeof currentRoute.query === 'undefined') {
                return false;
            }

            for (const key in item.herf.query) {
                if (item.herf.query[key] !== currentRoute.query[key]) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * ナビゲーションの開閉状態を切り替える
     */
    public toggle(): void {
        this.openState = !this.openState;
    }

    /**
     * ナビゲーションの表示項目を返す
     * @return NavigationItem[]
     */
    public getItems(): NavigationItem[] {
        return this.items;
    }
}
