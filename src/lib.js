import { argv } from "process";
import { fileURLToPath } from "url";

/**
 * Check if a module is the main module launched with the node process.
 * Meaning the module is NOT imported by another module,
 * but was directly invoked by `node`, like this: `$ node main.js`
 * https://stackoverflow.com/a/63193714
 *
 * @example
 * ```js
 * // main.js
 * import lib from "./lib.js"
 * import { isMain } from "./utils.js"
 *
 * if (isMain(import.meta.url)) {
 *   console.log("I print to stdout")
 * }
 *
 * // lib.js
 * import { isMain } from "./utils"
 *
 * if (isMain(import.meta.url)) {
 *   console.log("I don't run, because I'm an imported module")
 * }
 * ```
 *
 * @param {string} moduleUrl needs to be `import.meta.url`
 * @returns {boolean} true if the module is the main module
 */
export function isMain(moduleUrl) {
    const modulePath = fileURLToPath(moduleUrl);
    const [_binPath, mainScriptPath] = argv;
    return modulePath === mainScriptPath;
}

/**
 * Returns a promise and functions to resolve and reject it.
 * Example for returning a promise that resolves when a websocket opens:
 * ```
 * function openWebSocket() {
 *   const { promise, resolve, reject } = createPromiseHandlers();
 *   websocket.on('open', () => resolve());
 *   websocket.on('error', (e) => reject(e))
 *   return promise;
 * }
 * ```
 */
export function createPromiseHandlers() {
    let resolve, reject;
    // lift resolve, reject out of promise scope
    const promise = new Promise((resolve_, reject_) => {
        resolve = resolve_;
        reject = reject_;
    });
    return {
        promise,
        resolve,
        reject,
    };
}

export function swapKV(dict) {
    return Object.keys(dict).reduce((ret, key) => {
        ret[dict[key]] = key;
        return ret;
    }, {});
}
