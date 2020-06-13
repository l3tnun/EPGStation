<template>
    <div class="on-air pa-2">
        <v-card class="mx-auto" max-width="800">
            <div v-for="item in items" v-bind:key="item.display.channelId">
                <v-list-item three-line>
                    <v-list-item-content>
                        <div class="subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                        <div class="caption font-weight-light">{{ item.display.time }}</div>
                        <div class="subtitle-2 grey--text text--darken-2 font-weight-bold">
                            {{ item.display.name }}
                        </div>
                        <div class="body-2 grey--text text--darken-2">{{ item.display.description }}</div>
                    </v-list-item-content>
                </v-list-item>
                <v-divider></v-divider>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';
import { OnAirDisplayData } from '../../model/state/onair/IOnAirState';

@Component({})
export default class OnAirCard extends Vue {
    @Prop({ required: true })
    public items!: OnAirDisplayData[];
}
</script>
