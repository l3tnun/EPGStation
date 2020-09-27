import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1601186196169 implements MigrationInterface {
    public name = 'Init1601186196169';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE `channel` (`id` bigint NOT NULL, `serviceId` int NOT NULL, `networkId` int NOT NULL, `name` text NOT NULL, `halfWidthName` text NOT NULL, `remoteControlKeyId` int NULL, `hasLogoData` tinyint NOT NULL DEFAULT 0, `channelTypeId` int NOT NULL, `channelType` varchar(255) NOT NULL, `channel` varchar(255) NOT NULL, `type` int NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `drop_log_file` (`id` int NOT NULL AUTO_INCREMENT, `errorCnt` bigint NOT NULL, `dropCnt` bigint NOT NULL, `scramblingCnt` bigint NOT NULL, `filePath` text NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `program` (`id` bigint NOT NULL, `updateTime` bigint NOT NULL, `channelId` bigint NOT NULL, `eventId` bigint NOT NULL, `serviceId` int NOT NULL, `networkId` int NOT NULL, `startAt` bigint NOT NULL, `endAt` bigint NOT NULL, `startHour` int NOT NULL, `week` int NOT NULL, `duration` int NOT NULL, `isFree` tinyint NOT NULL, `name` text NOT NULL, `halfWidthName` text NOT NULL, `shortName` text NOT NULL, `description` text NULL, `halfWidthDescription` text NULL, `extended` text NULL, `halfWidthExtended` text NULL, `genre1` int NULL, `subGenre1` int NULL, `genre2` int NULL, `subGenre2` int NULL, `genre3` int NULL, `subGenre3` int NULL, `channelType` varchar(255) NOT NULL, `channel` varchar(255) NOT NULL, `videoType` text NULL, `videoResolution` text NULL, `videoStreamContent` int NULL, `videoComponentType` int NULL, `audioSamplingRate` int NULL, `audioComponentType` int NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `recorded_tag` (`id` int NOT NULL AUTO_INCREMENT, `name` text NOT NULL, `halfWidthName` text NOT NULL, `color` varchar(255) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `thumbnail` (`id` int NOT NULL AUTO_INCREMENT, `filePath` text NOT NULL, `recordedId` int NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `video_file` (`id` int NOT NULL AUTO_INCREMENT, `parentDirectoryName` text NOT NULL, `filePath` text NOT NULL, `type` text NOT NULL, `name` text NOT NULL, `size` bigint NOT NULL DEFAULT 0, `recordedId` int NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `recorded` (`id` int NOT NULL AUTO_INCREMENT, `reserveId` int NULL, `ruleId` int NULL, `programId` bigint NULL, `channelId` bigint NOT NULL, `isProtected` tinyint NOT NULL DEFAULT 0, `startAt` bigint NOT NULL, `endAt` bigint NOT NULL, `duration` int NOT NULL, `name` text NOT NULL, `halfWidthName` text NOT NULL, `description` text NULL, `halfWidthDescription` text NULL, `extended` text NULL, `halfWidthExtended` text NULL, `genre1` int NULL, `subGenre1` int NULL, `genre2` int NULL, `subGenre2` int NULL, `genre3` int NULL, `subGenre3` int NULL, `videoType` text NULL, `videoResolution` text NULL, `videoStreamContent` int NULL, `videoComponentType` int NULL, `audioSamplingRate` int NULL, `audioComponentType` int NULL, `isRecording` tinyint NOT NULL, `dropLogFileId` int NULL, UNIQUE INDEX `REL_e0bc5373673ea0f120445830f4` (`dropLogFileId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `recorded_history` (`id` int NOT NULL AUTO_INCREMENT, `name` text NOT NULL, `channelId` bigint NOT NULL, `endAt` bigint NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `reserve` (`id` int NOT NULL AUTO_INCREMENT, `updateTime` bigint NOT NULL, `ruleId` int NULL, `ruleUpdateCnt` int NULL, `isSkip` tinyint NOT NULL DEFAULT 0, `isConflict` tinyint NOT NULL DEFAULT 0, `allowEndLack` tinyint NOT NULL DEFAULT 0, `tags` text NULL, `isOverlap` tinyint NOT NULL DEFAULT 0, `isIgnoreOverlap` tinyint NOT NULL DEFAULT 0, `isTimeSpecified` tinyint NOT NULL DEFAULT 0, `parentDirectoryName` text NULL, `directory` text NULL, `recordedFormat` text NULL, `encodeMode1` text NULL, `encodeParentDirectoryName1` text NULL, `encodeDirectory1` text NULL, `encodeMode2` text NULL, `encodeParentDirectoryName2` text NULL, `encodeDirectory2` text NULL, `encodeMode3` text NULL, `encodeParentDirectoryName3` text NULL, `encodeDirectory3` text NULL, `isDeleteOriginalAfterEncode` tinyint NOT NULL DEFAULT 0, `programId` bigint NULL, `programUpdateTime` bigint NULL, `channelId` bigint NOT NULL, `channel` text NOT NULL, `channelType` text NOT NULL, `startAt` bigint NOT NULL, `endAt` bigint NOT NULL, `name` text NULL, `halfWidthName` text NULL, `shortName` text NULL, `description` text NULL, `halfWidthDescription` text NULL, `extended` text NULL, `halfWidthExtended` text NULL, `genre1` int NULL, `subGenre1` int NULL, `genre2` int NULL, `subGenre2` int NULL, `genre3` int NULL, `subGenre3` int NULL, `videoType` text NULL, `videoResolution` text NULL, `videoStreamContent` int NULL, `videoComponentType` int NULL, `audioSamplingRate` int NULL, `audioComponentType` int NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `rule` (`id` int NOT NULL AUTO_INCREMENT, `updateCnt` int NOT NULL DEFAULT 0, `isTimeSpecification` tinyint NOT NULL DEFAULT 0, `keyword` text NULL, `halfWidthKeyword` text NULL, `ignoreKeyword` text NULL, `halfWidthIgnoreKeyword` text NULL, `keyCS` tinyint NOT NULL DEFAULT 0, `keyRegExp` tinyint NOT NULL DEFAULT 0, `name` tinyint NOT NULL DEFAULT 0, `description` tinyint NOT NULL DEFAULT 0, `extended` tinyint NOT NULL DEFAULT 0, `ignoreKeyCS` tinyint NOT NULL DEFAULT 0, `ignoreKeyRegExp` tinyint NOT NULL DEFAULT 0, `ignoreName` tinyint NOT NULL DEFAULT 0, `ignoreDescription` tinyint NOT NULL DEFAULT 0, `ignoreExtended` tinyint NOT NULL DEFAULT 0, `GR` tinyint NOT NULL DEFAULT 0, `BS` tinyint NOT NULL DEFAULT 0, `CS` tinyint NOT NULL DEFAULT 0, `SKY` tinyint NOT NULL DEFAULT 0, `channelIds` text NULL, `genres` text NULL, `times` text NULL, `isFree` tinyint NOT NULL DEFAULT 0, `durationMin` int NULL, `durationMax` int NULL, `searchPeriods` text NULL, `enable` tinyint NOT NULL DEFAULT 0, `avoidDuplicate` tinyint NOT NULL DEFAULT 0, `periodToAvoidDuplicate` int NULL, `allowEndLack` tinyint NOT NULL DEFAULT 1, `tags` text NULL, `parentDirectoryName` text NULL, `directory` text NULL, `recordedFormat` text NULL, `mode1` text NULL, `parentDirectoryName1` text NULL, `directory1` text NULL, `mode2` text NULL, `parentDirectoryName2` text NULL, `directory2` text NULL, `mode3` text NULL, `parentDirectoryName3` text NULL, `directory3` text NULL, `isDeleteOriginalAfterEncode` tinyint NOT NULL DEFAULT 0, PRIMARY KEY (`id`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'CREATE TABLE `recorded_tags_recorded_tag` (`recordedId` int NOT NULL, `recordedTagId` int NOT NULL, INDEX `IDX_4bf93992f2a6020b74bbf80cf4` (`recordedId`), INDEX `IDX_c5315b388628971c92d241be9c` (`recordedTagId`), PRIMARY KEY (`recordedId`, `recordedTagId`)) ENGINE=InnoDB',
        );
        await queryRunner.query(
            'ALTER TABLE `thumbnail` ADD CONSTRAINT `FK_f3e8be49269b5878c0f07ee0198` FOREIGN KEY (`recordedId`) REFERENCES `recorded`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE `video_file` ADD CONSTRAINT `FK_8407bb2c2e9d927e8c1c694c6a8` FOREIGN KEY (`recordedId`) REFERENCES `recorded`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE `recorded` ADD CONSTRAINT `FK_e0bc5373673ea0f120445830f4d` FOREIGN KEY (`dropLogFileId`) REFERENCES `drop_log_file`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE `recorded_tags_recorded_tag` ADD CONSTRAINT `FK_4bf93992f2a6020b74bbf80cf4c` FOREIGN KEY (`recordedId`) REFERENCES `recorded`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE `recorded_tags_recorded_tag` ADD CONSTRAINT `FK_c5315b388628971c92d241be9c8` FOREIGN KEY (`recordedTagId`) REFERENCES `recorded_tag`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE `recorded_tags_recorded_tag` DROP FOREIGN KEY `FK_c5315b388628971c92d241be9c8`',
        );
        await queryRunner.query(
            'ALTER TABLE `recorded_tags_recorded_tag` DROP FOREIGN KEY `FK_4bf93992f2a6020b74bbf80cf4c`',
        );
        await queryRunner.query('ALTER TABLE `recorded` DROP FOREIGN KEY `FK_e0bc5373673ea0f120445830f4d`');
        await queryRunner.query('ALTER TABLE `video_file` DROP FOREIGN KEY `FK_8407bb2c2e9d927e8c1c694c6a8`');
        await queryRunner.query('ALTER TABLE `thumbnail` DROP FOREIGN KEY `FK_f3e8be49269b5878c0f07ee0198`');
        await queryRunner.query('DROP INDEX `IDX_c5315b388628971c92d241be9c` ON `recorded_tags_recorded_tag`');
        await queryRunner.query('DROP INDEX `IDX_4bf93992f2a6020b74bbf80cf4` ON `recorded_tags_recorded_tag`');
        await queryRunner.query('DROP TABLE `recorded_tags_recorded_tag`');
        await queryRunner.query('DROP TABLE `rule`');
        await queryRunner.query('DROP TABLE `reserve`');
        await queryRunner.query('DROP TABLE `recorded_history`');
        await queryRunner.query('DROP INDEX `REL_e0bc5373673ea0f120445830f4` ON `recorded`');
        await queryRunner.query('DROP TABLE `recorded`');
        await queryRunner.query('DROP TABLE `video_file`');
        await queryRunner.query('DROP TABLE `thumbnail`');
        await queryRunner.query('DROP TABLE `recorded_tag`');
        await queryRunner.query('DROP TABLE `program`');
        await queryRunner.query('DROP TABLE `drop_log_file`');
        await queryRunner.query('DROP TABLE `channel`');
    }
}
