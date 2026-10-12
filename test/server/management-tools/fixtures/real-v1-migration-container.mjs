// Test-only stand-in for the compiled `model/ModelContainer.js` dependency seam. Copied over a real
// compiled-snapshot copy (never over `src/` or the shared build cache) so that importing the real
// `dist/V1MigrationTool.js` file resolves its own `./model/ModelContainer.js` import to this real
// file on disk, instead of evaluating `V1MigrationTool.js` source text through `Function`/`eval`.
// Every dependency V1MigrationTool's constructor and `run()` touch is stubbed here; anything
// unexpected throws loudly rather than silently returning `undefined`. Mirrors
// `real-model-container.mjs` (DBTools), with `IConfiguration`/insert-shaped DB seams instead of
// DBTools's `findAll`-shaped backup seams.
//
// The compiled snapshot is ES modules; this uses `export default` rather than CommonJS
// `exports.default =` (see `real-model-container.mjs` for why a CJS-shaped `.js` file breaks the
// static import).
const event = value => process.stdout.write(`${value}\n`);

const dependencies = {
    ILoggerModel: {
        initialize: () => event('logger:init'),
        getLogger: () => ({
            system: {
                error: value => event(`error:${String(value)}`),
                info: value => event(`log:${String(value)}`),
            },
        }),
    },
    IConfiguration: {
        getConfig: () => ({ recorded: [{ name: 'real-v1-migration-recorded-root' }], encode: [] }),
    },
    IConnectionCheckModel: { checkDB: async () => event('db:check') },
    IDBOperator: { closeConnection: async () => event('db:close') },
    IRuleDB: {
        insertOnce: async rule => {
            event(`insert:rule:${rule.searchOption.name ?? ''}`);
            return 111;
        },
    },
    IRecordedDB: {
        insertOnce: async recorded => {
            event(`insert:recorded:${recorded.name}`);
            return 222;
        },
    },
    IThumbnailDB: {
        insertOnce: async thumbnail => {
            event(`insert:thumbnail:${thumbnail.recordedId}`);
            return 333;
        },
    },
    IVideoFileDB: {
        insertOnce: async videoFile => {
            event(`insert:video-file:${videoFile.type}:${videoFile.recordedId}`);
            return 444;
        },
    },
    IRecordedHistoryDB: {
        insertOnce: async item => {
            event(`insert:recorded-history:${item.name}`);
            return 555;
        },
    },
};

const container = {
    get(name) {
        if (!Object.hasOwn(dependencies, name))
            throw new Error(`real-v1-migration-container.mjs: unstubbed dependency ${name}`);
        return dependencies[name];
    },
};

export default container;
