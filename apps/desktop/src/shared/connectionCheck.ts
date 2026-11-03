/**
 * What a failed "check this connection" means for an address the user typed.
 *
 * Reported (2.4.4): adding NVIDIA as a custom provider answered only "fetch failed", and a custom
 * GLM route only "HTTP 400: upstream request failed". The address or the model name is almost
 * always the cause, and a raw transport error says neither. Built-in providers keep their own
 * messages: their addresses are ADCode's, so the same words there mean the network.
 */
export function explainConnectionFailure(message: string, baseUrl: string | null): string {
  const address = baseUrl === null || baseUrl.trim().length === 0 ? "the address you entered" : baseUrl.trim();
  const versioned = /\/v\d+(?:beta)?\/?$/i.test(address) || /\/openai\/?$/i.test(address);
  const path = versioned ? "" : " Most OpenAI-compatible providers need /v1 at the end, for example https://integrate.api.nvidia.com/v1.";
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|certificate|self.signed|UNABLE_TO_VERIFY/i.test(message)) {
    return `ADCode could not reach ${address}. Check the address for typos and that it starts with https://.${path} (${message})`;
  }
  if (/HTTP 404\b|not found/i.test(message)) {
    return `${address} answered, but not as an OpenAI-compatible API.${path || " Check the address against the provider's API docs."} (${message})`;
  }
  if (/HTTP 40[13]\b|unauthori[sz]ed|forbidden|invalid.{0,12}(?:api.?)?key|authentication/i.test(message)) {
    return `The provider did not accept this key. Copy it again from the provider's dashboard - keys are usually shown only once. (${message})`;
  }
  if (/HTTP 400\b|invalid request|upstream request failed|model.{0,30}(?:not|unknown|invalid|does not exist)/i.test(message)) {
    return `The provider reached ${address} but refused the request. The model name is the usual cause: copy it exactly as the provider lists it, including any prefix such as "meta/" or "z-ai/". (${message})`;
  }
  return message;
}
