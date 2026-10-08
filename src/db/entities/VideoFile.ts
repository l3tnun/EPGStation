import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import Recorded from './Recorded.js';

/**
 * 録画済み番組の実体ファイル（元TSファイル、またはエンコード済みファイル。`type` で区別）
 * 1件を表す永続化 entity。`filePath` は `parentDirectoryName`（config.yml の保存先設定名）
 * 配下からの相対パス。`recorded` は元になった録画。
 */
@Entity()
export default class VideoFile extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public parentDirectoryName!: string;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column({
        type: 'text',
    })
    public type!: string; // apid.VideoFileType

    @Column({
        type: 'text',
    })
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
    public recorded?: Relation<Recorded>;
}
