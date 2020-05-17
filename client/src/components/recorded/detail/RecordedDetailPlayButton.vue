<template>
    <div>
        <v-btn v-if="videoFiles.length === 1" color="primary" v-on:click="play(videoFiles[0])" class="ma-1">
            <v-icon left dark>mdi-play</v-icon>
            play
        </v-btn>
        <v-menu v-else v-model="isOpened" offset-y>
            <template v-slot:activator="{ on }">
                <v-btn color="primary" v-on="on" class="ma-1">
                    <v-icon left dark>mdi-play</v-icon>
                    play
                </v-btn>
            </template>
            <v-card max-width="200">
                <div class="pa-2 d-flex flex-wrap">
                    <v-btn
                        v-for="video in videoFiles"
                        v-bind:key="video.id"
                        color="success"
                        dark
                        class="ma-1"
                        v-on:click="play(video)"
                    >
                        {{ video.name }}
                    </v-btn>
                </div>
            </v-card>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedDetailPlayButton extends Vue {
    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public isOpened: boolean = false;

    public play(video: apid.VideoFile): void {
        this.$emit('play', video);
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>

<style lang="sass" scoped>
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100%
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>
