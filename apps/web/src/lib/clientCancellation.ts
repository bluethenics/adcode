/**
 * OpenNext's Node response adapter resolves its fetch promise only after headers are
 * written. A client can disconnect earlier, destroying that response before headers
 * exist. Finish the outer request too; OpenNext retains its handler in waitUntil so
 * the aborted provider call can still release its allowance reservation.
 */
export async function withClientCancellation(request: Request, respond: () => Promise<Response>): Promise<Response> {
  const cancelled = (): Response => new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
  if (request.signal.aborted) return cancelled();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<Response>(resolve => { onAbort = () => resolve(cancelled()); });
  request.signal.addEventListener("abort", onAbort, { once: true });
  try { return await Promise.race([respond(), aborted]); }
  finally { request.signal.removeEventListener("abort", onAbort); }
}
