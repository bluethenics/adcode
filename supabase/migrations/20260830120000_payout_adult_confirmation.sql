-- The 18-or-older confirmation, recorded on the payout profile.
--
-- The terms require a person to be 18 or older to earn or withdraw. Until this column
-- existed that requirement lived only on a web page: nothing in this schema records a date
-- of birth, and the `account-age` eligibility rule measures how long an account has
-- existed, not how old its holder is. A condition nobody is ever asked to affirm is not
-- evidence of anything.
--
-- A timestamp rather than a boolean, because the question that would actually be asked is
-- "when did they confirm it", and a boolean cannot answer that.
--
-- Nullable, and deliberately not backfilled. Profiles saved before this shipped were never
-- shown the question, so writing a timestamp onto them would manufacture a confirmation
-- that never happened - which is the one thing this column exists to make impossible. They
-- fail the new rule and are asked once, the next time they open the payouts screen.

alter table public.payout_profiles
  add column if not exists adult_confirmed_at bigint;

comment on column public.payout_profiles.adult_confirmed_at is
  'When the holder confirmed they are 18 or older, per the terms. Null means never asked or never confirmed; such a profile fails the "adult" eligibility rule and cannot withdraw.';
