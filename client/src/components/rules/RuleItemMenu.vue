<template>
    <div>
        <v-menu bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="onRecorded">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-filmstrip-box-multiple</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>recorded</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="onEdit">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-pencil</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>edit</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-delete</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>delete</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <RuleDeleteDialog :isOpen.sync="isOpenDeleteDialog" :ruleItem="ruleItem"></RuleDeleteDialog>
    </div>
</template>

<script lang="ts">
import RuleDeleteDialog from '@/components/rules/RuleDeleteDialog.vue';
import { RuleStateData } from '@/model/state/rule/IRuleState';
import Util from '@/util/Util';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        RuleDeleteDialog,
    },
})
export default class RuleItemMenu extends Vue {
    @Prop({ required: true })
    public ruleItem!: RuleStateData;

    public isOpenDeleteDialog: boolean = false;

    public onRecorded(): void {
        Util.move(this.$router, {
            path: '/recorded',
            query: {
                ruleId: this.ruleItem.display.id.toString(10),
            },
        });
    }

    public onEdit(): void {
        Util.move(this.$router, {
            path: '/search',
            query: {
                rule: this.ruleItem.display.id.toString(10),
            },
        });
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }
}
</script>
