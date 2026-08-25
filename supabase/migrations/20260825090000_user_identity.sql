-- Who a user is, not just which uid they are.
--
-- The admin panel could only ever show a uid, because a uid was the only thing this
-- database held. Identity lives in Firebase, and `firebase-admin` cannot run on workerd -
-- which is the same wall that moved administrators out of custom claims and into a table.
--
-- The way out is that the verified token already carries this. A Google or GitHub sign-in
-- puts `email`, `name` and `picture` in the claims, and `authenticate()` reads that token
-- on every single request. So the columns are filled from something already in hand,
-- rather than by asking Firebase for it.
--
-- **Anonymous users have none of these, and that is the normal case.** First launch signs
-- in anonymously with no UI (brief §8.4), so most rows will carry nulls until somebody
-- links an account. Nullable, therefore, rather than defaulted to an empty string: null
-- means "we have never been told", and an empty string would mean "they told us nothing",
-- which are different facts and would look identical on the screen.

alter table public.users add column if not exists email        text;
alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists photo_url    text;

-- What the admin list sorts and searches by. Partial, because the rows worth looking up
-- by address are exactly the ones that have one, and indexing a column that is null for
-- most of the table is paying for nothing.
create index if not exists users_email_idx on public.users (lower(email)) where email is not null;
