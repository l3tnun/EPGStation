/**
 * Loader hooks that let a caller replace what the compiled entrypoint imports.
 *
 * The compiled output is ES modules. Their imports never reach the CommonJS loader, so the older
 * `--require` prelude that patched `Module._load` no longer sees them. Node's own mechanism for this
 * is a set of loader hooks, which this file provides via `registerHooks` (synchronous, same-thread
 * hooks -- Node deprecated the older `module.register()`, which ran the hook module in a separate
 * realm and required a module specifier plus a `data` payload to reach it). A caller -- a same-process
 * TypeScript module, or a spawned child's `--import` prelude -- imports this file directly and calls
 * `registerOverrides(entries)` with the replacements it wants, instead of registering a URL.
 *
 * A replacement is a module source, not an object, because it is evaluated inside the caller's module
 * graph rather than inside this file. Callers therefore put what they want to expose on `globalThis`
 * and have the replacement read it back.
 *
 * `parentURL` narrows a replacement to imports made by one module. Without it a relative specifier
 * such as `./model/ModelContainer.js` would also answer for any other module importing that same
 * text. Everything not named here falls through to the real resolution.
 *
 * `registerOverrides` may be called more than once (from more than one same-process caller); each
 * call adds its entries to the shared list, and the hooks themselves are registered only once per
 * process (a second `registerHooks` call would stack a redundant, no-op layer).
 */
import { registerHooks } from 'node:module';

const SCHEME = 'epgstation-override:';

let replacements = [];
let hooksRegistered = false;

function find(specifier, parentURL) {
    return replacements.find(
        entry => entry.specifier === specifier && (entry.parentURL === undefined || entry.parentURL === parentURL),
    );
}

function resolve(specifier, context, nextResolve) {
    const entry = find(specifier, context.parentURL);
    if (entry !== undefined) {
        return {
            url: `${SCHEME}${encodeURIComponent(specifier)}?parent=${encodeURIComponent(context.parentURL ?? '')}`,
            shortCircuit: true,
        };
    }
    return nextResolve(specifier, context);
}

function load(url, context, nextLoad) {
    if (url.startsWith(SCHEME)) {
        const [head, query] = url.slice(SCHEME.length).split('?parent=');
        const entry = find(decodeURIComponent(head), decodeURIComponent(query ?? ''));
        if (entry === undefined) {
            throw new Error(`no replacement for ${url}`);
        }
        return { format: 'module', shortCircuit: true, source: entry.source };
    }
    return nextLoad(url, context);
}

/**
 * Registers `entries` (each `{ specifier, source }`, optionally `parentURL`) as module replacements.
 * Safe to call more than once: entries accumulate, and the underlying `registerHooks` call happens
 * only the first time.
 */
export function registerOverrides(entries) {
    replacements = [...replacements, ...entries];
    if (!hooksRegistered) {
        hooksRegistered = true;
        registerHooks({ resolve, load });
    }
}
