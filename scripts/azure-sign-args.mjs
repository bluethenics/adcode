/**
 * Azure Trusted Signing config for `npm run package`.
 *
 * electron-builder signs with Azure only when `win.azureSignOptions` is set, and setting
 * it with empty fields fails the build - so the identifiers below gate the config: all
 * four present means "sign with Azure", anything missing means "today's behaviour"
 * (CSC_LINK file signing, or unsigned with a warning). Nothing here is a secret; the
 * credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) travel in the
 * environment untouched and are read by the signing module itself.
 *
 * Pure (takes `env`, touches nothing) so the release workflow's assumptions stay tested.
 */
const FIELDS = [
  ["ADCODE_AZURE_ENDPOINT", "endpoint"],
  ["ADCODE_AZURE_ACCOUNT", "codeSigningAccountName"],
  ["ADCODE_AZURE_PROFILE", "certificateProfileName"],
  ["ADCODE_AZURE_PUBLISHER", "publisherName"],
];

/**
 * Extra electron-builder `-c` args enabling Azure Trusted Signing.
 *
 * Returns [] unless every identifier is a non-blank string. Whitespace-only counts as
 * missing: GitHub leaves an unset secret as an empty string, and an empty endpoint is
 * not a configuration, it is an accident waiting for a build log.
 */
export function azureSignArgs(env = process.env) {
  const values = FIELDS.map(([envName, key]) => [key, (env[envName] ?? "").trim()]);
  if (values.some(([, value]) => value.length === 0)) return [];
  return values.map(([key, value]) => `-c.win.azureSignOptions.${key}=${value}`);
}

/** True when the signing module has the credentials it will ask for. */
export function azureCredentialsPresent(env = process.env) {
  return ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"].every(
    (name) => (env[name] ?? "").trim().length > 0,
  );
}
