-- Creative artwork moves out of the creatives row and into object storage.
--
-- Why this exists: `creatives.logo_light` and `logo_dark` were storing whole images as
-- base64 `data:` URLs - 31 kB each, a 63 kB row. Two things broke as a result, and both
-- were invisible from the advertiser side because the row itself was perfectly valid.
--
--   1. `/v1/serve` reads that row. The read cost ~1,960ms of a 3,000ms client budget,
--      while every other call in the handler cost ~220ms. Serving averaged ~3,089ms, the
--      editor timed out, and the response was discarded - after the server had already
--      recorded the serve. The result was 667 recorded serves and zero impressions.
--   2. The editor rejects a `data:` URL regardless: it caps a creative URL at 2,048
--      characters and requires https on an allowlisted host.
--
-- So the bytes live here, and the row holds a short URL on the service's own origin,
-- served by `GET /assets/:key`.
--
-- Private on purpose. The service reaches this with the service_role key, which bypasses
-- RLS, and hands the bytes out itself - so the editor only ever talks to one hostname and
-- the bucket needs no public policy and no anon access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-assets',
  'creative-assets',
  false,
  524288, -- 512 kB, matching MAX_ASSET_BYTES in services/api/src/assets.ts
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
