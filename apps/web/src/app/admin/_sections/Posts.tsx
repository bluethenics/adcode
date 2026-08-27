"use client";

import { useCallback, useEffect, useState } from "react";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";

type Surface = "blog" | "docs" | "both";

interface PostRow {
  slug: string;
  title: string;
  description: string;
  body: string;
  status: string;
  surface?: Surface;
  section?: string;
  order?: number;
  related?: string[];
  publishedAt: number | null;
  updatedAt: number;
}

const EMPTY = {
  slug: "",
  title: "",
  description: "",
  body: "",
  surface: "blog" as Surface,
  section: "Guides",
  order: 0,
};

/**
 * Which of the two checkboxes are ticked, as the one value the server stores.
 *
 * Neither ticked is not a state worth having - a page that appears nowhere is a draft, and
 * there is already a button for that - so unticking the last one puts it back on the blog.
 */
function surfaceFrom(blog: boolean, docs: boolean): Surface {
  if (blog && docs) return "both";
  if (docs) return "docs";
  return "blog";
}

const showsOnBlog = (surface: Surface): boolean => surface === "blog" || surface === "both";
const showsInDocs = (surface: Surface): boolean => surface === "docs" || surface === "both";

/** Title to slug, doing what the server's SLUG rule will accept. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * One editor for the blog and the documentation.
 *
 * They were always the same thing written twice: an explanation of how something works is
 * an essay on the blog and a reference page in the docs, and keeping two copies means
 * keeping two copies in step. A page here is marked for one surface, the other, or both.
 *
 * The documentation already has a page for every feature in the editor, generated from the
 * same text the app shows behind each `?`. Publishing a docs page whose address matches a
 * generated one replaces it - which is how you override an explanation you disagree with,
 * rather than fighting it.
 */
export function BlogBody() {
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
      body: {
        ...draft,
        slug,
        description: draft.description.trim() || draft.title,
        status,
        // Only meaningful for a page that appears in the docs, but harmless otherwise and
        // kept so switching a post into the docs later does not lose where it belongs.
        section: draft.section.trim() || "Guides",
        order: draft.order,
      },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    const where = [
      showsOnBlog(draft.surface) ? `/blog/${slug}` : null,
      showsInDocs(draft.surface) ? `/docs/${slug}` : null,
    ]
      .filter((one) => one !== null)
      .join(" and ");

    setSaved(status === "published" ? `Published at ${where}` : "Saved as a draft.");
    setDraft(EMPTY);
    setEditing(null);
    setSlugTouched(false);
    void load();
  };

  const edit = (post: PostRow) => {
    setDraft({
      slug: post.slug,
      title: post.title,
      description: post.description,
      body: post.body,
      surface: post.surface ?? "blog",
      section: post.section ?? "Guides",
      order: post.order ?? 0,
    });
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
            {editing === null ? "Write a page" : `Editing ${editing}`}
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
            <MarkdownEditor
              id="p-body"
              rows={18}
              placeholder="Write the post. The preview beside it is rendered by the same code the live site uses."
              value={draft.body}
              onChange={(body) => setDraft({ ...draft, body })}
            />
          </div>

          <div className="field">
            <label>Where it appears</label>
            <label className="check">
              <input
                type="checkbox"
                checked={showsOnBlog(draft.surface)}
                onChange={(e) =>
                  setDraft({ ...draft, surface: surfaceFrom(e.target.checked, showsInDocs(draft.surface)) })
                }
              />
              <span>
                <strong>Blog.</strong> Listed newest-first at /blog, with a date and a
                reading time. For writing that is worth reading once.
              </span>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={showsInDocs(draft.surface)}
                onChange={(e) =>
                  setDraft({ ...draft, surface: surfaceFrom(showsOnBlog(draft.surface), e.target.checked) })
                }
              />
              <span>
                <strong>Documentation.</strong> Filed under a section at /docs, with no date.
                For writing somebody comes back to. Using the same web address as a generated
                page replaces it.
              </span>
            </label>

            <span className="field-hint">
              Ticking both publishes one page in two places — one piece of writing, not two
              copies to keep in step. Unticking both puts it back on the blog.
            </span>
          </div>

          {showsInDocs(draft.surface) && (
            <div className="field">
              <label htmlFor="p-section">Documentation section</label>
              <span className="field-hint">
                The sidebar group. An existing name files it with those pages; a new one
                starts a section of its own, after the generated ones.
              </span>
              <input
                id="p-section"
                className="input"
                maxLength={60}
                placeholder="Guides"
                value={draft.section}
                onChange={(e) => setDraft({ ...draft, section: e.target.value })}
              />
              <span className="field-hint" style={{ marginTop: 10 }}>
                Order within the section — lower comes first. Ties are broken by title.
              </span>
              <input
                className="input"
                type="number"
                style={{ maxWidth: 120 }}
                value={draft.order}
                onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) || 0 })}
              />
            </div>
          )}

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
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Pages</h3>
          {posts.length === 0 ? (
            <div className="empty">
              <h3>Nothing written yet</h3>
              <p>
                Published pages appear immediately. The documentation already has a page for
                every feature in the editor — write here only to add something or to replace
                one of them.
              </p>
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
                      {[
                        showsOnBlog(post.surface ?? "blog") ? `/blog/${post.slug}` : null,
                        showsInDocs(post.surface ?? "blog") ? `/docs/${post.slug}` : null,
                      ]
                        .filter((one) => one !== null)
                        .join(" · ")}{" "}
                      · edited {when(post.updatedAt)}
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
