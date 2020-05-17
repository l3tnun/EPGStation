import { Location, Route } from 'vue-router';

export type NavigationType = 'permanent' | 'temporary' | 'default';

export interface NavigationItem {
    title: string;
    icon: string;
    herf: Location | null;
}

export default interface INavigationState {
    openState: boolean | null;
    isClipped: boolean;
    type: NavigationType;
    updateItems(): void;
    toggle(): void;
    getItems(): NavigationItem[];
    getSelectedPosition(currentRoute: Route): number;
}
