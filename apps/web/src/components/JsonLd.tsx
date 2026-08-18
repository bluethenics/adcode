/**
 * A JSON-LD block.
 *
 * `JSON.stringify` output is escaped for `<` so a string in the data cannot close the
 * script tag early. The data here is ours rather than user input, but a component that
 * is safe only while its inputs stay trustworthy is a trap for whoever reuses it.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
