import type { FileStore } from "../../../../packages/ads/src/types.ts";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** A `FileStore` whose keys are relative paths under one directory. */
export class DiskFileStore implements FileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  #path(key: string): string {
    return join(this.root, key);
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(key)));
    } catch {
      return null;
    }
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.#path(key));
    } catch {
      // Missing is already the requested state.
    }
  }
}
