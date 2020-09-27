import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export default class Program extends BaseEntity {
    @PrimaryColumn({
        type: 'bigint',
        unique: true,
    })
    public id!: number;

    @Column({
        type: 'bigint',
    })
    public updateTime!: number;

    @Column({
        type: 'bigint',
    })
    public channelId!: number;

    @Column({
        type: 'bigint',
    })
    public eventId!: number;

    @Column({
        type: 'integer',
    })
    public serviceId!: number;

    @Column({
        type: 'integer',
    })
    public networkId!: number;

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
        select: false,
    })
    public startHour!: number;

    @Column({
        type: 'integer',
        select: false,
    })
    public week!: number;

    @Column({
        type: 'integer',
    })
    public duration!: number;

    @Column()
    public isFree!: boolean;

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
    })
    public shortName!: string; // 番組名 (重複チェック用)

    @Column({
        type: 'text',
        nullable: true,
    })
    public description!: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthDescription!: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public extended!: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthExtended!: string | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre1!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre1!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre2!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre2!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre3!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre3!: number | null;

    @Column()
    public channelType!: string; // GR BS CS SKY

    @Column()
    public channel!: string;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoType!: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoResolution!: string | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoStreamContent!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoComponentType!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioSamplingRate!: number | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioComponentType!: number | null;
}
