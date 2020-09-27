import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export default class Channel extends BaseEntity {
    @PrimaryColumn({
        type: 'bigint',
        unique: true,
    })
    public id!: number;

    @Column({
        type: 'integer',
    })
    public serviceId!: number;

    @Column({
        type: 'integer',
    })
    public networkId!: number;

    @Column({
        type: 'text',
    })
    public name!: string;

    @Column({
        type: 'text',
    })
    public halfWidthName!: string;

    @Column({
        nullable: true,
        type: 'integer',
    })
    public remoteControlKeyId: number | null = null;

    @Column({
        default: false,
    })
    public hasLogoData!: boolean;

    @Column({
        type: 'integer',
        nullable: false,
    })
    public channelTypeId!: number;

    @Column()
    public channelType!: string; // GR BS CS SKY

    @Column()
    public channel!: string;

    @Column({
        nullable: true,
        type: 'integer',
    })
    public type!: number;
}
