export { sleep as setTimeout } from "./small.ts";
import { sleep } from "./small.ts";
export const setImmediate = (value?: unknown): Promise<unknown> => sleep(0, value);
export default { setTimeout: sleep, setImmediate };
