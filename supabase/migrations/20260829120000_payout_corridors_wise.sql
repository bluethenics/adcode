-- Every destination a normal Wise account can send to.
--
-- Four corridors were seeded when the encryption work landed and all four shipped
-- `enabled = false`, pending somebody verifying the recipient route in Wise. None was ever
-- enabled, so `savePayoutProfile` refused every profile save, so the "payout details on
-- file" rule could never pass and nobody could withdraw even once the RPCs worked.
--
-- The required fields below are Wise's own published recipient requirements for each
-- route, expressed in the field kinds `payoutCorridors.ts` knows how to validate. They are
-- seeded enabled because that is the operating decision: the admin screen can disable any
-- individual corridor the moment a transfer to it bounces, and a corridor that is off is
-- indistinguishable to a user from a country we refuse to pay.
--
-- `verified_at` stays null on everything this migration adds, and the source note says so.
-- That column means "an admin confirmed this exact route in Wise", and seeding a table is
-- not that. Enabling a corridor is a claim we can pay there; verifying it is a claim
-- somebody has.
--
-- Paying by Wise email address does not appear here at all. It needs no bank coordinates
-- and therefore no corridor - Wise resolves the recipient from the address - so it is
-- handled as a payout *method* in the service and works to any country.

insert into public.payout_corridors (
  country, currency, enabled, required_fields, source_note, verified_at, updated_at, updated_by
) values
  -- ── IBAN routes ───────────────────────────────────────────────────────────
  ('AT','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('BE','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CY','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('DE','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('EE','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('ES','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('FI','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('FR','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('GR','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('HR','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('IE','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('IT','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('LT','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('LU','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('LV','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('MT','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('NL','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('PT','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('SI','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('SK','EUR',true,'["iban","bankName"]','SEPA IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('BG','BGN',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CZ','CZK',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('DK','DKK',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('HU','HUF',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('NO','NOK',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('PL','PLN',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('RO','RON',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('SE','SEK',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CH','CHF',true,'["iban","bankName"]','IBAN route in local currency, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('TR','TRY',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('UA','UAH',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('GE','GEL',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('KZ','KZT',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('AE','AED',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('SA','SAR',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('QA','QAR',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('IL','ILS',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('EG','EGP',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('PK','PKR',true,'["iban","bankName"]','IBAN route, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),

  -- ── National clearing-code routes ─────────────────────────────────────────
  ('GB','GBP',true,'["accountNumber","sortCode","bankName"]','UK account number and sort code, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('US','USD',true,'["accountNumber","routingNumber","bankName","address"]','ACH account and routing number; Wise requires a recipient address for USD. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CA','CAD',true,'["accountNumber","bankCode","branchCode","bankName"]','Institution number and transit number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('AU','AUD',true,'["accountNumber","bsb","bankName"]','BSB and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('NZ','NZD',true,'["accountNumber","bankName"]','New Zealand account number carries its own bank and branch, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('IN','INR',true,'["accountNumber","ifsc","bankName"]','Account number and IFSC, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('SG','SGD',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('HK','HKD',true,'["accountNumber","bankCode","branchCode","bankName"]','Bank and branch code with account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('JP','JPY',true,'["accountNumber","bankCode","branchCode","bankName","phone"]','Bank and branch code; Wise requires a recipient phone number for JPY. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('KR','KRW',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CN','CNY',true,'["accountNumber","bankName","phone"]','Account number with bank name; Wise requires a recipient phone number for CNY. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('MX','MXN',true,'["clabe","bankName"]','18-digit CLABE, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('BR','BRL',true,'["accountNumber","bankCode","branchCode","bankName","supplemental"]','Bank and branch code with account; Wise requires the recipient CPF or CNPJ, which goes in the additional details field. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('AR','ARS',true,'["accountNumber","bankName","supplemental"]','22-digit CBU in the account field; Wise requires the recipient CUIL or CUIT, which goes in the additional details field. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CL','CLP',true,'["accountNumber","bankCode","bankName","supplemental"]','Bank code and account; Wise requires the recipient RUT, which goes in the additional details field. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('CO','COP',true,'["accountNumber","bankCode","bankName","supplemental"]','Bank code and account; Wise requires the recipient identity document number, which goes in the additional details field. Seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('PE','PEN',true,'["accountNumber","bankName"]','20-digit CCI in the account field, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('UY','UYU',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('ZA','ZAR',true,'["accountNumber","bankCode","bankName"]','Branch code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('NG','NGN',true,'["accountNumber","bankName"]','10-digit NUBAN account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('KE','KES',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('GH','GHS',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('MA','MAD',true,'["accountNumber","bankName"]','24-digit RIB in the account field, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('PH','PHP',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('ID','IDR',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('MY','MYR',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('TH','THB',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('VN','VND',true,'["accountNumber","bankCode","bankName"]','Bank code and account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('BD','BDT',true,'["accountNumber","bankCode","branchCode","bankName"]','Bank and branch code with account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('LK','LKR',true,'["accountNumber","bankCode","branchCode","bankName"]','Bank and branch code with account number, seeded from Wise recipient requirements; not individually verified.',null,0,'setup'),
  ('NP','NPR',true,'["accountNumber","bankName"]','Account number with bank name, seeded from Wise recipient requirements; not individually verified.',null,0,'setup')
on conflict (country, currency) do update set
  enabled = excluded.enabled,
  required_fields = excluded.required_fields,
  source_note = excluded.source_note,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;
