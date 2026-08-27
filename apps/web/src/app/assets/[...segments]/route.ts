/**
 * Every `/assets/*` request, handed to `services/api`.
 *
 * A second mount point beside `/v1/[...segments]`, and it needs its own because the API is
 * reached through Next's routing: anything not matched by a route file is Next's 404, and
 * `services/api` never sees it. The asset route lives outside `/v1` on purpose - the
 * version prefix is the serving *contract*, and this is a file - so it needs its own door.
 *
 * This is what creative artwork is served from. The bytes live in a private Supabase
 * Storage bucket and the service hands them out, so the editor only ever talks to one
 * hostname and the bucket needs no public policy.
 *
 * `force-dynamic` because the bytes come from storage at request time. The handler sets a
 * one-year immutable `cache-control` of its own, so this costs an origin hit once per key
 * per edge location, not once per view.
 */
import { handleApiRequest } from "@/lib/apiHandler";

export const dynamic = "force-dynamic";

/**
 * Read-only, deliberately.
 *
 * Artwork is written through the authenticated advertiser and admin endpoints under `/v1`.
 * Exporting anything else here would put a second, unauthenticated door on the store.
 */
export const GET = handleApiRequest;
export const HEAD = handleApiRequest;
export const OPTIONS = handleApiRequest;
