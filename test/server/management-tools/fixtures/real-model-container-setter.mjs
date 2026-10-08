// Test-only stand-in for the compiled `model/ModelContainerSetter.js` dependency seam. Copied over
// a real compiled-snapshot copy (never over `src/` or the shared build cache) so that importing the
// real `dist/DBTools.js` file resolves its own `./model/ModelContainerSetter.js` import to this real
// file on disk, instead of evaluating `DBTools.js` source text through `Function`/`eval`.
//
// The compiled snapshot is ES modules; this uses `export const` rather than CommonJS `exports.set =`
// (see `real-model-container.mjs` for why a CJS-shaped `.js` file breaks the static import).
export const set = () => {
    process.stdout.write('container:set\n');
};
