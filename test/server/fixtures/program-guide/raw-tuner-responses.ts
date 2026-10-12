/**
 * 番組情報の更新の test が、tuner server（Mirakurun・mirakc）の応答の代わりに使う合成の service と番組。
 * 本物の server が公開する schema との一致は `tuner-access/real-tuner-server.integration.test.ts` が確かめる。
 */
export const rawService = () => ({
    id: 1,
    serviceId: 101,
    networkId: 10,
    name: 'synthetic-service',
    type: 1,
    hasLogoData: true,
    channel: { type: 'GR', channel: '1' },
});
export const rawProgram = (product: 'mirakurun' | 'mirakc', id: number = 11) => ({
    id,
    eventId: id,
    serviceId: 101,
    networkId: 10,
    startAt: 1_000,
    duration: 60_000,
    isFree: true,
    name: 'synthetic-program',
    extended:
        product === 'mirakurun'
            ? { heading: 'synthetic-extended' }
            : [{ description: 'heading', text: 'synthetic-extended' }],
    ...(product === 'mirakurun'
        ? { audio: { componentType: 3, isMain: true, samplingRate: 48_000, langs: ['jpn'] } }
        : { audios: [{ componentType: 3, isMain: true, samplingRate: 48_000, langs: ['jpn'] }] }),
    series: {
        id: 1,
        repeat: 0,
        pattern: 0,
        ...(product === 'mirakurun' ? { expiresAt: 9_000 } : { expireAt: 9_000 }),
        episode: 1,
        lastEpisode: 2,
        name: 'synthetic-series',
    },
});
