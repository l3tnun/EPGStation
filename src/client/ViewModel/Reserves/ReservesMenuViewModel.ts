import * as apid from '../../../../api';
import { ReservesApiModelInterface } from '../../Model/Api/ReservesApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import ViewModel from '../ViewModel';

/**
 * ReservesMenuViewModel
 */
class ReservesMenuViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private reservesApiModel: ReservesApiModelInterface;
    private snackbar: SnackbarModelInterface;
    private reserve: apid.Reserve | null = null;

    constructor(
        balloon: BalloonModelInterface,
        reservesApiModel: ReservesApiModelInterface,
        snackbar: SnackbarModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.reservesApiModel = reservesApiModel;
        this.snackbar = snackbar;
    }

    /**
     * reserve のセット
     * @param reserve: apid.Reserve
     */
    public set(reserve: apid.Reserve): void {
        this.reserve = reserve;
    }

    /**
     * programId の取得
     * @return program id | null
     */
    public getProgramId(): number | null {
        return this.reserve === null ? null : this.reserve.program.id;
    }

    /**
     * ruleId の取得
     * @return rule id | null
     */
    public getRuleId(): number | null {
        return this.reserve === null || typeof this.reserve.ruleId === 'undefined' ? null : this.reserve.ruleId;
    }

    /**
     * get title
     * @return title
     */
    public getTitle(): string {
        return this.reserve === null ? '' : this.reserve.program.name;
    }

    /**
     * open delete dialog
     */
    public openDelete(): void {
        this.close();
        setTimeout(() => {
            this.balloon.open(ReservesMenuViewModel.deleteId);
        }, 200);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }

    /**
     * delete recorded file
     */
    public async delete(): Promise<void> {
        if (this.reserve === null) { return; }

        try {
            await this.reservesApiModel.deleteReserve(this.reserve.program.id);
            this.snackbar.open(`削除: ${ this.reserve.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`削除失敗: ${ this.reserve.program.name }`);
        }

        await this.reservesApiModel.updateReserves();
    }

    /**
     * overlap を解除
     * @return Promise<void>
     */
    public async disableOverlap(): Promise<void> {
        if (this.reserve === null) { return; }

        try {
            await this.reservesApiModel.disableOverlap(this.reserve.program.id);
            this.snackbar.open(`解除: ${ this.reserve.program.name }`);
        } catch (err) {
            console.error(err);
            this.snackbar.open(`解除失敗: ${ this.reserve.program.name }`);
        }
    }
}

namespace ReservesMenuViewModel {
    export const id = 'reserve-menu';
    export const deleteId = 'reserve-delete';
}

export default ReservesMenuViewModel;

