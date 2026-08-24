/**
 * Every `/v1/*` request, handed to `services/api`.
 *
 * A catch-all rather than a route file per endpoint: the routing already exists, is
 * already tested, and is already the thing both the desktop client and the mock server
 * agree with. Re-declaring it as a tree of Next route files would create a second,
 * untested copy of the API's surface whose only job is to disagree with the first one
 * eventually.
 *
 * `force-dynamic` because every one of these reads a bearer token and most of them write.
 * Without it Next would try to answer some of them at build time, when there is no
 * request, no token and no database.
 */
import { handleApiRequest } from "@/lib/apiHandler";

export const dynamic = "force-dynamic";

/**
 * The methods the API actually answers.
 *
 * `OPTIONS` is included because the browser sends preflight without an `Authorization`
 * header - the handler answers it before authenticating for exactly that reason. A method
 * not listed here gets Next's own 405, which is the right answer.
 */
export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PATCH = handleApiRequest;
export const PUT = handleApiRequest;
export const DELETE = handleApiRequest;
export const OPTIONS = handleApiRequest;
