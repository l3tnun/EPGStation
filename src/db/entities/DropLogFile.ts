import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export default class DropLogFile extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'bigint',
    })
    public errorCnt!: number;

    @Column({
        type: 'bigint',
    })
    public dropCnt!: number;

    @Column({
        type: 'bigint',
    })
    public scramblingCnt!: number;

    @Column({
        type: 'text',
    })
    public filePath!: string;
}
