import * as Chart from 'chart.js';
import * as apid from '../../../../api';
import { StorageApiModelInterface } from '../../Model/Api/StorageApiModel';
import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import ViewModel from '../ViewModel';

/**
 * StorageViewModel
 */
class StorageViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private storage: StorageApiModelInterface;
    private chart: Chart | null = null;

    constructor(
        balloon: BalloonModelInterface,
        storage: StorageApiModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.storage = storage;
    }

    /**
     * init
     */
    public init(): void {
        this.storage.init();
        if (this.chart !== null) {
            try {
                this.chart.clear();
                this.chart.destroy();
            } catch (e) {
            }
        }
        this.storage.fetchStorage()
        .then(() => {
            setTimeout(() => { this.show(); }, 400);
        });
    }

    /**
     * get Storage info
     */
    public get(): apid.DiskStatus {
        return this.storage.getStorage();
    }

    /**
     * グラフを表示
     */
    public show(): void {
        const ctx = (<HTMLCanvasElement> document.getElementById(StorageViewModel.chartId))!.getContext('2d')!;
        this.chart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [this.get().free, this.get().used],
                    backgroundColor: [
                        '#EF3C79',
                        '#FBCBDB',
                    ],
                }],
            },
        });
    }

    /**
     * open
     */
    public open(): void {
        this.balloon.open(StorageViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }
}

namespace StorageViewModel {
    export const id = 'storage-id';
    export const chartId = 'storage-chart';
}

export default StorageViewModel;

