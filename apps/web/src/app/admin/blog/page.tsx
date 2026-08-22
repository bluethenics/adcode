"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";
import { ADMIN_TABS } from "../tabs";

interface PostRow {
  slug: string;
  title: string;
  description: string;
  body: string;
  status: string;
  publishedAt: number | null;
  updatedAt: number;
}

const EMPTY = { slug: "", title: "", description: "", body: "" };

/** Title to slug, doing what the server's SLUG rule will accept. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default function AdminBlog() {
  return (
    <AppShell title="Admin" tabs={ADMIN_TABS} requireAdmin>
      <BlogBody />
    </AppShell>
  );
}

function BlogBody() {
  const { token } = useAuth();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<{ posts: PostRow[] }>({ path: "/admin/posts", token: await token() });
    if (found.ok) setPosts(found.value.posts);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (status: "draft" | "published") => {
    if (busy) return;

    if (draft.title.trim().length === 0 || draft.body.trim().length === 0) {
      setError("A post needs a title and a body.");
      return;
    }

    const slug = slugTouched ? draft.slug : slugify(draft.title);
    if (slug.length === 0) {
      setError("That title doesn't produce a usable web address. Set the slug yourself.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);

    const result = await apiFetch<PostRow>({
      path: "/admin/posts",
      token: await token(),
      method: "POST",
      body: { ...draft, slug, description: draft.description.trim() || draft.title, status },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setSaved(status === "published" ? `Published at /blog/${slug}` : "Saved as a draft.");
    setDraft(EMPTY);
    setEditing(null);
    setSlugTouched(false);
    void load();
  };

  const edit = (post: PostRow) => {
    setDraft({ slug: post.slug, title: post.title, description: post.description, body: post.body });
    setEditing(post.slug);
    setSlugTouched(true);
    setSaved(null);
    setError(null);
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

      <div style={{ display: "grid", gap: 30, gridTemplateColumns: "1fr", maxWidth: 720 }}>
        <form onSubmit={(e) => e.preventDefault()}>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>
            {editing === null ? "Write a post" : `Editing ${editing}`}
          </h3>

          <div className="field">
            <label htmlFor="p-title">Title</label>
            <input
              id="p-title"
              className="input"
              maxLength={140}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="p-slug">Web address</label>
            <span className="field-hint">
              /blog/{slugTouched ? draft.slug || "…" : slugify(draft.title) || "…"} — lowercase
              letters, numbers and hyphens.
            </span>
            <input
              id="p-slug"
              className="input"
              maxLength={80}
              value={slugTouched ? draft.slug : slugify(draft.title)}
              onChange={(e) => {
                setSlugTouched(true);
                setDraft({ ...draft, slug: e.target.value });
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="p-desc">Summary</label>
            <span className="field-hint">
              Shown on the blog index and to search engines. Falls back to the title.
            </span>
            <input
              id="p-desc"
              className="input"
              maxLength={300}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="p-body">Body</label>
            <span className="field-hint">
              Markdown: ## headings, **bold**, `code`, - lists, [links](https://example.com).
            </span>
            <textarea
              id="p-body"
              className="textarea"
              style={{ minHeight: 320, fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 14 }}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>

          <div className="actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void save("published")}>
              Publish
            </button>
            <button className="btn btn-outline" disabled={busy} onClick={() => void save("draft")}>
              Save draft
            </button>
            {editing !== null && (
              <button
                className="btn btn-outline"
                onClick={() => {
                  setDraft(EMPTY);
                  setEditing(null);
                  setSlugTouched(false);
                }}
              >
                New post instead
              </button>
            )}
          </div>
        </form>

        <div>
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Posts</h3>
          {posts.length === 0 ? (
            <div className="empty">
              <h3>Nothing written yet</h3>
              <p>Published posts appear on the blog immediately.</p>
            </div>
          ) : (
            <div className="rows">
              {posts.map((post) => (
                <div className="row" key={post.slug}>
                  <span className="row-main">
                    <span className="row-title">{post.title}</span>
                    <span className="row-sub">
                      <span className="pill" data-tone={post.status === "published" ? "live" : "paused"}>
                        {post.status === "published" ? "Live" : "Draft"}
                      </span>{" "}
                      /blog/{post.slug} · edited {when(post.updatedAt)}
                    </span>
                  </span>
                  <button className="btn btn-outline btn-small" onClick={() => edit(post)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
