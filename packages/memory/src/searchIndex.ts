/**
 * Full-text search over the memory store, backed by SQLite FTS5.
 *
 * Brief §5.1: "Markdown is the source of truth; SQLite is a cache. Deleting
 * `index.sqlite` must be a fully recoverable operation - rebuild it from the files."
 * That rule shapes everything here: the index holds no fact that is not also in a
 * markdown file, and any failure to open or read it is answered by rebuilding rather
 * than by repairing.
 *
 * Uses Node 24's built-in `node:sqlite`, so the memory store needs no native module and
 * no build step - which matters because the standalone MCP binary has to run wherever
 * the user's agent spawns it.
 *
 * Embeddings are named in §5.1 alongside FTS5 and are deliberately *not* here: they need
 * an embedding provider, which is the AI slice's business. Adding an empty table for
 * them now would be speculation, not preparation.
 */
import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MemoryKind, MemoryRecord, SearchHit } from "./types.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export interface SearchIndex {
  rebuild(records: readonly MemoryRecord[]): void;
  search(query: string, kind?: MemoryKind, limit?: number): SearchHit[];
  close(): void;
}

/**
 * Turn a free-text query into a safe FTS5 MATCH expression.
 *
 * FTS5 has its own query language - `OR`, `NEAR`, `*`, `^`, column filters, quoting -
 * and the query here arrives from whatever agent is connected. Rather than trying to
 * sanitise that language, every run of word characters is extracted and re-quoted as a
 * literal, which makes operator syntax simply unreachable. A doubled quote is FTS5's own
 * escape for a quote inside a quoted string.
 */
function toMatchExpression(query: string): string | null {
  if (typeof query !== "string") return null;

  const tokens = query.match(/[\p{L}\p{N}_]+/gu);
  if (tokens === null || tokens.length === 0) return null;

  return tokens
    .slice(0, 16)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" ");
}

export function createSearchIndex(databasePath: string): SearchIndex {
  let db: DatabaseSync | null = null;

  const SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
       name, description, body,
       kind UNINDEXED, created UNINDEXED,
       tokenize = 'porter unicode61'
     )`;

  /**
   * Opening is where corruption surfaces, and not where you would expect: `DatabaseSync`
   * constructs lazily, so a file that is not a database only errors on the first
   * statement. Both the pragma and the schema therefore run inside the attempt.
   */
  function tryOpen(): DatabaseSync {
    const database = new DatabaseSync(databasePath);

    try {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec(SCHEMA);
      return database;
    } catch (error) {
      // The handle is opened here, so it has to be released here. Leaving it dangling
      // is invisible on Linux and fatal on Windows, where the failed file then cannot be
      // unlinked at all.
      try {
        database.close();
      } catch {
        // Already unusable.
      }
      throw error;
    }
  }

  function open(): DatabaseSync {
    if (db !== null) return db;

    try {
      db = tryOpen();
      return db;
    } catch {
      // A corrupt or unreadable index is a cache miss, not a failure. Discarding it is
      // always safe precisely because markdown is the source of truth - there is nothing
      // in this file that cannot be regenerated from the .md files.
      try {
        db?.close();
      } catch {
        // Already unusable.
      }
      db = null;

      // Windows will not unlink a file while a handle is open, so the close above is
      // load-bearing rather than tidiness. The WAL sidecars go too: leaving them beside
      // a fresh database is its own corruption.
      for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
        try {
          unlinkSync(path);
        } catch {
          // Nothing to remove.
        }
      }

      db = tryOpen();
      return db;
    }
  }

  return {
    rebuild(records: readonly MemoryRecord[]): void {
      const database = open();

      // Replace wholesale. An incremental update would have to track deletions, and a
      // missed one leaves a memory findable after the user deleted the file - the exact
      // failure §5.1's "point at, open, edit, and delete" promise cannot tolerate.
      database.exec("DELETE FROM memories");

      const insert = database.prepare(
        "INSERT INTO memories (name, description, body, kind, created) VALUES (?, ?, ?, ?, ?)",
      );

      database.exec("BEGIN");
      try {
        for (const record of records) {
          insert.run(record.name, record.description, record.body, record.type, record.created);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    search(query: string, kind?: MemoryKind, limit = DEFAULT_LIMIT): SearchHit[] {
      const match = toMatchExpression(query);
      if (match === null) return [];

      const capped = Math.max(1, Math.min(Math.floor(limit) || DEFAULT_LIMIT, MAX_LIMIT));
      const database = open();

      const sql =
        `SELECT name, description, kind, created, rank,
                snippet(memories, 2, '', '', '…', 12) AS snippet
         FROM memories
         WHERE memories MATCH ?` +
        (kind === undefined ? "" : " AND kind = ?") +
        " ORDER BY rank LIMIT ?";

      try {
        const statement = database.prepare(sql);
        const rows = (
          kind === undefined ? statement.all(match, capped) : statement.all(match, kind, capped)
        ) as Array<Record<string, unknown>>;

        return rows.map((row) => ({
          name: String(row["name"]),
          description: String(row["description"]),
          type: String(row["kind"]) as MemoryKind,
          created: String(row["created"]),
          rank: Number(row["rank"]),
          snippet: String(row["snippet"] ?? ""),
        }));
      } catch {
        // A malformed MATCH should be impossible after `toMatchExpression`, but a search
        // that returns nothing is a far better outcome than one that throws into an
        // agent's tool call.
        return [];
      }
    },

    close(): void {
      db?.close();
      db = null;
    },
  };
}
