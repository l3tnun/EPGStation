<template>
    <v-app-bar app :dark="$vuetify.theme.dark === false" :color="appBarColor" :clipped-left="navigationState.isClipped">
        <v-app-bar-nav-icon @click.stop="navigationState.toggle"></v-app-bar-nav-icon>
        <v-toolbar-title>{{ title }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <slot name="menu"></slot>
        <template v-if="this.$slots.extension" v-slot:extension>
            <slot name="extension"></slot>
        </template>
    </v-app-bar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import INavigationState from '../../model/state/navigation/INavigationState';

@Component({})
export default class TitleBar extends Vue {
    @Prop({
        required: true,
    })
    public title!: string;
    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    /**
     * title bar の色を返す
     */
    get appBarColor(): string | null {
        return this.$vuetify.theme.dark === true ? null : 'indigo';
    }

    @Watch('title', { immediate: true })
    private onTitleChanged(newTitle: string, old: string): void {
        document.title = newTitle;
    }
}
</script>
