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
    items: NavigationItem[];
    navigationPosition: number;
    updateItems(currentRoute: Route): void;
    updateNavigationPosition(currentRoute: Route): void;
    toggle(): void;
    getItems(): NavigationItem[];
}
