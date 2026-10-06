/**
 * The output size a refusal says would be accepted, or null when it names none.
 *
 * A request can ask for more output than a model allows - "supports at most 32768
 * completion tokens" (OpenAI), "max_tokens: 16384 > 8192" (Anthropic), "less than or equal
 * to `32768`" (Groq), "the valid range of max_tokens is [1, 8192]" (DeepSeek) - or than an
 * OpenRouter balance can pay for ("can only afford 3000"). Every one is answered by asking
 * again at the size it names: the last slightly under, because the balance also pays for the
 * input.
 */
export function allowedOutputSize(detail: string): number | null {
  const number = (raw: string | undefined): number | null => {
    const value = Number((raw ?? "").replace(/,/g, ""));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const afford = /can only afford (\d[\d,]*)/i.exec(detail);
  if (afford !== null) {
    const value = number(afford[1]);
    return value === null ? null : Math.floor(value * 0.95);
  }
  const patterns = [
    /supports at most (\d[\d,]*)(?: completion| output)? tokens/i,
    /max_tokens: \d[\d,]* > (\d[\d,]*)/i,
    /less than or equal to `?(\d[\d,]*)`?/i,
    /valid range of max_tokens is \[\d+,\s*(\d[\d,]*)\]/i,
    /max(?:imum)? (?:output|completion) tokens?(?: is| of|:)?\s*`?(\d[\d,]*)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(detail);
    if (match !== null) return number(match[1]);
  }
  return null;
}
