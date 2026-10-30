/** Cache isolation only. Firebase authorization is independently verified by the server. */
export function sharedProjectAccountKey(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const uid: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
    return typeof uid === "string" && uid.length > 0 && uid.length <= 128 ? Buffer.from(uid).toString("hex") : null;
  } catch { return null; }
}
