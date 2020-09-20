import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelType1600609037159 implements MigrationInterface {
    public name = 'AddChannelType1600609037159';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "temporary_channel" ("id" bigint PRIMARY KEY NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "remoteControlKeyId" integer, "hasLogoData" boolean NOT NULL DEFAULT (0), "channelType" varchar NOT NULL, "channel" varchar NOT NULL, "type" integer)',
        );
        await queryRunner.query(
            'INSERT INTO "temporary_channel"("id", "serviceId", "networkId", "name", "halfWidthName", "remoteControlKeyId", "hasLogoData", "channelType", "channel") SELECT "id", "serviceId", "networkId", "name", "halfWidthName", "remoteControlKeyId", "hasLogoData", "channelType", "channel" FROM "channel"',
        );
        await queryRunner.query('DROP TABLE "channel"');
        await queryRunner.query('ALTER TABLE "temporary_channel" RENAME TO "channel"');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "channel" RENAME TO "temporary_channel"');
        await queryRunner.query(
            'CREATE TABLE "channel" ("id" bigint PRIMARY KEY NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "remoteControlKeyId" integer, "hasLogoData" boolean NOT NULL DEFAULT (0), "channelType" varchar NOT NULL, "channel" varchar NOT NULL)',
        );
        await queryRunner.query(
            'INSERT INTO "channel"("id", "serviceId", "networkId", "name", "halfWidthName", "remoteControlKeyId", "hasLogoData", "channelType", "channel") SELECT "id", "serviceId", "networkId", "name", "halfWidthName", "remoteControlKeyId", "hasLogoData", "channelType", "channel" FROM "temporary_channel"',
        );
        await queryRunner.query('DROP TABLE "temporary_channel"');
    }
}
