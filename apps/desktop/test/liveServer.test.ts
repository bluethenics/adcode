import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  RELOAD_PATH,
  contentTypeFor,
  directoryListing,
  escapeHtml,
  injectReloadScript,
  resolveRequestPath,
} from "../src/main/liveServer.ts";

const ROOT = resolve("/work/site");

describe("resolveRequestPath", () => {
  it("resolves an ordinary request under the workspace", () => {
    expect(resolveRequestPath(ROOT, "/index.html")).toBe(resolve(ROOT, "index.html"));
    expect(resolveRequestPath(ROOT, "/css/style.css")).toBe(resolve(ROOT, "css/style.css"));
  });

  it("resolves the root itself, which is what a directory listing needs", () => {
    expect(resolveRequestPath(ROOT, "/")).toBe(ROOT);
  });

  it("collapses a climb back to the root rather than escaping it", () => {
    // Anything on the loopback interface can send this - a hostile page in another tab
    // included - so it is a real request, not a theoretical one. An absolute request path
    // cannot rise above `/`, so `..` segments are absorbed and the result stays inside.
    // The request then 404s like any other missing file, which is friendlier than a 403
    // for the far commoner cause: one `../` too many in a hand-written relative link.
    expect(resolveRequestPath(ROOT, "/../../../../etc/passwd")).toBe(resolve(ROOT, "etc/passwd"));
    expect(resolveRequestPath(ROOT, "/css/../../secrets.txt")).toBe(
      resolve(ROOT, "secrets.txt"),
    );
  });

  it("collapses a climb hidden inside a percent-escape, not just a literal one", () => {
    // `%2e%2e%2f` is `../`. Normalising before decoding would leave it untouched, and it
    // would then be joined to the root as a real `..` segment.
    expect(resolveRequestPath(ROOT, "/%2e%2e%2f%2e%2e%2fsecrets.txt")).toBe(
      resolve(ROOT, "secrets.txt"),
    );
  });

  it("refuses a climb that normalisation cannot absorb", () => {
    // A relative request path has no leading `/` for `..` to be absorbed against, so it
    // survives into the join and genuinely points outside. This is the case that proves
    // `isInsideWorkspace` is load-bearing rather than decorative.
    expect(resolveRequestPath(ROOT, "../secrets.txt")).toBeNull();
    expect(resolveRequestPath(ROOT, "../site-backup/index.html")).toBeNull();
  });

  it("refuses a malformed escape rather than guessing what was meant", () => {
    expect(resolveRequestPath(ROOT, "/%")).toBeNull();
    expect(resolveRequestPath(ROOT, "/%zz")).toBeNull();
  });

  it("refuses a NUL byte, which can truncate the path inside a syscall", () => {
    expect(resolveRequestPath(ROOT, `/ok.html${String.fromCharCode(0)}.png`)).toBeNull();
  });

  it("ignores a query string, which is not part of the path", () => {
    expect(resolveRequestPath(ROOT, "/index.html?v=2")).toBe(resolve(ROOT, "index.html"));
  });

  it("handles a filename with a space in it, which beginners' files often have", () => {
    expect(resolveRequestPath(ROOT, "/my%20page.html")).toBe(resolve(ROOT, "my page.html"));
  });

  it("refuses a sibling folder whose name merely starts with the root's", () => {
    // The path-shaped version of a hostname-suffix bug: `site-backup` is not inside
    // `site`, however much its name looks like it.
    expect(resolveRequestPath(resolve("/work/site"), "../site-backup/index.html")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("names the types a static site is actually made of", () => {
    expect(contentTypeFor("/a/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/a/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/a/style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/a/logo.svg")).toBe("image/svg+xml");
  });

  it("is case-insensitive, because Windows filenames are", () => {
    expect(contentTypeFor("/a/PHOTO.JPG")).toBe("image/jpeg");
  });

  it("falls back to a byte stream rather than guessing", () => {
    // Guessing `text/html` for an unknown extension would let an uploaded file execute as
    // a page in the preview's origin.
    expect(contentTypeFor("/a/thing.weird")).toBe("application/octet-stream");
    expect(contentTypeFor("/a/noextension")).toBe("application/octet-stream");
  });
});

describe("injectReloadScript", () => {
  it("puts the script just before the closing body tag", () => {
    const result = injectReloadScript("<html><body><h1>Hi</h1></body></html>");

    expect(result).toContain("EventSource");
    expect(result.indexOf("EventSource")).toBeLessThan(result.indexOf("</body>"));
    expect(result).toContain("<h1>Hi</h1>");
  });

  it("appends when there is no body tag at all", () => {
    // Half-written markup is the normal state of a file someone is learning on. This must
    // never be the reason a page fails to render.
    const result = injectReloadScript("<h1>Hi</h1>");

    expect(result).toContain("<h1>Hi</h1>");
    expect(result).toContain("EventSource");
  });

  it("finds a closing tag written in capitals", () => {
    const result = injectReloadScript("<HTML><BODY>Hi</BODY></HTML>");

    expect(result.indexOf("EventSource")).toBeLessThan(result.indexOf("</BODY>"));
  });

  it("uses the last closing body tag when the page contains the text twice", () => {
    const result = injectReloadScript("<body><code>&lt;/body&gt;</code>real</body>");

    expect(result.indexOf("EventSource")).toBeGreaterThan(result.indexOf("real"));
  });

  it("points the client at the reload channel", () => {
    expect(injectReloadScript("<body></body>")).toContain(RELOAD_PATH);
  });
});

describe("escapeHtml", () => {
  it("neutralises every character that could close a tag or an attribute", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    );
  });

  it("escapes ampersands before anything else, so an escape is not double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("directoryListing", () => {
  it("lists names alphabetically", () => {
    const html = directoryListing("/", ["style.css", "about.html", "index.js"]);

    expect(html.indexOf("about.html")).toBeLessThan(html.indexOf("index.js"));
    expect(html.indexOf("index.js")).toBeLessThan(html.indexOf("style.css"));
  });

  it("escapes a filename that is itself markup", () => {
    // A file can be named anything, and this page renders names straight into HTML.
    const html = directoryListing("/", ["<script>bad</script>.txt"]);

    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;script&gt;bad");
  });

  it("percent-encodes the link so a space in a name still resolves", () => {
    expect(directoryListing("/", ["my page.html"])).toContain("my%20page.html");
  });

  it("builds links relative to the folder being listed", () => {
    expect(directoryListing("/css", ["a.css"])).toContain('href="/css/a.css"');
    expect(directoryListing("/css/", ["a.css"])).toContain('href="/css/a.css"');
  });

  it("says why the user is looking at a list instead of their page", () => {
    expect(directoryListing("/", [])).toContain("index.html");
  });

  it("reloads itself too, so adding an index.html replaces this page", () => {
    expect(directoryListing("/", [])).toContain("EventSource");
  });
});
