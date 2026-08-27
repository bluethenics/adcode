import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encodedKey = process.env.PAYOUT_ENCRYPTION_KEY;

if (!url || !serviceRoleKey || !encodedKey) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and PAYOUT_ENCRYPTION_KEY are required");
}

const key = Buffer.from(encodedKey, "base64");
if (key.length !== 32) throw new Error("PAYOUT_ENCRYPTION_KEY must decode to exactly 32 bytes");

const db = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function destination(row) {
  let fields;
  if (typeof row.bank_details === "string" && row.bank_details.startsWith("{")) {
    try { fields = JSON.parse(row.bank_details); } catch { fields = undefined; }
  }
  return {
    method: "bank",
    legalName: row.legal_name,
    country: row.country,
    currency: row.currency,
    email: null,
    bankDetails: fields === undefined ? row.bank_details : null,
    ...(fields === undefined ? {} : { fields }),
  };
}

function encrypt(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const account = value.fields?.accountNumber ?? value.fields?.iban ?? "";
  return {
    method: "bank",
    legal_name: "Encrypted payout destination",
    email: null,
    bank_details: null,
    destination_version: 1,
    destination_nonce: nonce.toString("base64"),
    destination_ciphertext: ciphertext.toString("base64"),
    destination_tag: cipher.getAuthTag().toString("base64"),
    destination_mask: JSON.stringify({
      country: value.country,
      currency: value.currency,
      accountHint: account.length === 0 ? "Bank details saved" : `••••${account.slice(-4)}`,
    }),
  };
}

async function migrate(table, idColumn) {
  const { data, error } = await db
    .from(table)
    .select(`${idColumn},method,legal_name,country,currency,email,bank_details,destination_ciphertext`)
    .is("destination_ciphertext", null);
  if (error) throw new Error(`${table}: ${error.message}`);
  const rows = data ?? [];
  process.stdout.write(`${table}: ${rows.length} plaintext row(s) found${apply ? "" : " (dry run)"}\n`);
  if (!apply) return;
  for (const row of rows) {
    const { error: updateError } = await db
      .from(table)
      .update(encrypt(destination(row)))
      .eq(idColumn, row[idColumn])
      .is("destination_ciphertext", null);
    if (updateError) throw new Error(`${table} ${String(row[idColumn])}: ${updateError.message}`);
  }
}

await migrate("payout_profiles", "uid");
await migrate("withdrawals", "withdrawal_id");
process.stdout.write(apply ? "Payout encryption migration complete.\n" : "Dry run only. Re-run with --apply to write.\n");
