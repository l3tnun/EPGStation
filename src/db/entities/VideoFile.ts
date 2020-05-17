import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import Recorded from './Recorded';

@Entity()
export default class VideoFile extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'integer',
    })
    public parentDirectoryName!: string;

    @Column()
    public filePath!: string;

    @Column()
    public isTs!: boolean;

    @Column()
    public name!: string;

    @Column({
        type: 'bigint',
        default: 0,
    })
    public size: number = 0;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.videoFiles)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
