/**
 * Files a text search never opens, decided by name alone.
 *
 * Telling binary from text otherwise means reading the file - all of it, since the NUL
 * check runs on what was read. For a format that is never text that read is pure cost, and
 * in a project with a few hundred screenshots it was most of the cost: on ADCode's own
 * repository 538 PNGs (37 MB) against 7 MB of TypeScript, read by every search, Go to Symbol
 * and universal search, and by the assistant's search tool. Listing is unaffected - Go to
 * File still opens an image by name.
 *
 * One list for every reader of the workspace, so the editor and the assistant cannot
 * disagree about what is searchable. Only formats that are never text: `.svg` is XML people
 * search, `.key` is often a PEM key, `.obj` is often a text 3D model - anything ambiguous
 * stays out and is left to the NUL check.
 *
 * No Electron, no DOM and no `node:fs`.
 */
const NEVER_TEXT: ReadonlySet<string> = new Set([
  // Images
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "tif", "tiff", "psd", "heic",
  // Video and audio
  "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mp3", "wav", "ogg", "oga", "flac", "aac", "m4a", "opus",
  // Archives and packages
  "zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "jar", "war", "apk", "aab", "ipa", "vsix", "nupkg", "crx",
  "msi", "msix", "appx", "dmg", "deb", "rpm", "appimage",
  // Fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // Compiled code and native binaries
  "exe", "dll", "so", "dylib", "node", "wasm", "class", "pyc", "pdb", "lib",
  // Documents and databases that are containers, not text
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "sqlite", "sqlite3",
  // 3D and GPU assets
  "glb", "fbx", "blend", "ktx", "ktx2", "dds",
]);

/** True for a path whose extension is a format that is never text. `/`-separated or not. */
export function isBinaryByName(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return NEVER_TEXT.has(name.slice(dot + 1).toLowerCase());
}
