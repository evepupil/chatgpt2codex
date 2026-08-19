import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CURRENT_STATE_SCHEMA_VERSION,
  SqliteStateStore,
} from "../../src/state/sqlite-state-store.js";

describe("SqliteStateStore", () => {
  it("creates the current schema and rejects a newer schema version", () => {
    const store = new SqliteStateStore(":memory:");
    expect(store.schemaVersion).toBe(CURRENT_STATE_SCHEMA_VERSION);
    store.close();

    const directory = mkdtempSync(join(tmpdir(), "chatgpt2codex-schema-"));
    const databasePath = join(directory, "future.sqlite");
    try {
      const database = new DatabaseSync(databasePath);
      database.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(CURRENT_STATE_SCHEMA_VERSION + 1, new Date().toISOString());
      database.close();

      expect(() => new SqliteStateStore(databasePath)).toThrow("Unsupported state schema version");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
