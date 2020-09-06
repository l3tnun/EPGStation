<template>
    <div>
        <v-menu v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-if="typeof reserveItem.ruleId !== 'undefined'" v-on:click="goToRecorded">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-filmstrip-box-multiple</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>recorded</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-if="!!disableEdit === false" v-on:click="goToEdit">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-pencil</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>edit</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-if="reserveItem.isConflict !== true" v-on:click="onClickDelete">
                    <v-list-item-icon class="mr-3">
                        <v-icon>{{ getDeleteButtonIcon() }}</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>{{ getDeleteMenuText() }}</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
        <ReserveDeleteDialog :isOpen.sync="isOpenDeleteDialog" :reserveItem="reserveItem"></ReserveDeleteDialog>
    </div>
</template>

<script lang="ts">
import ReserveDeleteDialog from '@/components/reserves/ReserveDeleteDialog.vue';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';
import IReservesApiModel from '../../model/api/reserves/IReservesApiModel';

@Component({
    components: {
        ReserveDeleteDialog,
    },
})
export default class ReserveMenu extends Vue {
    @Prop({
        required: true,
    })
    public reserveItem!: apid.ReserveItem;

    @Prop({ required: false })
    public disableEdit: boolean | undefined;

    public isOpened: boolean = false;
    public isOpenDeleteDialog: boolean = false;

    private reserveApiModel: IReservesApiModel = container.get<IReservesApiModel>('IReservesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public getDeleteButtonIcon(): string {
        return this.reserveItem.isSkip === true || this.reserveItem.isOverlap === true ? 'mdi-lock-open' : 'mdi-delete';
    }

    public getDeleteMenuText(): string {
        return this.reserveItem.isSkip === true || this.reserveItem.isOverlap === true ? 'unlock' : 'delete';
    }

    public async onClickDelete(): Promise<void> {
        await Util.sleep(300);

        if (this.reserveItem.isSkip === true) {
            // remove skip
            try {
                await this.reserveApiModel.removeSkip(this.reserveItem.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `${this.reserveItem.name} 除外解除`,
                });
            } catch (err) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.reserveItem.name} 除外解除失敗`,
                });
            }
        } else if (this.reserveItem.isOverlap === true) {
            // remove overlap
            try {
                await this.reserveApiModel.removeOverlap(this.reserveItem.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `${this.reserveItem.name} 重複解除`,
                });
            } catch (err) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.reserveItem.name} 重複解除失敗`,
                });
            }
        } else {
            // cancel reserve
            this.isOpenDeleteDialog = true;
        }
    }

    public goToRecorded(): void {
        if (typeof this.reserveItem.ruleId === 'undefined') {
            return;
        }

        Util.move(this.$router, {
            path: '/recorded',
            query: {
                ruleId: this.reserveItem.ruleId.toString(10),
            },
        });
    }

    public async goToEdit(): Promise<void> {
        if (typeof this.reserveItem.ruleId === 'undefined') {
            await Util.move(this.$router, {
                path: '/reserves/manual',
                query: {
                    reserveId: this.reserveItem.id.toString(10),
                },
            });
        } else {
            await Util.move(this.$router, {
                path: '/search',
                query: {
                    rule: this.reserveItem.ruleId.toString(10),
                },
            });
        }
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>
