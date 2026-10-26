export interface UpdateManifestFile {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
}
export interface UpdateManifest {
  readonly version: string;
  readonly files: readonly UpdateManifestFile[];
}

/** The scalar/files subset electron-builder emits; unsupported or empty metadata fails closed. */
export function parseUpdateManifest(text: string): UpdateManifest {
  const scalar = (value: string): string => {
    const raw = value.trim();
    if (raw.startsWith('"')) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "string") throw new Error("Expected a manifest string.");
      return parsed;
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
    if (!raw || /[\r\n#]/.test(raw)) throw new Error("Invalid manifest scalar.");
    return raw;
  };
  let version: string | null = null, inFiles = false, sawFiles = false;
  const entries: Record<string, string>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.includes("\t")) throw new Error("Tabs are not supported in update manifests.");
    const header = /^version:\s*(.+)$/.exec(line);
    if (header) { if (version !== null) throw new Error("Duplicate manifest version."); version = scalar(header[1]!); inFiles = false; continue; }
    if (/^files:\s*$/.test(line)) { if (sawFiles) throw new Error("Duplicate files section."); sawFiles = inFiles = true; continue; }
    if (/^(?:version|files):/.test(line)) throw new Error("Unsupported manifest version or files value.");
    if (/^\S/.test(line)) { inFiles = false; continue; }
    if (!inFiles) continue;
    const item = /^  - url:\s*(.+)$/.exec(line);
    if (item) { entries.push({ url: scalar(item[1]!) }); continue; }
    const field = /^    (sha512|size|blockMapSize|isAdminRightsRequired):\s*(.+)$/.exec(line);
    if (field) {
      const current = entries.at(-1);
      if (!current || current[field[1]!] !== undefined) throw new Error("Invalid or duplicate manifest file field.");
      current[field[1]!] = scalar(field[2]!);
      continue;
    }
    throw new Error("Unsupported manifest file field or indentation.");
  }
  if (!version || !sawFiles || entries.length === 0) throw new Error("Update manifest needs version and files.");
  const files = entries.map(entry => {
    const { url, sha512, size: rawSize } = entry;
    if (!url || !sha512 || !rawSize || !/^\d+$/.test(rawSize)) throw new Error("Update file needs url, sha512 and size.");
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Invalid update file size.");
    if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512)) throw new Error("Update checksum must be base64 SHA-512.");
    if (entry["blockMapSize"] !== undefined && (!/^\d+$/.test(entry["blockMapSize"]) || !Number.isSafeInteger(Number(entry["blockMapSize"])) || Number(entry["blockMapSize"]) <= 0 || Number(entry["blockMapSize"]) >= size)) throw new Error("Invalid embedded blockmap size.");
    if (entry["isAdminRightsRequired"] !== undefined && !/^(true|false)$/.test(entry["isAdminRightsRequired"])) throw new Error("Invalid update administrator flag.");
    return { url, sha512, size };
  });
  if (new Set(files.map(file => file.url)).size !== files.length) throw new Error("Duplicate update file URL.");
  return { version, files };
}
