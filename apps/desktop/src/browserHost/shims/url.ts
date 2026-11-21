export { fileURLToPath, pathToFileURL } from "./small.ts";
import { fileURLToPath, pathToFileURL } from "./small.ts";
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export default { fileURLToPath, pathToFileURL, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams };
