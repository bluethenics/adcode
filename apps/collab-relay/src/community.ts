/**
 * The community service: ADCode's public plugin directory and project artifacts.
 *
 * Two Durable Object classes:
 *
 * - `CommunityHub` - one instance, named "global". Listings, counts, stars, installs,
 *   improvements' metadata, activity feeds, creator streaks and the monetization waitlist.
 *   Everything small that has to be queried across all creators lives here, in SQLite.
 * - `ArtifactVault` - one instance per artifact. Its versions' files and its improvements'
 *   change sets, which are large and only ever read one artifact at a time. Splitting them
 *   out keeps the hub small no matter how many projects are published.
 *
 * Reading is public: the website lists plugins and artifacts without anybody signing in.
 * Every write needs an ADCode account with a verified email, and the account id always
 * comes from the verified token, never from the request body.
 *
 * Validation is `@adcode/community`'s, the same code the desktop app runs before it sends,
 * so a request the app thinks is fine is one this accepts.
 */
import { DurableObject } from "cloudflare:workers";
import {
  applyChanges, artifactAccess, artifactIsListed, artifactShareFor, checkChanges, checkSnapshot, checkWaitlistPrice,
  compareVersions, creatorProfile, dayNumber, decodeArtifactShare, describeContributions, encodeArtifactShare,
  newArtifactShareKey, newlyEarnedBadges, parseArtifactVisibility, parsePluginManifest,
  streakDays, trendingScore,
  type ActivityItem, type ActivityKind, type ArtifactAccess, type ArtifactChange, type ArtifactDetail, type ArtifactFile,
  type ArtifactListing, type ArtifactSnapshot, type ArtifactVisibility, type CommunityHome, type CommunityMe,
  type CreatorTotals, type ImprovementDetail, type ImprovementSummary, type PluginDetail, type PluginListing,
  type PluginManifest,
} from "../../../packages/community/src/index.ts";
import { SLASH_COMMANDS } from "../../desktop/src/shared/slashCommands.ts";
import { roomCardFromSnapshot, type ArtifactRoomCard, type ArtifactRoomSnapshot } from "../../../packages/collab/src/index.ts";

type Env = CollabRelayEnv;
const DAY = 86_400_000;
const BUILT_IN_SLASH = SLASH_COMMANDS.map((command) => command.id);

/** RPC drops custom error classes, so the status travels at the front of the message. */
const deny = (status: number, message: string): never => { throw new Error(`[${status}] ${message}`); };
const text = (value: unknown, label: string, min: number, max: number): string =>
  typeof value === "string" && value.trim().length >= min && value.length <= max ? value.trim() : deny(400, `${label} must be ${min}–${max} characters.`);
const name = (value: unknown): string => text(value, "Your name", 1, 64).replace(/[\u0000-\u001f]/g, "");
const newId = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 20);
const ID = /^[a-z0-9]{12,40}$/;
const PLUGIN_ROUTE_ID = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const tags = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) deny(400, "Use up to 6 tags.");
  return [...new Set((value as unknown[]).map((tag) => typeof tag === "string" && /^[a-z0-9][a-z0-9-]{0,23}$/.test(tag) ? tag : deny(400, "Tags are lowercase words of up to 24 characters.")))];
};

/** Per-account daily allowances. Generous for people, tight for scripts. */
const QUOTAS = { publishPlugin: 30, publishArtifact: 20, improvement: 40, report: 30, star: 300, install: 500 } as const;
const MAX_OWNED = { plugins: 50, artifacts: 30 } as const;
const KEEP_VERSIONS = 10;

type PluginRow = { id: string; ownerId: string; ownerName: string; name: string; description: string; icon: string; category: string; tags: string; version: string; manifest: string; contributes: string; remixOf: string | null; createdAt: number; updatedAt: number; installs: number; stars: number; remixes: number; hidden: number };
type ArtifactRow = { id: string; ownerId: string; ownerName: string; title: string; description: string; tags: string; helpWanted: string; version: number; fileCount: number; bytes: number; remixes: number; stars: number; readme: string; paths: string; remixOf: string | null; createdAt: number; updatedAt: number; hidden: number; visibility: ArtifactVisibility; shareKey: string };
type ImprovementRow = { id: string; artifactId: string; baseVersion: number; authorId: string; authorName: string; title: string; message: string; status: "open" | "accepted" | "declined"; reply: string; files: number; at: number; decidedAt: number; mergedVersion: number | null };

/** One artifact's files: every version (the latest few), and every improvement's changes. */
export class ArtifactVault extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Chunked: a SQLite value is capped at 2 MB, and a 2 MB snapshot as JSON can exceed it.
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS blobs(key TEXT NOT NULL, chunk INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(key, chunk))");
  }
  private put(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM blobs WHERE key=?", key);
      for (let offset = 0, chunk = 0; offset < json.length || chunk === 0; offset += 400_000, chunk++) {
        this.ctx.storage.sql.exec("INSERT INTO blobs VALUES(?,?,?)", key, chunk, json.slice(offset, offset + 400_000));
      }
    });
  }
  private get<T>(key: string): T | null {
    const rows = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM blobs WHERE key=? ORDER BY chunk", key).toArray();
    return rows.length === 0 ? null : JSON.parse(rows.map((row) => row.data).join("")) as T;
  }
  putVersion(version: number, files: readonly ArtifactFile[]): void {
    this.put(`v:${version}`, files);
    this.ctx.storage.sql.exec("DELETE FROM blobs WHERE key LIKE 'v:%' AND CAST(substr(key, 3) AS INTEGER) <= ?", version - KEEP_VERSIONS);
  }
  getVersion(version: number): ArtifactFile[] | null { return this.get<ArtifactFile[]>(`v:${version}`); }
  putChanges(id: string, changes: readonly ArtifactChange[]): void { this.put(`i:${id}`, changes); }
  getChanges(id: string): ArtifactChange[] | null { return this.get<ArtifactChange[]>(`i:${id}`); }
  async destroy(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

export class CommunityHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS plugins(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, contributes TEXT NOT NULL, remixOf TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, installs INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0, remixes INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
    sql.exec("CREATE INDEX IF NOT EXISTS plugins_owner ON plugins(ownerId)");
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_versions(pluginId TEXT NOT NULL, version TEXT NOT NULL, notes TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(pluginId, version))");
    // Every version keeps its own manifest, so people can install an older one. Added after
    // the first release: an existing database gains the column here, and rows published
    // before it have no manifest (their version is listed but cannot be installed).
    try { sql.exec("ALTER TABLE plugin_versions ADD COLUMN manifest TEXT"); } catch { /* Already there. */ }
    sql.exec("CREATE TABLE IF NOT EXISTS installs(pluginId TEXT NOT NULL, uid TEXT NOT NULL, at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(pluginId, uid))");
    sql.exec("CREATE INDEX IF NOT EXISTS installs_recent ON installs(pluginId, at)");
    sql.exec(`CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerName TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, tags TEXT NOT NULL, helpWanted TEXT NOT NULL, version INTEGER NOT NULL, fileCount INTEGER NOT NULL, bytes INTEGER NOT NULL, remixes INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0, readme TEXT NOT NULL, paths TEXT NOT NULL, remixOf TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)`);
    sql.exec("CREATE INDEX IF NOT EXISTS artifacts_owner ON artifacts(ownerId)");
    sql.exec("CREATE TABLE IF NOT EXISTS artifact_versions(artifactId TEXT NOT NULL, version INTEGER NOT NULL, message TEXT NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(artifactId, version))");
    try { sql.exec("ALTER TABLE artifacts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'"); } catch { /* Already there. */ }
    try { sql.exec("ALTER TABLE artifacts ADD COLUMN shareKey TEXT NOT NULL DEFAULT ''"); } catch { /* Already there. */ }
    for (const row of sql.exec<{ id: string }>("SELECT id FROM artifacts WHERE shareKey=''").toArray()) {
      sql.exec("UPDATE artifacts SET shareKey=? WHERE id=?", newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16))), row.id);
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS improvements(id TEXT PRIMARY KEY, artifactId TEXT NOT NULL, baseVersion INTEGER NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', files INTEGER NOT NULL, at INTEGER NOT NULL, decidedAt INTEGER NOT NULL DEFAULT 0, mergedVersion INTEGER)`);
    sql.exec("CREATE INDEX IF NOT EXISTS improvements_artifact ON improvements(artifactId, status)");
    sql.exec("CREATE INDEX IF NOT EXISTS improvements_author ON improvements(authorId)");
    sql.exec("CREATE TABLE IF NOT EXISTS stars(kind TEXT NOT NULL, targetId TEXT NOT NULL, uid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(kind, targetId, uid))");
    sql.exec("CREATE TABLE IF NOT EXISTS remixes(kind TEXT NOT NULL, targetId TEXT NOT NULL, uid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(kind, targetId, uid))");
    sql.exec("CREATE TABLE IF NOT EXISTS reports(kind TEXT NOT NULL, targetId TEXT NOT NULL, uid TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(kind, targetId, uid))");
    sql.exec("CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, targetKind TEXT NOT NULL, targetId TEXT NOT NULL, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE INDEX IF NOT EXISTS activity_uid ON activity(uid, id)");
    sql.exec("CREATE TABLE IF NOT EXISTS active_days(uid TEXT NOT NULL, day INTEGER NOT NULL, PRIMARY KEY(uid, day))");
    sql.exec("CREATE TABLE IF NOT EXISTS quota(uid TEXT NOT NULL, day INTEGER NOT NULL, action TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(uid, day, action))");
    sql.exec("CREATE TABLE IF NOT EXISTS waitlist(uid TEXT PRIMARY KEY, price REAL, note TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS names(uid TEXT PRIMARY KEY, name TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS live_rooms(artifactId TEXT PRIMARY KEY, title TEXT NOT NULL, task TEXT NOT NULL, hostName TEXT NOT NULL, branch TEXT NOT NULL, open INTEGER NOT NULL, memberCount INTEGER NOT NULL, planDone INTEGER NOT NULL, planTotal INTEGER NOT NULL, percent INTEGER NOT NULL, files TEXT NOT NULL, approvals INTEGER NOT NULL, handoffs INTEGER NOT NULL, warnings INTEGER NOT NULL, updatedAt INTEGER NOT NULL)");
  }

  private get sql() { return this.ctx.storage.sql; }

  /* ---------- small helpers ---------- */

  private spend(uid: string, action: keyof typeof QUOTAS): void {
    const day = dayNumber(Date.now());
    const used = this.sql.exec<{ n: number }>("SELECT n FROM quota WHERE uid=? AND day=? AND action=?", uid, day, action).toArray()[0]?.n ?? 0;
    if (used >= QUOTAS[action]) deny(429, "You have reached today's limit for this. It resets at midnight UTC.");
    this.sql.exec("INSERT INTO quota VALUES(?,?,?,1) ON CONFLICT(uid,day,action) DO UPDATE SET n=n+1", uid, day, action);
    if (Math.random() < 0.01) this.sql.exec("DELETE FROM quota WHERE day < ?", day - 2);
  }
  private active(uid: string): void { this.sql.exec("INSERT OR IGNORE INTO active_days VALUES(?,?)", uid, dayNumber(Date.now())); }
  private remember(uid: string, display: string): void { this.sql.exec("INSERT INTO names VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name", uid, display); }
  private notify(uid: string, kind: ActivityKind, message: string, targetKind: ActivityItem["targetKind"], targetId: string): void {
    this.sql.exec("INSERT INTO activity(uid,kind,text,targetKind,targetId,at) VALUES(?,?,?,?,?,?)", uid, kind, message.slice(0, 300), targetKind, targetId, Date.now());
    this.sql.exec("DELETE FROM activity WHERE uid=? AND id NOT IN (SELECT id FROM activity WHERE uid=? ORDER BY id DESC LIMIT 200)", uid, uid);
  }
  private totals(uid: string): CreatorTotals {
    const one = <T>(query: string, ...args: unknown[]): T => this.sql.exec(query, ...args).one() as T;
    const plugins = one<{ n: number; installs: number | null; stars: number | null; remixes: number | null }>("SELECT COUNT(*) n, SUM(installs) installs, SUM(stars) stars, SUM(remixes) remixes FROM plugins WHERE ownerId=?", uid);
    const artifacts = one<{ n: number; stars: number | null; remixes: number | null }>("SELECT COUNT(*) n, SUM(stars) stars, SUM(remixes) remixes FROM artifacts WHERE ownerId=?", uid);
    const accepted = one<{ n: number }>("SELECT COUNT(*) n FROM improvements WHERE authorId=? AND status='accepted'", uid).n;
    const days = this.sql.exec<{ day: number }>("SELECT day FROM active_days WHERE uid=? ORDER BY day DESC LIMIT 400", uid).toArray().map((row) => row.day);
    return {
      plugins: plugins.n, artifacts: artifacts.n, installs: plugins.installs ?? 0,
      stars: (plugins.stars ?? 0) + (artifacts.stars ?? 0), remixes: (plugins.remixes ?? 0) + (artifacts.remixes ?? 0),
      acceptedImprovements: accepted, streakDays: streakDays(days, Date.now()),
    };
  }
  /** Run a change that moves `uid`'s totals, and tell them about any badge it earned. */
  private withBadges<T>(uid: string, change: () => T): T {
    const before = this.totals(uid);
    const result = change();
    for (const badge of newlyEarnedBadges(before, this.totals(uid))) this.notify(uid, "badge.earned", `You earned the "${badge}" badge.`, "profile", uid);
    return result;
  }
  private pluginRow(id: string, includeHidden = false): PluginRow {
    const row = this.sql.exec<PluginRow>("SELECT * FROM plugins WHERE id=?", id).toArray()[0];
    if (row === undefined || (row.hidden && !includeHidden)) return deny(404, "That plugin is not in the directory.");
    return row;
  }
  private artifactRow(id: string, includeHidden = false): ArtifactRow {
    const row = this.sql.exec<ArtifactRow>("SELECT * FROM artifacts WHERE id=?", id).toArray()[0];
    if (row === undefined || (row.hidden && !includeHidden)) return deny(404, "That artifact is not shared any more.");
    return row;
  }
  private access(row: ArtifactRow, uid: string | null, key: string | null): ArtifactAccess {
    const verdict = artifactAccess({ ownerId: row.ownerId, visibility: row.visibility, shareKey: row.shareKey }, uid, key);
    return verdict ?? deny(404, "That private artifact needs its share code.");
  }
  accessFor(uid: string | null, id: string, key: string | null): ArtifactAccess {
    return this.access(this.artifactRow(id), uid, key);
  }
  rememberRoom(snapshot: ArtifactRoomSnapshot): void {
    const card = roomCardFromSnapshot(snapshot);
    this.sql.exec(
      "INSERT INTO live_rooms(artifactId,title,task,hostName,branch,open,memberCount,planDone,planTotal,percent,files,approvals,handoffs,warnings,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(artifactId) DO UPDATE SET title=excluded.title,task=excluded.task,hostName=excluded.hostName,branch=excluded.branch,open=excluded.open,memberCount=excluded.memberCount,planDone=excluded.planDone,planTotal=excluded.planTotal,percent=excluded.percent,files=excluded.files,approvals=excluded.approvals,handoffs=excluded.handoffs,warnings=excluded.warnings,updatedAt=excluded.updatedAt",
      card.artifactId, card.title, card.task, card.hostName, card.branch, card.open ? 1 : 0, card.memberCount,
      card.planDone, card.planTotal, card.percent, JSON.stringify(card.files), card.approvals, card.handoffs, card.warnings, card.updatedAt,
    );
  }
  liveRooms(): ArtifactRoomCard[] {
    return this.sql.exec<{
      artifactId: string; title: string; task: string; hostName: string; branch: string; open: number; memberCount: number;
      planDone: number; planTotal: number; percent: number; files: string; approvals: number; handoffs: number; warnings: number; updatedAt: number;
    }>("SELECT * FROM live_rooms ORDER BY open DESC, updatedAt DESC LIMIT 50").toArray().map((row) => ({
      artifactId: row.artifactId, title: row.title, task: row.task, hostName: row.hostName, branch: row.branch,
      open: row.open === 1, memberCount: row.memberCount, planDone: row.planDone, planTotal: row.planTotal,
      percent: row.percent, files: JSON.parse(row.files) as string[], approvals: row.approvals,
      handoffs: row.handoffs, warnings: row.warnings, updatedAt: row.updatedAt,
    }));
  }
  private weekly(pluginId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM installs WHERE pluginId=? AND at>?", pluginId, Date.now() - 7 * DAY).one().n;
  }
  private pluginListing(row: PluginRow, featured = false): PluginListing {
    return {
      id: row.id, name: row.name, description: row.description, icon: row.icon, category: row.category as PluginListing["category"],
      tags: JSON.parse(row.tags) as string[], version: row.version, ownerId: row.ownerId, ownerName: row.ownerName,
      installs: row.installs, installsWeek: this.weekly(row.id), stars: row.stars, contributes: row.contributes,
      remixOf: row.remixOf, createdAt: row.createdAt, updatedAt: row.updatedAt, featured,
    };
  }
  private artifactListing(row: ArtifactRow, access: ArtifactAccess | null = null): ArtifactListing {
    const counts = this.sql.exec<{ total: number; open: number; contributors: number }>(
      "SELECT COUNT(*) total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open, COUNT(DISTINCT CASE WHEN status='accepted' THEN authorId END) contributors FROM improvements WHERE artifactId=?", row.id).one();
    return {
      id: row.id, title: row.title, description: row.description, tags: JSON.parse(row.tags) as string[], helpWanted: row.helpWanted,
      ownerId: row.ownerId, ownerName: row.ownerName, version: row.version, fileCount: row.fileCount, bytes: row.bytes,
      remixes: row.remixes, stars: row.stars, improvements: counts.total, openImprovements: counts.open ?? 0, contributors: counts.contributors,
      remixOf: row.remixOf, createdAt: row.createdAt, updatedAt: row.updatedAt, visibility: row.visibility,
      shareCode: artifactShareFor({ id: row.id, ownerId: row.ownerId, visibility: row.visibility, shareKey: row.shareKey }, access),
    };
  }
  private improvementSummary(row: ImprovementRow): ImprovementSummary {
    const title = this.sql.exec<{ title: string }>("SELECT title FROM artifacts WHERE id=?", row.artifactId).toArray()[0]?.title ?? "Removed artifact";
    return { ...row, artifactTitle: title };
  }
  private search(query: string | null): { clause: string; args: string[] } {
    if (query === null || query.trim() === "") return { clause: "", args: [] };
    const like = `%${query.trim().slice(0, 60).replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    return { clause: " AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR ownerName LIKE ? ESCAPE '\\')", args: [like, like, like, like] };
  }

  /* ---------- reading ---------- */

  listPlugins(sort: string, query: string | null, category: string | null, limit: number, offset: number): PluginListing[] {
    const { clause, args } = this.search(query);
    const categoryClause = category ? " AND category=?" : "";
    const rows = this.sql.exec<PluginRow>(`SELECT * FROM plugins WHERE hidden=0${clause}${categoryClause}`, ...args, ...(category ? [category] : [])).toArray();
    const listed = rows.map((row) => this.pluginListing(row));
    const now = Date.now();
    if (sort === "new") listed.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "top") listed.sort((a, b) => b.installs - a.installs || b.stars - a.stars);
    else listed.sort((a, b) => trendingScore({ weekly: b.installsWeek, stars: b.stars, remixes: 0, createdAt: b.createdAt, updatedAt: b.updatedAt }, now) - trendingScore({ weekly: a.installsWeek, stars: a.stars, remixes: 0, createdAt: a.createdAt, updatedAt: a.updatedAt }, now));
    return listed.slice(offset, offset + limit);
  }

  listArtifacts(sort: string, query: string | null, helpOnly: boolean, limit: number, offset: number): ArtifactListing[] {
    const { clause, args } = this.search(query);
    const rows = this.sql.exec<ArtifactRow>(`SELECT * FROM artifacts WHERE hidden=0 AND visibility='public'${clause.replaceAll("name LIKE", "title LIKE")}${helpOnly ? " AND helpWanted<>''" : ""}`, ...args).toArray();
    const listed = rows.map((row) => this.artifactListing(row));
    const now = Date.now();
    if (sort === "new") listed.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "top") listed.sort((a, b) => b.remixes - a.remixes || b.stars - a.stars);
    else listed.sort((a, b) => trendingScore({ weekly: b.improvements, stars: b.stars, remixes: b.remixes, createdAt: b.createdAt, updatedAt: b.updatedAt }, now) - trendingScore({ weekly: a.improvements, stars: a.stars, remixes: a.remixes, createdAt: a.createdAt, updatedAt: a.updatedAt }, now));
    return listed.slice(offset, offset + limit);
  }

  home(uid: string | null): CommunityHome {
    const trendingPlugins = this.listPlugins("trending", null, null, 12, 0);
    const featured = trendingPlugins.filter((plugin) => plugin.installs >= 3 || plugin.stars >= 2).slice(0, 3).map((plugin) => ({ ...plugin, featured: true }));
    const totals = this.sql.exec<{ plugins: number; installs: number | null }>("SELECT COUNT(*) plugins, SUM(installs) installs FROM plugins WHERE hidden=0").one();
    const artifacts = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE hidden=0 AND visibility='public'").one().n;
    const creators = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM (SELECT ownerId FROM plugins WHERE hidden=0 UNION SELECT ownerId FROM artifacts WHERE hidden=0 AND visibility='public')").one().n;
    return {
      signedIn: uid !== null,
      featured: featured.length > 0 ? featured : trendingPlugins.slice(0, 3),
      trendingPlugins,
      trendingArtifacts: this.listArtifacts("trending", null, false, 8, 0),
      helpWanted: this.listArtifacts("new", null, true, 6, 0),
      totals: { plugins: totals.plugins, artifacts, creators, installs: totals.installs ?? 0 },
    };
  }

  plugin(id: string, uid: string | null): PluginDetail {
    const row = this.pluginRow(id);
    const versions = this.sql.exec<{ version: string; notes: string; at: number; available: number }>("SELECT version, notes, at, manifest IS NOT NULL AS available FROM plugin_versions WHERE pluginId=? ORDER BY at DESC, rowid DESC LIMIT 30", id).toArray()
      .map((row) => ({ version: row.version, notes: row.notes, at: row.at, available: row.available === 1 || row.version === JSON.parse(this.pluginRow(id).manifest).version }));
    return {
      ...this.pluginListing(row), manifest: JSON.parse(row.manifest) as PluginManifest, versions, remixes: row.remixes,
      starred: uid !== null && this.sql.exec("SELECT 1 FROM stars WHERE kind='plugin' AND targetId=? AND uid=?", id, uid).toArray().length > 0,
      installed: uid !== null && this.sql.exec("SELECT 1 FROM installs WHERE pluginId=? AND uid=? AND active=1", id, uid).toArray().length > 0,
    };
  }

  artifact(id: string, uid: string | null, key: string | null = null): ArtifactDetail {
    const row = this.artifactRow(id);
    const access = this.access(row, uid, key);
    const versions = this.sql.exec<{ version: number; message: string; authorId: string; authorName: string; at: number }>("SELECT version, message, authorId, authorName, at FROM artifact_versions WHERE artifactId=? ORDER BY version DESC LIMIT 50", id).toArray();
    const contributorNames = this.sql.exec<{ authorName: string }>("SELECT DISTINCT authorName FROM improvements WHERE artifactId=? AND status='accepted' LIMIT 30", id).toArray().map((one) => one.authorName);
    return {
      ...this.artifactListing(row, access), paths: JSON.parse(row.paths) as string[], readme: row.readme, versions, contributorNames,
      starred: uid !== null && this.sql.exec("SELECT 1 FROM stars WHERE kind='artifact' AND targetId=? AND uid=?", id, uid).toArray().length > 0,
    };
  }

  me(uid: string): CommunityMe {
    const display = this.sql.exec<{ name: string }>("SELECT name FROM names WHERE uid=?", uid).toArray()[0]?.name ?? "You";
    // A removed item is kept so people who installed or remixed it keep their copy, but it is
    // not something the owner still shares: it must not come back as a row with Stop sharing.
    const plugins = this.sql.exec<PluginRow>("SELECT * FROM plugins WHERE ownerId=? AND hidden<>2 ORDER BY updatedAt DESC", uid).toArray().map((row) => this.pluginListing(row));
    const artifacts = this.sql.exec<ArtifactRow>("SELECT * FROM artifacts WHERE ownerId=? AND hidden<>2 ORDER BY updatedAt DESC", uid).toArray().map((row) => this.artifactListing(row, "owner"));
    const inbox = this.sql.exec<ImprovementRow>("SELECT i.* FROM improvements i JOIN artifacts a ON a.id=i.artifactId WHERE a.ownerId=? ORDER BY CASE i.status WHEN 'open' THEN 0 ELSE 1 END, i.at DESC LIMIT 100", uid).toArray().map((row) => this.improvementSummary(row));
    const sent = this.sql.exec<ImprovementRow>("SELECT * FROM improvements WHERE authorId=? ORDER BY at DESC LIMIT 100", uid).toArray().map((row) => this.improvementSummary(row));
    const activity = this.sql.exec<Omit<ActivityItem, "read"> & { read: number }>("SELECT id, kind, text, targetKind, targetId, at, read FROM activity WHERE uid=? ORDER BY id DESC LIMIT 60", uid).toArray().map((row) => ({ ...row, read: row.read === 1 }));
    const unread = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM activity WHERE uid=? AND read=0", uid).one().n;
    return { profile: creatorProfile(uid, display, this.totals(uid)), plugins, artifacts, inbox, sent, activity, unread, monetization: this.monetization(uid) };
  }

  markRead(uid: string): void { this.sql.exec("UPDATE activity SET read=1 WHERE uid=?", uid); }

  /* ---------- plugins ---------- */

  publishPlugin(uid: string, ownerName: string, manifestInput: unknown, notesInput: unknown): PluginDetail {
    let manifest: PluginManifest;
    try { manifest = parsePluginManifest(manifestInput, BUILT_IN_SLASH); } catch (error) { return deny(400, error instanceof Error ? error.message : "That plugin is not valid."); }
    const notes = typeof notesInput === "string" ? notesInput.trim().slice(0, 1000) : "";
    const display = name(ownerName);
    this.spend(uid, "publishPlugin");
    return this.withBadges(uid, () => {
      const now = Date.now();
      const existing = this.sql.exec<PluginRow>("SELECT * FROM plugins WHERE id=?", manifest.id).toArray()[0];
      const fields = [display, manifest.name, manifest.description, manifest.icon, manifest.category, JSON.stringify(manifest.tags), manifest.version, JSON.stringify(manifest), describeContributions(manifest.contributes)] as const;
      if (existing !== undefined) {
        if (existing.ownerId !== uid) deny(409, `The id "${manifest.id}" belongs to another creator's plugin. Choose a different id.`);
        if (compareVersions(manifest.version, existing.version) <= 0) deny(409, `Version ${manifest.version} is not newer than the published ${existing.version}. Raise the version to publish an update.`);
        this.sql.exec("UPDATE plugins SET ownerName=?, name=?, description=?, icon=?, category=?, tags=?, version=?, manifest=?, contributes=?, updatedAt=?, hidden=CASE WHEN hidden=2 THEN 0 ELSE hidden END WHERE id=?", ...fields, now, manifest.id);
        for (const row of this.sql.exec<{ uid: string }>("SELECT uid FROM installs WHERE pluginId=? AND active=1 LIMIT 500", manifest.id).toArray()) {
          if (row.uid !== uid) this.notify(row.uid, "plugin.updated", `${manifest.name} ${manifest.version} is out${notes ? `: ${notes.slice(0, 120)}` : "."}`, "plugin", manifest.id);
        }
      } else {
        if (this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM plugins WHERE ownerId=?", uid).one().n >= MAX_OWNED.plugins) deny(409, `You can publish up to ${MAX_OWNED.plugins} plugins.`);
        this.sql.exec("INSERT INTO plugins(ownerId, ownerName, name, description, icon, category, tags, version, manifest, contributes, remixOf, createdAt, updatedAt, id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", uid, ...fields, manifest.remixOf, now, now, manifest.id);
        const source = /^plugin:(.+)$/.exec(manifest.remixOf ?? "")?.[1];
        const original = source ? this.sql.exec<PluginRow>("SELECT * FROM plugins WHERE id=?", source).toArray()[0] : undefined;
        if (original !== undefined && original.ownerId !== uid && this.sql.exec("SELECT 1 FROM remixes WHERE kind='plugin' AND targetId=? AND uid=?", original.id, uid).toArray().length === 0) {
          this.withBadges(original.ownerId, () => {
            this.sql.exec("INSERT INTO remixes VALUES('plugin',?,?,?)", original.id, uid, now);
            this.sql.exec("UPDATE plugins SET remixes=remixes+1 WHERE id=?", original.id);
          });
          this.notify(original.ownerId, "plugin.remixed", `${display} remixed ${original.name} into ${manifest.name}.`, "plugin", manifest.id);
        }
      }
      this.sql.exec("INSERT OR REPLACE INTO plugin_versions(pluginId, version, notes, at, manifest) VALUES(?,?,?,?,?)", manifest.id, manifest.version, notes, now, JSON.stringify(manifest));
      this.remember(uid, display);
      this.active(uid);
      return this.plugin(manifest.id, uid);
    });
  }

  /** One published version's manifest; the latest when `version` is null. */
  versionManifest(id: string, version: string | null): PluginManifest {
    const row = this.pluginRow(id);
    if (version === null || version === row.version) return JSON.parse(row.manifest) as PluginManifest;
    const stored = this.sql.exec<{ manifest: string | null }>("SELECT manifest FROM plugin_versions WHERE pluginId=? AND version=?", id, version).toArray()[0];
    if (stored === undefined) return deny(404, `${row.name} has no version ${version}.`);
    if (stored.manifest === null) return deny(410, `Version ${version} was published before older versions were kept. Install the latest instead.`);
    return JSON.parse(stored.manifest) as PluginManifest;
  }

  install(uid: string, id: string, version: string | null = null): PluginManifest {
    const row = this.pluginRow(id);
    const manifest = this.versionManifest(id, version);
    const previous = this.sql.exec<{ active: number }>("SELECT active FROM installs WHERE pluginId=? AND uid=?", id, uid).toArray()[0];
    if (previous === undefined) {
      this.spend(uid, "install");
      this.withBadges(row.ownerId, () => {
        this.sql.exec("INSERT INTO installs VALUES(?,?,?,1)", id, uid, Date.now());
        if (row.ownerId !== uid) this.sql.exec("UPDATE plugins SET installs=installs+1 WHERE id=?", id);
      });
      const total = row.installs + 1;
      if (row.ownerId !== uid && (total <= 3 || [10, 25, 50, 100, 250, 500, 1000, 5000, 10000].includes(total))) {
        this.notify(row.ownerId, "plugin.installed", total <= 3 ? `Somebody installed ${row.name}.` : `${row.name} reached ${total} installs.`, "plugin", id);
      }
    } else if (!previous.active) this.sql.exec("UPDATE installs SET active=1 WHERE pluginId=? AND uid=?", id, uid);
    return manifest;
  }

  uninstall(uid: string, id: string): void { this.sql.exec("UPDATE installs SET active=0 WHERE pluginId=? AND uid=?", id, uid); }

  /** Which of these installed plugins have a newer published version. */
  updates(installed: Readonly<Record<string, string>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, version] of Object.entries(installed).slice(0, 200)) {
      const row = this.sql.exec<{ version: string }>("SELECT version FROM plugins WHERE id=? AND hidden=0", id).toArray()[0];
      if (row !== undefined && compareVersions(row.version, version) > 0) result[id] = row.version;
    }
    return result;
  }

  removePlugin(uid: string, id: string): void {
    const row = this.pluginRow(id, true);
    if (row.ownerId !== uid) deny(403, "Only its creator can remove a plugin.");
    // Kept, hidden: people who installed it keep their copy, and the id stays theirs.
    this.sql.exec("UPDATE plugins SET hidden=2 WHERE id=?", id);
  }

  /* ---------- artifacts ---------- */

  async publishArtifact(uid: string, body: Record<string, unknown>): Promise<ArtifactDetail> {
    const snapshot = checkSnapshot(body["files"]);
    if (snapshot.problems.length > 0) deny(400, snapshot.problems.slice(0, 6).join(" "));
    const title = text(body["title"], "The title", 3, 80);
    const description = text(body["description"], "The description", 10, 500);
    const helpWanted = typeof body["helpWanted"] === "string" ? body["helpWanted"].trim().slice(0, 500) : "";
    const message = typeof body["message"] === "string" && body["message"].trim() ? body["message"].trim().slice(0, 300) : "Published";
    const chosenTags = tags(body["tags"]);
    const display = name(body["ownerName"]);
    const requestedVisibility = parseArtifactVisibility(body["visibility"]);
    if (body["visibility"] !== undefined && requestedVisibility === null) deny(400, "Choose public or private visibility.");
    const readme = snapshot.files.find((file) => /^readme(?:\.md|\.txt)?$/i.test(file.path))?.content.slice(0, 20_000) ?? "";
    const paths = JSON.stringify(snapshot.files.map((file) => file.path));
    this.spend(uid, "publishArtifact");
    const now = Date.now();
    let id: string;
    let version: number;
    if (typeof body["id"] === "string") {
      id = body["id"];
      const row = this.artifactRow(id, true);
      if (row.ownerId !== uid) deny(403, "Only the owner can publish a new version.");
      version = row.version + 1;
      const visibility = requestedVisibility ?? row.visibility;
      const shareKey = row.shareKey === "" ? newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16))) : row.shareKey;
      await this.env.ARTIFACT_VAULTS.getByName(id).putVersion(version, snapshot.files);
      this.sql.exec("UPDATE artifacts SET ownerName=?, title=?, description=?, tags=?, helpWanted=?, version=?, fileCount=?, bytes=?, readme=?, paths=?, updatedAt=?, visibility=?, shareKey=?, hidden=CASE WHEN hidden=2 THEN 0 ELSE hidden END WHERE id=?",
        display, title, description, JSON.stringify(chosenTags), helpWanted, version, snapshot.files.length, snapshot.bytes, readme, paths, now, visibility, shareKey, id);
    } else {
      if (this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM artifacts WHERE ownerId=? AND hidden<>2", uid).one().n >= MAX_OWNED.artifacts) deny(409, `You can share up to ${MAX_OWNED.artifacts} artifacts. Remove one to share another.`);
      id = newId();
      version = 1;
      const remixOf = typeof body["remixOf"] === "string" && ID.test(body["remixOf"]) ? body["remixOf"] : null;
      const visibility = requestedVisibility ?? "public";
      const shareKey = newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16)));
      await this.env.ARTIFACT_VAULTS.getByName(id).putVersion(version, snapshot.files);
      this.withBadges(uid, () => this.sql.exec("INSERT INTO artifacts(id, ownerId, ownerName, title, description, tags, helpWanted, version, fileCount, bytes, readme, paths, remixOf, createdAt, updatedAt, visibility, shareKey) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, uid, display, title, description, JSON.stringify(chosenTags), helpWanted, version, snapshot.files.length, snapshot.bytes, readme, paths, remixOf, now, now, visibility, shareKey));
    }
    this.sql.exec("INSERT OR REPLACE INTO artifact_versions VALUES(?,?,?,?,?,?)", id, version, message, uid, display, now);
    this.remember(uid, display);
    this.active(uid);
    return this.artifact(id, uid);
  }

  async files(id: string, versionInput: number | null, uid: string | null = null, key: string | null = null): Promise<ArtifactSnapshot> {
    const row = this.artifactRow(id);
    this.access(row, uid, key);
    const version = versionInput ?? row.version;
    const files = await this.env.ARTIFACT_VAULTS.getByName(id).getVersion(version);
    if (files === null) deny(410, `Version ${version} is no longer kept. Remix the latest version instead.`);
    return { id, title: row.title, version, files: files! };
  }

  async remix(uid: string, id: string, key: string | null = null): Promise<ArtifactSnapshot> {
    const row = this.artifactRow(id);
    this.access(row, uid, key);
    if (row.ownerId !== uid && this.sql.exec("SELECT 1 FROM remixes WHERE kind='artifact' AND targetId=? AND uid=?", id, uid).toArray().length === 0) {
      this.withBadges(row.ownerId, () => {
        this.sql.exec("INSERT INTO remixes VALUES('artifact',?,?,?)", id, uid, Date.now());
        this.sql.exec("UPDATE artifacts SET remixes=remixes+1 WHERE id=?", id);
      });
      const who = this.sql.exec<{ name: string }>("SELECT name FROM names WHERE uid=?", uid).toArray()[0]?.name ?? "Somebody";
      this.notify(row.ownerId, "artifact.remixed", `${who} remixed ${row.title}. Improvements they send will appear in your inbox.`, "artifact", id);
      this.active(uid);
    }
    return this.files(id, null, uid, key);
  }

  removeArtifact(uid: string, id: string): void {
    const row = this.artifactRow(id, true);
    if (row.ownerId !== uid) deny(403, "Only the owner can stop sharing an artifact.");
    this.sql.exec("UPDATE artifacts SET hidden=2 WHERE id=?", id);
  }

  share(uid: string, id: string): { visibility: ArtifactVisibility; shareCode: string } {
    const row = this.artifactRow(id, true);
    if (row.ownerId !== uid) deny(403, "Only the owner can share an artifact.");
    const shareKey = row.shareKey === "" ? newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16))) : row.shareKey;
    if (shareKey !== row.shareKey) this.sql.exec("UPDATE artifacts SET shareKey=? WHERE id=?", shareKey, id);
    return { visibility: row.visibility, shareCode: encodeArtifactShare(id, shareKey) };
  }

  setVisibility(uid: string, id: string, value: unknown): ArtifactDetail {
    const visibility = parseArtifactVisibility(value) ?? deny(400, "Choose public or private visibility.");
    const row = this.artifactRow(id, true);
    if (row.ownerId !== uid) deny(403, "Only the owner can change who sees an artifact.");
    const shareKey = row.shareKey === "" ? newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16))) : row.shareKey;
    this.sql.exec("UPDATE artifacts SET visibility=?, shareKey=? WHERE id=?", visibility, shareKey, id);
    return this.artifact(id, uid);
  }

  rotateShare(uid: string, id: string): { shareCode: string } {
    const row = this.artifactRow(id, true);
    if (row.ownerId !== uid) deny(403, "Only the owner can replace an artifact's share code.");
    const shareKey = newArtifactShareKey(crypto.getRandomValues(new Uint8Array(16)));
    this.sql.exec("UPDATE artifacts SET shareKey=? WHERE id=?", shareKey, id);
    return { shareCode: encodeArtifactShare(id, shareKey) };
  }

  shared(uid: string, codeInput: unknown): ArtifactDetail {
    if (typeof codeInput !== "string") return deny(400, "Paste the full artifact code.");
    const code = decodeArtifactShare(codeInput) ?? deny(400, "That artifact code is not valid. Paste the whole line that starts with adartifact:.");
    return this.artifact(code.id, uid, code.key);
  }

  async sendImprovement(uid: string, id: string, body: Record<string, unknown>, key: string | null = null): Promise<ImprovementSummary> {
    const row = this.artifactRow(id);
    this.access(row, uid, key);
    if (row.ownerId === uid) deny(409, "This is your own artifact. Publish a new version instead.");
    const baseVersion = typeof body["baseVersion"] === "number" && Number.isSafeInteger(body["baseVersion"]) && body["baseVersion"] >= 1 && body["baseVersion"] <= row.version ? body["baseVersion"] : deny(400, "The version this improvement started from is unknown.");
    const { changes, problems } = checkChanges(body["changes"]);
    if (problems.length > 0) deny(400, problems.slice(0, 6).join(" "));
    const title = text(body["title"], "The title", 3, 100);
    const message = typeof body["message"] === "string" ? body["message"].trim().slice(0, 4000) : "";
    const display = name(body["authorName"]);
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM improvements WHERE artifactId=? AND authorId=? AND status='open'", id, uid).one().n >= 5) deny(409, "You already have 5 improvements waiting on this artifact. Wait for the owner to review them.");
    this.spend(uid, "improvement");
    const improvementId = newId();
    await this.env.ARTIFACT_VAULTS.getByName(id).putChanges(improvementId, changes);
    const now = Date.now();
    this.sql.exec("INSERT INTO improvements(id, artifactId, baseVersion, authorId, authorName, title, message, status, files, at) VALUES(?,?,?,?,?,?,?,'open',?,?)", improvementId, id, baseVersion, uid, display, title, message, changes.length, now);
    this.notify(row.ownerId, "improvement.received", `${display} sent an improvement to ${row.title}: "${title}".`, "improvement", improvementId);
    this.remember(uid, display);
    this.active(uid);
    return this.improvementSummary(this.sql.exec<ImprovementRow>("SELECT * FROM improvements WHERE id=?", improvementId).one());
  }

  async improvement(uid: string, id: string, key: string | null = null): Promise<ImprovementDetail> {
    const row = this.sql.exec<ImprovementRow>("SELECT * FROM improvements WHERE id=?", id).toArray()[0] ?? deny(404, "That improvement does not exist.");
    const artifact = this.artifactRow(row.artifactId, true);
    if (artifact.ownerId !== uid && row.authorId !== uid) {
      if (artifact.hidden !== 0) deny(404, "That artifact is not shared any more.");
      this.access(artifact, uid, key);
      if (row.status !== "accepted") deny(403, "Only the artifact's owner and the improvement's author can read it before it is accepted.");
    }
    const vault = this.env.ARTIFACT_VAULTS.getByName(row.artifactId);
    const changes = await vault.getChanges(id) ?? [];
    const latest = row.status === "open" ? await vault.getVersion(artifact.version) : null;
    return { ...this.improvementSummary(row), changes, conflicts: latest === null ? [] : applyChanges(latest, changes).conflicts };
  }

  async decide(uid: string, id: string, accept: boolean, replyInput: unknown, force: boolean): Promise<ImprovementDetail> {
    const row = this.sql.exec<ImprovementRow>("SELECT * FROM improvements WHERE id=?", id).toArray()[0] ?? deny(404, "That improvement does not exist.");
    const artifact = this.artifactRow(row.artifactId, true);
    if (artifact.ownerId !== uid) deny(403, "Only the artifact's owner can accept or decline improvements.");
    if (row.status !== "open") deny(409, `This improvement was already ${row.status}.`);
    const reply = typeof replyInput === "string" ? replyInput.trim().slice(0, 2000) : "";
    const now = Date.now();
    if (!accept) {
      this.sql.exec("UPDATE improvements SET status='declined', reply=?, decidedAt=? WHERE id=?", reply, now, id);
      this.notify(row.authorId, "improvement.declined", `${artifact.ownerName} declined "${row.title}"${reply ? `: ${reply.slice(0, 160)}` : "."}`, "improvement", id);
      return this.improvement(uid, id);
    }
    const vault = this.env.ARTIFACT_VAULTS.getByName(row.artifactId);
    const latest = await vault.getVersion(artifact.version) ?? deny(410, "The latest version's files are missing.");
    const changes = await vault.getChanges(id) ?? deny(410, "This improvement's changes are missing.");
    const result = applyChanges(latest, changes, force);
    if (result.conflicts.length > 0) deny(409, `These files changed since the improvement was made: ${result.conflicts.slice(0, 8).join(", ")}. Review them, then choose "Accept, use theirs" to take the contributor's version.`);
    const check = checkSnapshot(result.files);
    if (check.problems.length > 0) deny(400, check.problems.slice(0, 4).join(" "));
    const version = artifact.version + 1;
    await vault.putVersion(version, check.files);
    this.withBadges(row.authorId, () => {
      this.sql.exec("UPDATE improvements SET status='accepted', reply=?, decidedAt=?, mergedVersion=? WHERE id=?", reply, now, version, id);
    });
    this.sql.exec("UPDATE artifacts SET version=?, fileCount=?, bytes=?, paths=?, updatedAt=? WHERE id=?", version, check.files.length, check.bytes, JSON.stringify(check.files.map((file) => file.path)), now, row.artifactId);
    this.sql.exec("INSERT OR REPLACE INTO artifact_versions VALUES(?,?,?,?,?,?)", row.artifactId, version, `${row.title} (from ${row.authorName})`, row.authorId, row.authorName, now);
    this.notify(row.authorId, "improvement.accepted", `${artifact.ownerName} accepted "${row.title}" into ${artifact.title} - it is version ${version} now.`, "improvement", id);
    this.active(uid);
    this.active(row.authorId);
    return this.improvement(uid, id);
  }

  /* ---------- stars, reports, waitlist ---------- */

  star(uid: string, kind: "plugin" | "artifact", id: string, on: boolean): { stars: number; starred: boolean } {
    const table = kind === "plugin" ? "plugins" : "artifacts";
    const row = kind === "plugin" ? this.pluginRow(id) : this.artifactRow(id);
    if (kind === "artifact" && (row as ArtifactRow).visibility !== "public" && (row as ArtifactRow).ownerId !== uid) deny(404, "That artifact is not listed.");
    const has = this.sql.exec("SELECT 1 FROM stars WHERE kind=? AND targetId=? AND uid=?", kind, id, uid).toArray().length > 0;
    if (on && !has) {
      this.spend(uid, "star");
      this.withBadges(row.ownerId, () => {
        this.sql.exec("INSERT INTO stars VALUES(?,?,?,?)", kind, id, uid, Date.now());
        this.sql.exec(`UPDATE ${table} SET stars=stars+1 WHERE id=?`, id);
      });
      if (row.ownerId !== uid) this.notify(row.ownerId, kind === "plugin" ? "plugin.starred" : "artifact.starred", `Somebody starred ${"name" in row ? row.name : row.title}.`, kind, id);
    } else if (!on && has) {
      this.sql.exec("DELETE FROM stars WHERE kind=? AND targetId=? AND uid=?", kind, id, uid);
      this.sql.exec(`UPDATE ${table} SET stars=MAX(0, stars-1) WHERE id=?`, id);
    }
    const stars = this.sql.exec<{ stars: number }>(`SELECT stars FROM ${table} WHERE id=?`, id).one().stars;
    return { stars, starred: on };
  }

  report(uid: string, kind: "plugin" | "artifact", id: string, reasonInput: unknown): void {
    const reason = text(reasonInput, "The reason", 5, 500);
    if (kind === "plugin") this.pluginRow(id); else {
      const artifact = this.artifactRow(id);
      if (artifact.visibility !== "public") deny(404, "That artifact is not listed.");
    }
    this.spend(uid, "report");
    this.sql.exec("INSERT OR REPLACE INTO reports VALUES(?,?,?,?,?)", kind, id, uid, reason, Date.now());
    // Five separate accounts reporting the same listing take it down until somebody looks.
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM reports WHERE kind=? AND targetId=?", kind, id).one().n;
    if (count >= 5) this.sql.exec(`UPDATE ${kind === "plugin" ? "plugins" : "artifacts"} SET hidden=1 WHERE id=? AND hidden=0`, id);
  }

  monetization(uid: string): CommunityMe["monetization"] {
    const row = this.sql.exec<{ price: number | null; at: number }>("SELECT price, at FROM waitlist WHERE uid=?", uid).toArray()[0];
    const waiting = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM waitlist").one().n;
    if (row === undefined) return { joined: false, price: null, position: null, waiting };
    const position = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM waitlist WHERE at<=?", row.at).one().n;
    return { joined: true, price: row.price, position, waiting };
  }

  joinWaitlist(uid: string, join: boolean, priceInput: unknown, noteInput: unknown): CommunityMe["monetization"] {
    if (!join) { this.sql.exec("DELETE FROM waitlist WHERE uid=?", uid); return this.monetization(uid); }
    let price: number | null;
    try { price = checkWaitlistPrice(priceInput); } catch (error) { return deny(400, error instanceof Error ? error.message : "Invalid price."); }
    const note = typeof noteInput === "string" ? noteInput.trim().slice(0, 500) : "";
    this.sql.exec("INSERT INTO waitlist VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET price=excluded.price, note=excluded.note", uid, price, note, Date.now());
    return this.monetization(uid);
  }
}

