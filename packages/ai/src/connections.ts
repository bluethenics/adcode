export interface ConnectionProfile {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly rpm: number;
}
export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
export function parseConnections(raw: unknown): ConnectionProfile[] {
  const values: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(values) || values.length > 100)
    throw new Error("Connections must be a list of at most 100 profiles.");
  const ids = new Set<string>();
  return values.map((value: unknown) => {
    if (typeof value !== "object" || value === null)
      throw new Error("Invalid connection.");
    const v = value as Record<string, unknown>;
    if (
      typeof v["id"] !== "string" ||
      !/^connection-[a-zA-Z0-9-]{1,80}$/.test(v["id"]) ||
      ids.has(v["id"])
    )
      throw new Error("Connection IDs must be unique.");
    ids.add(v["id"]);
    if (
      typeof v["name"] !== "string" ||
      !v["name"].trim() ||
      v["name"].length > 100
    )
      throw new Error("Enter a connection name (up to 100 characters).");
    if (
      typeof v["model"] !== "string" ||
      !v["model"].trim() ||
      v["model"].length > 200
    )
      throw new Error("Enter a model ID (up to 200 characters).");
    if (
      typeof v["rpm"] !== "number" ||
      !Number.isInteger(v["rpm"]) ||
      v["rpm"] < 1 ||
      v["rpm"] > 6000
    )
      throw new Error("RPM must be a whole number from 1 to 6000.");
    if (typeof v["baseUrl"] !== "string" || v["baseUrl"].length > 400)
      throw new Error("Enter an endpoint URL.");
    const url = new URL(v["baseUrl"]);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error(
        "Use HTTPS, or HTTP on localhost, without credentials, query or fragment.",
      );
    return {
      id: v["id"],
      name: v["name"].trim(),
      model: v["model"].trim(),
      rpm: v["rpm"],
      baseUrl: url.href.replace(/\/+$/, ""),
    };
  });
}
