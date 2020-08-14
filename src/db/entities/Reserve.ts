import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export default class Reserve extends BaseEntity {
    /**
     * 予約情報
     */
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'bigint',
    })
    public updateTime!: number; // 更新時間 手動予約の優先度決定事項に使用する

    @Column({
        type: 'integer',
        nullable: true,
    })
    public ruleId: number | null = null; // ruleId null なら手動予約

    @Column({
        type: 'integer',
        nullable: true,
    })
    public ruleUpdateCnt: number | null = null; // Rule の updateCnt と比較するために使う

    @Column({
        default: false,
    })
    public isSkip: boolean = false; // 除外設定

    @Column({
        default: false,
    })
    public isConflict: boolean = false; // 競合しているか

    @Column({
        default: false,
    })
    public allowEndLack: boolean = false; // 末尾切れを許すか

    @Column({
        type: 'text',
        nullable: true,
    })
    public tags: string | null = null;

    @Column({
        default: false,
    })
    public isOverlap: boolean = false; // 重複しているか (rule予約だけ有効)

    @Column({
        default: false,
    })
    public isIgnoreOverlap: boolean = false; // ルールでの重複設定を無視するか

    @Column({
        default: false,
    })
    public isTimeSpecified: boolean = false; // 時刻指定予約か

    /**
     * 保存オプション
     */
    @Column({
        type: 'text',
        nullable: true,
    })
    public parentDirectoryName: string | null = null; // TS 保存先親ディレクトリ名

    @Column({
        type: 'text',
        nullable: true,
    })
    public directory: string | null = null; // TS 保存先

    @Column({
        type: 'text',
        nullable: true,
    })
    public recordedFormat: string | null = null; // TS ファイル名フォーマット

    /**
     * エンコード情報
     */
    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeMode1: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeParentDirectoryName1: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeDirectory1: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeMode2: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeParentDirectoryName2: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeDirectory2: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeMode3: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeParentDirectoryName3: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public encodeDirectory3: string | null = null;

    @Column({
        default: false,
    })
    public isDeleteOriginalAfterEncode: boolean = false;

    /**
     * 番組情報
     */
    @Column({
        type: 'bigint',
        nullable: true,
    })
    public programId: number | null = null;

    @Column({
        type: 'bigint',
        nullable: true,
    })
    public programUpdateTime: number | null = null;

    @Column({
        type: 'bigint',
    })
    public channelId!: number;

    @Column({
        type: 'text',
    })
    public channel!: string;

    @Column({
        type: 'text',
    })
    public channelType!: string; // GR BS CS SKY

    @Column({
        type: 'bigint',
    })
    public startAt!: number;

    @Column({
        type: 'bigint',
    })
    public endAt!: number;

    @Column({
        type: 'text',
        nullable: true,
    })
    public name!: string;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthName!: string; // 番組名 (検索用)

    @Column({
        type: 'text',
        nullable: true,
    })
    public shortName: string | null = null; // 番組名 (重複チェック用)

    @Column({
        type: 'text',
        nullable: true,
    })
    public description: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthDescription!: string | null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public extended: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthExtended!: string | null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre1: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre1: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre2: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre2: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre3: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre3: number | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoType: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public videoResolution: string | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoStreamContent: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoComponentType: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioSamplingRate: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioComponentType: number | null = null;
}