/* ---------- HTTP ---------- */

const respond = (value: unknown, status = 200, cache = false): Response => Response.json(value, {
  status,
  headers: {
    "cache-control": cache ? "public, max-age=60" : "no-store",
    // The website reads listings from the browser too.
    "access-control-allow-origin": "*",
  },
});

/** A JSON body read up to `limit` bytes, so a 2 MB artifact is fine and a 200 MB one is refused early. */
async function readJson(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) deny(413, "That is too large to send.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); deny(413, "That is too large to send."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return deny(400, "Invalid JSON."); }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) deny(400, "Expected an object.");
  return raw as Record<string, unknown>;
}

const clampInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const watching = (value: unknown): boolean => value === true;

/**
 * `/community/...`. `who` is the verified account, or null for an anonymous reader; the
 * caller has already checked the token, and only `who.uid` ever selects an account.
 */
export async function communityRoute(request: Request, env: Env, who: { uid: string; email?: string | null } | null): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" } });
  }
  const hub = env.COMMUNITY.getByName("global");
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const uid = who?.uid ?? null;
  const key = url.searchParams.get("key");
  const signedIn = (): string => {
    if (who === null) return deny(401, "Sign in to ADCode to do this.");
    if (!who.email) return deny(403, "Verify your email address to publish, install or send improvements.");
    return who.uid;
  };
  try {
    if (request.method === "GET") {
      const sort = url.searchParams.get("sort") ?? "trending";
      const query = url.searchParams.get("q");
      const limit = clampInt(url.searchParams.get("limit"), 30, 1, 60);
      const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
      if (path === "/community/home") return respond(await hub.home(uid), 200, uid === null);
      if (path === "/community/rooms") return respond(await hub.liveRooms(), 200, uid === null);
      if (path === "/community/plugins") return respond(await hub.listPlugins(sort, query, url.searchParams.get("category"), limit, offset), 200, uid === null);
      if (path === "/community/artifacts") return respond(await hub.listArtifacts(sort, query, url.searchParams.get("help") === "1", limit, offset), 200, uid === null);
      if (path === "/community/me") return respond(await hub.me(signedIn()));
      let match = /^\/community\/plugins\/([a-z0-9-]{3,48})$/.exec(path);
      if (match && PLUGIN_ROUTE_ID.test(match[1]!)) return respond(await hub.plugin(match[1]!, uid), 200, uid === null);
      match = /^\/community\/artifacts\/([a-z0-9]{12,40})$/.exec(path);
      if (match) return respond(await hub.artifact(match[1]!, uid, key), 200, uid === null);
      match = /^\/community\/artifacts\/([a-z0-9]{12,40})\/files$/.exec(path);
      if (match) { const account = signedIn(); const version = url.searchParams.get("version"); return respond(await hub.files(match[1]!, version === null ? null : clampInt(version, 1, 1, 1_000_000), account, key)); }
      match = /^\/community\/artifacts\/([a-z0-9]{12,40})\/room$/.exec(path);
      if (match) {
        const account = signedIn();
        await hub.accessFor(account, match[1]!, key);
        const snapshot = await env.ARTIFACT_ROOMS.getByName(match[1]!).snapshot(account);
        await hub.rememberRoom(snapshot);
        return respond(snapshot);
      }
      match = /^\/community\/improvements\/([a-z0-9]{12,40})$/.exec(path);
      if (match) return respond(await hub.improvement(signedIn(), match[1]!, key));
      return respond({ error: "Not found." }, 404);
    }
    if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
    const account = signedIn();
    const large = path === "/community/artifacts/publish" || path.endsWith("/improvements");
    const body = await readJson(request, large ? 6_000_000 : path === "/community/plugins/publish" ? 600_000 : 64_000);
    if (path === "/community/plugins/publish") return respond(await hub.publishPlugin(account, body["ownerName"] as string, body["manifest"], body["notes"]));
    if (path === "/community/plugins/updates") {
      const installed = typeof body["installed"] === "object" && body["installed"] !== null ? body["installed"] as Record<string, string> : {};
      return respond(await hub.updates(Object.fromEntries(Object.entries(installed).filter(([id, version]) => PLUGIN_ROUTE_ID.test(id) && typeof version === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version)))));
    }
    if (path === "/community/artifacts/publish") return respond(await hub.publishArtifact(account, body));
    if (path === "/community/artifacts/open") return respond(await hub.shared(account, body["code"]));
    if (path === "/community/activity/read") { await hub.markRead(account); return respond({ ok: true }); }
    if (path === "/community/star" || path === "/community/report") {
      const kind = body["kind"] === "plugin" || body["kind"] === "artifact" ? body["kind"] : deny(400, "Choose a plugin or an artifact.");
      const id = typeof body["id"] === "string" && (PLUGIN_ROUTE_ID.test(body["id"]) || ID.test(body["id"])) ? body["id"] : deny(400, "Choose a plugin or an artifact.");
      if (path === "/community/star") return respond(await hub.star(account, kind, id, body["on"] !== false));
      await hub.report(account, kind, id, body["reason"]);
      return respond({ ok: true });
    }
    if (path === "/community/monetize/waitlist") return respond(await hub.joinWaitlist(account, body["join"] !== false, body["price"], body["note"]));
    let match = /^\/community\/plugins\/([a-z0-9-]{3,48})\/(install|uninstall|delete)$/.exec(path);
    if (match && PLUGIN_ROUTE_ID.test(match[1]!)) {
      if (match[2] === "install") {
        const version = typeof body["version"] === "string" && /^d{1,5}.d{1,5}.d{1,5}$/.test(body["version"]) ? body["version"] : null;
        return respond({ manifest: await hub.install(account, match[1]!, version) });
      }
      if (match[2] === "uninstall") { await hub.uninstall(account, match[1]!); return respond({ ok: true }); }
      await hub.removePlugin(account, match[1]!);
      return respond({ ok: true });
    }
    match = /^\/community\/artifacts\/([a-z0-9]{12,40})\/(remix|delete|improvements|share|rotate|visibility)$/.exec(path);
    if (match) {
      const id = match[1]!;
      const bodyKey = typeof body["key"] === "string" ? body["key"] : null;
      if (match[2] === "remix") return respond(await hub.remix(account, id, bodyKey));
      if (match[2] === "improvements") return respond(await hub.sendImprovement(account, id, body, bodyKey));
      if (match[2] === "share") return respond(await hub.share(account, id));
      if (match[2] === "rotate") return respond(await hub.rotateShare(account, id));
      if (match[2] === "visibility") return respond(await hub.setVisibility(account, id, body["visibility"]));
      await hub.removeArtifact(account, id);
      return respond({ ok: true });
    }
    match = /^\/community\/artifacts\/([a-z0-9]{12,40})\/room\/(open|join|leave|close|action)$/.exec(path);
    if (match) {
      const id = match[1]!;
      const room = env.ARTIFACT_ROOMS.getByName(id);
      const access = await hub.accessFor(account, id, key);
      const step = match[2]!;
      if (step === "open") {
        if (access !== "owner") deny(403, "Only the owner can open this live room.");
        const detail = await hub.artifact(id, account);
        const display = typeof body["name"] === "string" ? body["name"] : deny(400, "Choose a display name.");
        const invite = typeof body["liveInvite"] === "string" ? body["liveInvite"] : null;
        const snapshot = await room.open(account, display, id, detail.title, invite, body["branch"], body["task"]);
        await hub.rememberRoom(snapshot);
        return respond(snapshot);
      }
      if (step === "join") {
        const display = typeof body["name"] === "string" ? body["name"] : deny(400, "Choose a display name.");
        const snapshot = await room.join(account, display, access === "owner" ? "owner" : "editor", watching(body["watching"]), body["hasAgent"], body["pushAccess"]);
        await hub.rememberRoom(snapshot);
        return respond(snapshot);
      }
      if (step === "leave") {
        const snapshot = await room.leave(account);
        await hub.rememberRoom(snapshot);
        return respond(snapshot);
      }
      if (step === "close") {
        if (access !== "owner") deny(403, "Only the owner can close this live room.");
        const snapshot = await room.close(account);
        await hub.rememberRoom(snapshot);
        return respond(snapshot);
      }
      const action = typeof body["action"] === "string" ? body["action"] : deny(400, "Choose an action.");
      let snapshot: ArtifactRoomSnapshot | null = null;
      if (action === "heartbeat") snapshot = await room.heartbeat(account, body);
      else if (action === "post") snapshot = await room.post(account, body["text"] as string, body["kind"]);
      else if (action === "plan") snapshot = await room.planAction(account, body);
      else if (action === "note") snapshot = await room.noteAction(account, body);
      else if (action === "comment") snapshot = await room.commentAction(account, body);
      else if (action === "lock") snapshot = await room.lockAction(account, body);
      else if (action === "handoff") snapshot = await room.handoff(account);
      else if (action === "offerHandoff") snapshot = await room.offerHandoff(account, body);
      else if (action === "acceptHandoff") snapshot = await room.acceptHandoff(account, body);
      else if (action === "requestApproval") snapshot = await room.requestApproval(account, body);
      else if (action === "decideApproval") snapshot = await room.decideApproval(account, body);
      else if (action === "takeover") snapshot = await room.takeover(account, body["targetUid"]);
      else if (action === "setRole") snapshot = await room.setRole(account, body["targetUid"] as string, body["role"]);
      else if (action === "setLive") {
        const invite = body["invite"] === null ? null : typeof body["invite"] === "string" ? body["invite"] : deny(400, "That live invite is not valid.");
        snapshot = await room.setLive(account, invite);
      } else deny(400, "Choose an action.");
      const result = snapshot ?? deny(400, "Choose an action.");
      await hub.rememberRoom(result);
      return respond(result);
    }
    match = /^\/community\/improvements\/([a-z0-9]{12,40})\/decide$/.exec(path);
    if (match) return respond(await hub.decide(account, match[1]!, body["accept"] === true, body["reply"], body["force"] === true));
    return respond({ error: "Not found." }, 404);
  } catch (error) {
    const message = (error instanceof Error ? error.message : "The community service is unavailable.").replace(/^remote exception: /, "").replace(/^Error: /, "");
    const status = /^\[(\d{3})\] /.exec(message);
    return respond({ error: status ? message.slice(6) : "The community service hit a problem. Please try again." }, status ? Number(status[1]) : 500);
  }
}
