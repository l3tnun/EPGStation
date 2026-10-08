import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import Recorded from './Recorded.js';

/** 録画済み番組から生成されたサムネイル画像1件を表す永続化 entity。`recorded` は生成元の録画。 */
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
    public recorded?: Relation<Recorded>;
}
