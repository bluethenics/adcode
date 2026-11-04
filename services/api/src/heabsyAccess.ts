/** The authenticated gateway list describes this account's access, unlike the public catalogue. */
export async function heabsyAccess(key: string, fetchImpl: typeof fetch): Promise<string[] | null> {
  if (!key) return null;
  try {
    const response = await fetchImpl("https://api.heabsy.com/v1/models", { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 1_000_000) return null;
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== "object" || !("data" in raw) || !Array.isArray(raw.data) || raw.data.length > 1000) return null;
    const ids = raw.data.flatMap((row: unknown) => row && typeof row === "object" && "id" in row && typeof row.id === "string" && /^[^\s\u0000-\u001f]{1,200}$/.test(row.id) ? [row.id] : []);
    return ids.length ? [...new Set(ids)].sort() : null;
  } catch { return null; }
}
