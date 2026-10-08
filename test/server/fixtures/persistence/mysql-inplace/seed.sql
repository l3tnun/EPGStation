INSERT INTO `channel` (
  `id`, `serviceId`, `networkId`, `name`, `halfWidthName`, `remoteControlKeyId`,
  `hasLogoData`, `channelTypeId`, `channelType`, `channel`, `type`
) VALUES (
  3273601024, 1024, 32736, 'synthetic-gr-channel', 'synthetic-gr-channel', NULL,
  0, 1, 'GR', 'T1', NULL
);

INSERT INTO `program` (
  `id`, `updateTime`, `channelId`, `eventId`, `serviceId`, `networkId`,
  `startAt`, `endAt`, `startHour`, `week`, `duration`, `isFree`,
  `name`, `halfWidthName`, `shortName`, `channelType`, `channel`
) VALUES (
  327360102400001, 1700000000000, 3273601024, 1, 1024, 32736,
  1700000000000, 1700003600000, 12, 1, 3600000, 1,
  'synthetic-program', 'synthetic-program', 'synthetic-program', 'GR', 'T1'
);
