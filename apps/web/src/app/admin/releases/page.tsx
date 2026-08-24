"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";
import { ADMIN_TABS } from "../tabs";

interface ReleaseRow {
  version: string;
  title: string;
  body: string;
  highlights: string[];
  announce: boolean;
  critical: boolean;
  status: "draft" | "published";
  authoredBy: "human" | "agent";
  authorUid: string;
  publishedAt: number | null;
  updatedAt: number;
}

const EMPTY = {
  version: "",
  title: "",
  body: "",
  highlights: "",
  announce: false,
  critical: false,
};

/**
 * Release notes: what shipped, and who gets told about it.
 *
 * Two switches on this page decide whether anybody is interrupted, and they are worth
 * understanding before you use them. **Publish** puts a note on the changelog and in the
 * editor&apos;s What&apos;s New list — quiet, and the right setting for almost everything.
 * **Announce** additionally shows a card in the editor, once per person, in a gap in their
 * work. **Important** lets that card appear even while somebody is typing, and is for
 * security fixes and data loss, nothing else.
 *
 * Drafts written by the release script land here marked as such. Nothing a tool writes
 * reaches a user until a person on this page publishes it.
 */
export default function AdminReleases() {
  return (
    <AppShell title="Admin" tabs={ADMIN_TABS} requireAdmin>
      <ReleasesBody />
    </AppShell>
  );
}

function ReleasesBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<{ releases: ReleaseRow[] }>({
      path: "/admin/releases",
      token: await token(),
    });
    if (found.ok) setRows(found.value.releases);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const highlightList = useMemo(
    () =>
      draft.highlights
        .split("\n")
        .map((one) => one.trim())
        .filter((one) => one.length > 0)
        .slice(0, 6),
    [draft.highlights],
  );

  const save = async (status: "draft" | "published") => {
    if (busy) return;

    if (draft.version.trim().length === 0 || draft.title.trim().length === 0) {
      setError("A release note needs a version and a headline.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);

    const result = await apiFetch<ReleaseRow>({
      path: "/admin/releases",
      token: await token(),
      method: "POST",
      body: {
        version: draft.version.trim(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        highlights: highlightList,
        announce: draft.announce,
        critical: draft.critical,
        status,
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setSaved(
      status === "draft"
        ? "Saved as a draft. Nobody sees it yet."
        : draft.announce
          ? "Published. Editors pick it up within a few hours and each person sees the card once."
          : "Published to the changelog. No card, no interruption.",
    );
    setDraft({ ...EMPTY });
    void load();
  };

  const edit = (row: ReleaseRow) => {
    setDraft({
      version: row.version,
      title: row.title,
      body: row.body,
      highlights: row.highlights.join("\n"),
      announce: row.announce,
      critical: row.critical,
    });
    setSaved(null);
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {saved !== null && (
        <div className="notice" data-tone="ok">
          {saved}
        </div>
      )}

      <div className="notice" data-tone="info">
        Publishing puts a note on the changelog and in the editor&apos;s What&apos;s New
        list. That is all it does. Ticking <strong>Announce</strong> additionally shows a
        card in the editor — once per person, ever, and only in a gap in their work. Most
        releases should be published without it.
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save("published");
        }}
        style={{ maxWidth: 620, marginBottom: 34 }}
      >
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Write a release note</h3>

        <div className="field">
          <label htmlFor="r-version">Version</label>
          <span className="field-hint">
            The version this note is about. Saving the same version twice edits that note
            rather than adding a second one.
          </span>
          <input
            id="r-version"
            className="input"
            maxLength={32}
            placeholder="0.2.0"
            value={draft.version}
            onChange={(e) => setDraft({ ...draft, version: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="r-title">Headline</label>
          <span className="field-hint">
            {draft.title.length}/140. What somebody got, in their words — &ldquo;Search is
            twice as fast&rdquo;, not &ldquo;Refactored the search index&rdquo;.
          </span>
          <input
            id="r-title"
            className="input"
            maxLength={140}
            placeholder="Search is twice as fast"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="r-highlights">Highlights</label>
          <span className="field-hint">
            One per line, up to six. These are what the card in the editor shows, so keep
            them to a line each.
          </span>
          <textarea
            id="r-highlights"
            className="textarea"
            rows={4}
            placeholder={"Search is twice as fast\nThe debugger stops on exceptions\nTerminal paste works everywhere"}
            value={draft.highlights}
            onChange={(e) => setDraft({ ...draft, highlights: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="r-body">The full note</label>
          <span className="field-hint">
            Shown on the changelog and in What&apos;s New. Markdown headings and bullet
            lists are understood; everything else is a paragraph.
          </span>
          <textarea
            id="r-body"
            className="textarea"
            rows={8}
            placeholder={"## Faster search\n\nSearching a large project no longer pauses.\n\n- Results stream in as they are found\n- Cancelling is instant"}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Who gets told</label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.announce}
              onChange={(e) => setDraft({ ...draft, announce: e.target.checked, critical: e.target.checked ? draft.critical : false })}
            />
            <span>
              <strong>Announce it in the editor.</strong> A card, once per person ever,
              shown only when they are not typing, not running a command, and not
              debugging. Leave this off for fixes nobody needs to read about.
            </span>
          </label>

          <label className="check" data-disabled={!draft.announce}>
            <input
              type="checkbox"
              checked={draft.critical}
              disabled={!draft.announce}
              onChange={(e) => setDraft({ ...draft, critical: e.target.checked })}
            />
            <span>
              <strong>Important — do not wait for a quiet moment.</strong> The card appears
              even mid-keystroke. For security fixes and data loss only. It still respects
              a user who has turned announcements off, and it is still shown only once.
            </span>
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Publish
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() => void save("draft")}
          >
            Save draft
          </button>
        </div>
      </form>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Notes</h3>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>No release notes yet</h3>
          <p>
            Notes you write appear here, along with any the release script has drafted for
            you to look over.
          </p>
        </div>
      ) : (
        <div className="rows">
          {rows.map((row) => (
            <div className="row" key={row.version}>
              <span className="row-main">
                <span className="row-title">
                  {row.version} — {row.title}
                </span>
                <span className="row-sub">
                  <span className="pill" data-tone={row.status === "published" ? "live" : "ended"}>
                    {row.status === "published" ? "Published" : "Draft"}
                  </span>{" "}
                  {row.announce ? "announced" : "changelog only"}
                  {row.critical ? " · important" : ""}
                  {row.authoredBy === "agent" ? " · drafted by a tool" : ""} ·{" "}
                  {when(row.publishedAt ?? row.updatedAt)}
                </span>
              </span>
              <button className="btn btn-outline btn-small" disabled={busy} onClick={() => edit(row)}>
                Edit
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="field-hint" style={{ marginTop: 18, maxWidth: "64ch" }}>
        Editing a published note changes what the changelog says, but not who has already
        been shown the card. Each person sees a given version once and there is no way to
        show it to them again — which is the point.
      </p>
    </>
  );
}
