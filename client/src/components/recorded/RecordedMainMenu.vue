<template>
    <div class="recorded-main-menu">
        <v-menu class="menu" v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="edit">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-pencil</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>編集</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>

                <v-list-item v-on:click="cleanup">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-delete</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>クリーンアップ</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>

                <v-list-item v-on:click="upload">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-upload</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>アップロード</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import Util from '@/util/Util';
import { Component, Vue } from 'vue-property-decorator';

@Component({})
export default class RecordedMainMenu extends Vue {
    public isOpened: boolean = false;

    public edit(): void {
        this.$emit('edit');
    }

    public cleanup(): void {
        this.$emit('cleanup');
    }

    public async upload(): Promise<void> {
        await Util.sleep(200);
        await Util.move(this.$router, {
            path: '/recorded/upload',
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>
