import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * エンコードの依頼の記録（table `encode_queue`）。識別番号は呼出し元が割り当て、DB では自動採番しない。
 * `option` は依頼内容の JSON 文字列のまま保存する。
 */
@Entity()
export default class EncodeQueue extends BaseEntity {
    @PrimaryColumn({
        type: 'bigint',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public option!: string;

    @Column({
        nullable: true,
        type: 'text',
    })
    public outputPath: string | null = null;

    @Column({
        type: 'bigint',
    })
    public createdAt!: number;
}
