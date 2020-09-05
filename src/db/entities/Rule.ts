import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ルール
 */
@Entity()
export default class Rule extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'integer',
        default: 0,
    })
    public updateCnt: number = 0; // 更新時にカウントする 予約情報比較時に使用する

    /**
     * 時刻指定予約か
     */
    @Column({
        default: false,
    })
    public isTimeSpecification: boolean = false;

    /**
     * 検索設定
     */
    @Column({
        type: 'text',
        nullable: true,
    })
    public keyword: string | null = null; // 検索キーワード

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthKeyword: string | null = null; // 検索キーワード (検索用)

    @Column({
        type: 'text',
        nullable: true,
    })
    public ignoreKeyword: string | null = null; // 除外検索キーワード

    @Column({
        type: 'text',
        nullable: true,
    })
    public halfWidthIgnoreKeyword: string | null = null; // 除外検索キーワード (検索用)

    @Column({
        default: false,
    })
    public keyCS: boolean = false; // 大文字小文字区別有効化 (検索キーワード)

    @Column({
        default: false,
    })
    public keyRegExp: boolean = false; // 正規表現 (検索キーワード)

    @Column({
        default: false,
    })
    public name: boolean = false; // 番組名 (検索キーワード)

    @Column({
        default: false,
    })
    public description: boolean = false; // 概要 (検索キーワード)

    @Column({
        default: false,
    })
    public extended: boolean = false; // 詳細 (検索キーワード)

    @Column({
        default: false,
    })
    public ignoreKeyCS: boolean = false; // 大文字小文字区別有効化 (除外検索キーワード)

    @Column({
        default: false,
    })
    public ignoreKeyRegExp: boolean = false; // 正規表現 (除外検索キーワード)

    @Column({
        default: false,
    })
    public ignoreName: boolean = false; // 番組名 (除外検索キーワード)

    @Column({
        default: false,
    })
    public ignoreDescription: boolean = false; // 概要 (除外検索キーワード)

    @Column({
        default: false,
    })
    public ignoreExtended: boolean = false; // 詳細 (除外検索キーワード)

    @Column({
        default: false,
    })
    public GR: boolean = false; // GR

    @Column({
        default: false,
    })
    public BS: boolean = false; // BS

    @Column({
        default: false,
    })
    public CS: boolean = false; // CS

    @Column({
        default: false,
    })
    public SKY: boolean = false; // SKY

    @Column({
        type: 'text',
        nullable: true,
    })
    public channelIds: string | null = null; // channleId の array を JSON.stringify したもの

    @Column({
        type: 'text',
        nullable: true,
    })
    public genres: string | null = null; // { genre: number, subGenre: number  | null } の array を JSON.stringify したもの

    @Column({
        type: 'text',
        nullable: true,
    })
    public times: string | null = null; // 時刻範囲 { start: number, range: number, week: number } の array を JSON.stringify したもの

    @Column({
        default: false,
    })
    public isFree: boolean = false; // 無料放送か

    @Column({
        type: 'integer',
        nullable: true,
    })
    public durationMin: number | null = null; // 番組最小時間

    @Column({
        type: 'integer',
        nullable: true,
    })
    public durationMax: number | null = null; // 番組最大時間

    @Column({
        type: 'text',
        nullable: true,
    })
    public searchPeriods: string | null = null; // 検索期間 { startAt: UnixtimeMS, endAt: UnixtimeMS } の array を JSON.stringify したもの

    /**
     * 予約オプション
     */
    @Column({
        default: false,
    })
    public enable: boolean = false; // ルールが有効か

    @Column({
        default: false,
    })
    public avoidDuplicate: boolean = false; // 録画済みの重複番組を排除するか

    @Column({
        type: 'integer',
        nullable: true,
    })
    public periodToAvoidDuplicate: number | null = null; // 重複を避ける期間

    @Column({
        default: true,
    })
    public allowEndLack: boolean = true; // 末尾切れを許可するか

    @Column({
        type: 'text',
        nullable: true,
    })
    public tags: string | null = null;

    /**
     * 保存設定
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
    public directory: string | null = null; // TS 保存先ディレクトリ

    @Column({
        type: 'text',
        nullable: true,
    })
    public recordedFormat: string | null = null; // TS 名前フォーマット

    /**
     * エンコード設定
     */
    @Column({
        type: 'text',
        nullable: true,
    })
    public mode1: string | null = null; // エンコードモード1

    @Column({
        type: 'text',
        nullable: true,
    })
    public parentDirectoryName1: string | null = null; // エンコード親ディレクトリ1

    @Column({
        type: 'text',
        nullable: true,
    })
    public directory1: string | null = null; // エンコードディレクトリ1

    @Column({
        type: 'text',
        nullable: true,
    })
    public mode2: string | null = null; // エンコードモード2

    @Column({
        type: 'text',
        nullable: true,
    })
    public parentDirectoryName2: string | null = null; // エンコード親ディレクトリ2

    @Column({
        type: 'text',
        nullable: true,
    })
    public directory2: string | null = null; // エンコードディレクトリ2

    @Column({
        type: 'text',
        nullable: true,
    })
    public mode3: string | null = null; // エンコードモード1

    @Column({
        type: 'text',
        nullable: true,
    })
    public parentDirectoryName3: string | null = null; // エンコード親ディレクトリ3

    @Column({
        type: 'text',
        nullable: true,
    })
    public directory3: string | null = null; // エンコードディレクトリ1

    @Column({
        default: false,
    })
    public isDeleteOriginalAfterEncode: boolean = false;
}
