import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import Recorded from './Recorded';

@Entity()
export default class Thumbnail extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.thumbnails)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
