// Test-only stand-in for the compiled `model/ModelContainer.js` dependency seam. Copied over a real
// compiled-snapshot copy (never over `src/` or the shared build cache) so that importing the real
// `dist/DBTools.js` file resolves its own `./model/ModelContainer.js` import to this real file on
// disk, instead of evaluating `DBTools.js` source text through `Function`/`eval`. Every dependency
// DBTools's constructor and `backup()` touch is stubbed here; anything unexpected throws loudly
// rather than silently returning `undefined`.
//
// The compiled snapshot is ES modules (`"type": "module"`); once copied to `model/ModelContainer.js`
// this file is loaded as a real ES module (Node's own module-syntax detection would otherwise treat
// CommonJS `exports.default = ...` source as CJS despite the `.js` extension, which then fails
// `DBTools.js`'s static `import container from './model/ModelContainer.js'` with "does not provide
// an export named 'default'"), so it uses `export default` rather than `exports.default =`.
const event = value => process.stdout.write(`${value}\n`);

const emptyCollection = name => ({
    findAll: async () => {
        event(`read:${name}`);
        return [[], 0];
    },
});

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
    IConnectionCheckModel: { checkDB: async () => event('db:check') },
    IDBOperator: { closeConnection: async () => event('db:close') },
    IDropLogFileDB: { findAll: async () => (event('read:drop-log'), []) },
    IRecordedDB: emptyCollection('recorded'),
    IRecordedHistoryDB: { findAll: async () => (event('read:recorded-history'), []) },
    IRecordedTagDB: emptyCollection('recorded-tag'),
    IReserveDB: emptyCollection('reserve'),
    IRuleDB: emptyCollection('rule'),
    IThumbnailDB: { findAll: async () => (event('read:thumbnail'), []) },
    IVideoFileDB: { findAll: async () => (event('read:video-file'), []) },
};

const container = {
    get(name) {
        if (!Object.hasOwn(dependencies, name)) throw new Error(`real-model-container.mjs: unstubbed dependency ${name}`);
        return dependencies[name];
    },
};

export default container;
