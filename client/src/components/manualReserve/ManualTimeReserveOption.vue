<template>
    <div class="manual-time-reserve-option">
        <v-card>
            <div class="pa-4">
                <SearchOptionRow title="番組名">
                    <v-text-field v-model="manualReserveState.timeSpecifiedOption.name" :disabled="isEditMode" label="sub directory" clearable></v-text-field>
                </SearchOptionRow>
                <SearchOptionRow title="放送局">
                    <div class="d-flex flex-wrap">
                        <v-select
                            class="channel"
                            v-model="manualReserveState.timeSpecifiedOption.channelId"
                            :disabled="isEditMode"
                            :items="manualReserveState.getChannelItems()"
                            label="channel"
                            clearable
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                </SearchOptionRow>
                <SearchOptionRow title="時刻">
                    <div class="d-flex flex-wrap">
                        <v-datetime-picker
                            label="開始"
                            clearText="クリア"
                            okText="設定"
                            v-model="manualReserveState.timeSpecifiedOption.startAt"
                            :disabled="isEditMode"
                            :datePickerProps="{
                                locale: 'jp-ja',
                                'day-format': date => new Date(date).getDate(),
                                'first-day-of-week': 1,
                            }"
                            :timePickerProps="{
                                'ampm-in-title': true,
                            }"
                            :textFieldProps="{
                                color: 'success',
                            }"
                        >
                            <template slot="actions" slot-scope="{ parent }">
                                <v-btn text color="primary" @click.native="parent.clearHandler">クリア</v-btn>
                                <v-btn text color="primary" @click="parent.okHandler">設定</v-btn>
                            </template>
                        </v-datetime-picker>
                        <span class="px-1"></span>
                        <v-datetime-picker
                            label="終了"
                            clearText="クリア"
                            okText="設定"
                            v-model="manualReserveState.timeSpecifiedOption.endAt"
                            :disabled="isEditMode"
                            :datePickerProps="{
                                locale: 'jp-ja',
                                'day-format': date => new Date(date).getDate(),
                                'first-day-of-week': 1,
                            }"
                            :timePickerProps="{
                                'ampm-in-title': true,
                            }"
                        >
                            <template slot="actions" slot-scope="{ parent }">
                                <v-btn text color="primary" @click.native="parent.clearHandler">クリア</v-btn>
                                <v-btn text color="primary" @click="parent.okHandler">設定</v-btn>
                            </template>
                        </v-datetime-picker>
                    </div>
                </SearchOptionRow>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
export default class ManualTimeReserveOption extends Vue {
    @Prop({ required: true })
    public isEditMode!: boolean;

    private manualReserveState: IManualReserveState = container.get<IManualReserveState>('IManualReserveState');
}
</script>
