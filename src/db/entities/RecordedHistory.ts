import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export default class RecordedHistory extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public name!: string; // 番組名 Program.shortName と比較する

    @Column({
        type: 'bigint',
    })
    public channelId!: number; // channel id

    @Column({
        type: 'bigint',
    })
    public endAt!: number; // 終了時刻
}
