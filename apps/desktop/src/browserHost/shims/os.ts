/** `node:os` for the browser host: a fixed home, and no machine details to report. */
export const homedir = (): string => "/home/adcode";
export const tmpdir = (): string => "/tmp";
export const hostname = (): string => "browser";
export const arch = (): string => "wasm";
export const platform = (): string => "linux";
export const type = (): string => "Browser";
export const release = (): string => "";
export const cpus = (): { model: string }[] => [{ model: "browser" }];
export const totalmem = (): number => 0;
export const freemem = (): number => 0;
export const networkInterfaces = (): Record<string, never[]> => ({});
export const userInfo = () => ({ username: "adcode", uid: 1000, gid: 1000, shell: null, homedir: homedir() });
export const EOL = "\n";
export default { homedir, tmpdir, hostname, arch, platform, type, release, cpus, totalmem, freemem, networkInterfaces, userInfo, EOL };
