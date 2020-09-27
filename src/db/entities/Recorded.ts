import {
    BaseEntity,
    Column,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import DropLogFile from './DropLogFile';
import RecordedTag from './RecordedTag';
import Thumbnail from './Thumbnail';
import VideoFile from './VideoFile';

@Entity()
export default class Recorded extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public reserveId!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public ruleId?: number | null;

    @Column({
        type: 'bigint',
        nullable: true,
    })
    public programId!: number | null;

    @Column({
        type: 'bigint',
    })
    public channelId!: number;

    @Column({
        default: false,
    })
    public isProtected!: boolean;

    @Column({
        type: 'bigint',
    })
    public startAt!: number;

    @Column({
        type: 'bigint',
    })
    public endAt!: number;

    @Column({
        type: 'integer',
    })
    public duration!: number;

    @Column({
        type: 'text',
    })
    public name!: string; // 番組名 (表示用)

    @Column({
        type: 'text',
    })
    public halfWidthName!: string; // 番組名 (検索用)

    @Column({
        type: 'text',
        nullable: true,
    })
    public description?: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthDescription?: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public extended?: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthExtended?: string | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre1?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre1?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre2?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre2?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre3?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre3?: number | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoType?: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoResolution?: string | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoStreamContent?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoComponentType?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioSamplingRate?: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioComponentType?: number | null;

    @Column()
    public isRecording!: boolean;

    @OneToMany(() => VideoFile, videoFile => videoFile.recorded)
    public videoFiles?: VideoFile[];

    @OneToMany(() => Thumbnail, thumbnail => thumbnail.recorded)
    public thumbnails?: Thumbnail[];

    @Column({
        type: 'integer',
        nullable: true,
    })
    public dropLogFileId!: number | null;

    @OneToOne(() => DropLogFile, dropLogFile => dropLogFile.id)
    @JoinColumn({
        name: 'dropLogFileId',
        referencedColumnName: 'id',
    })
    public dropLogFile?: DropLogFile | null;

    @ManyToMany(() => RecordedTag)
    @JoinTable()
    public tags!: RecordedTag[];
}
