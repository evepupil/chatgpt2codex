import { DatabaseSync } from "node:sqlite";
import type {
  ConversationBinding,
  RuntimeSession,
  Snapshot,
  WorkspaceSession,
} from "./contracts.js";

export const CURRENT_STATE_SCHEMA_VERSION = 1;

type SqlRow = Record<string, unknown>;

const MIGRATIONS: readonly string[] = [
  `
    CREATE TABLE runtime_sessions (
      session_id TEXT PRIMARY KEY,
      principal_id TEXT,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      current_snapshot_id TEXT
    );

    CREATE TABLE workspace_sessions (
      workspace_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id) ON DELETE CASCADE,
      root_path TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('direct', 'worktree')),
      source_root TEXT,
      base_sha TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE conversation_bindings (
      conversation_scope_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspace_sessions(workspace_id) ON DELETE CASCADE,
      target TEXT NOT NULL CHECK (target IN ('session', 'workspace')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE snapshots (
      snapshot_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspace_sessions(workspace_id) ON DELETE SET NULL,
      label TEXT,
      diff_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX workspace_sessions_session_id_idx ON workspace_sessions(session_id);
    CREATE INDEX conversation_bindings_session_id_idx ON conversation_bindings(session_id);
    CREATE INDEX snapshots_session_id_idx ON snapshots(session_id);
  `,
];

export class SqliteStateStore {
  private closed = false;

  private readonly database: DatabaseSync;

  constructor(filename: string) {
    const database = new DatabaseSync(filename);
    this.database = database;
    try {
      this.database.exec("PRAGMA foreign_keys = ON;");
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      this.migrate();
    } catch (error) {
      database.close();
      this.closed = true;
      throw error;
    }
  }

  get schemaVersion(): number {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get();
    return this.numberValue(row, "version");
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  transaction<T>(work: () => T): T {
    this.ensureOpen();
    this.database.exec("BEGIN");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  insertSession(session: RuntimeSession): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          INSERT INTO runtime_sessions
            (session_id, principal_id, project_id, status, created_at, updated_at, closed_at, current_snapshot_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.sessionId,
        session.principalId ?? null,
        session.projectId,
        session.status,
        session.createdAt,
        session.updatedAt,
        session.closedAt ?? null,
        session.currentSnapshotId ?? null,
      );
  }

  getSession(sessionId: string): RuntimeSession | undefined {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT * FROM runtime_sessions WHERE session_id = ?")
      .get(sessionId);
    return row === undefined ? undefined : this.toSession(row);
  }

  listSessions(): readonly RuntimeSession[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT * FROM runtime_sessions ORDER BY created_at, session_id")
      .all()
      .map((row) => this.toSession(row));
  }

  updateSession(session: RuntimeSession): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          UPDATE runtime_sessions
          SET principal_id = ?, project_id = ?, status = ?, updated_at = ?, closed_at = ?, current_snapshot_id = ?
          WHERE session_id = ?
        `,
      )
      .run(
        session.principalId ?? null,
        session.projectId,
        session.status,
        session.updatedAt,
        session.closedAt ?? null,
        session.currentSnapshotId ?? null,
        session.sessionId,
      );
  }

  insertWorkspaceSession(workspace: WorkspaceSession): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          INSERT INTO workspace_sessions
            (workspace_id, session_id, root_path, mode, source_root, base_sha, status, created_at, updated_at, closed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        workspace.workspaceId,
        workspace.sessionId,
        workspace.rootPath,
        workspace.mode,
        workspace.sourceRoot ?? null,
        workspace.baseSha ?? null,
        workspace.status,
        workspace.createdAt,
        workspace.updatedAt,
        workspace.closedAt ?? null,
      );
  }

  getWorkspaceSession(workspaceId: string): WorkspaceSession | undefined {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT * FROM workspace_sessions WHERE workspace_id = ?")
      .get(workspaceId);
    return row === undefined ? undefined : this.toWorkspaceSession(row);
  }

  listWorkspaceSessions(): readonly WorkspaceSession[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT * FROM workspace_sessions ORDER BY created_at, workspace_id")
      .all()
      .map((row) => this.toWorkspaceSession(row));
  }

  updateWorkspaceSession(workspace: WorkspaceSession): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          UPDATE workspace_sessions
          SET session_id = ?, root_path = ?, mode = ?, source_root = ?, base_sha = ?, status = ?, updated_at = ?, closed_at = ?
          WHERE workspace_id = ?
        `,
      )
      .run(
        workspace.sessionId,
        workspace.rootPath,
        workspace.mode,
        workspace.sourceRoot ?? null,
        workspace.baseSha ?? null,
        workspace.status,
        workspace.updatedAt,
        workspace.closedAt ?? null,
        workspace.workspaceId,
      );
  }

  deleteWorkspaceSession(workspaceId: string): readonly string[] {
    return this.transaction(() => {
      const bindings = this.database
        .prepare("SELECT conversation_scope_id FROM conversation_bindings WHERE workspace_id = ?")
        .all(workspaceId)
        .map((row) => this.stringValue(row, "conversation_scope_id"));
      this.database
        .prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?")
        .run(workspaceId);
      return bindings;
    });
  }

  upsertConversationBinding(binding: ConversationBinding): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          INSERT INTO conversation_bindings
            (conversation_scope_id, session_id, workspace_id, target, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(conversation_scope_id) DO UPDATE SET
            session_id = excluded.session_id,
            workspace_id = excluded.workspace_id,
            target = excluded.target,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        binding.conversationScopeId,
        binding.sessionId,
        binding.workspaceId ?? null,
        binding.target,
        binding.createdAt,
        binding.updatedAt,
      );
  }

  getConversationBinding(conversationScopeId: string): ConversationBinding | undefined {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT * FROM conversation_bindings WHERE conversation_scope_id = ?")
      .get(conversationScopeId);
    return row === undefined ? undefined : this.toConversationBinding(row);
  }

  listConversationBindings(): readonly ConversationBinding[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT * FROM conversation_bindings ORDER BY created_at, conversation_scope_id")
      .all()
      .map((row) => this.toConversationBinding(row));
  }

  deleteConversationBinding(conversationScopeId: string): void {
    this.ensureOpen();
    this.database
      .prepare("DELETE FROM conversation_bindings WHERE conversation_scope_id = ?")
      .run(conversationScopeId);
  }

  insertSnapshot(snapshot: Snapshot): void {
    this.ensureOpen();
    this.database
      .prepare(
        `
          INSERT INTO snapshots
            (snapshot_id, session_id, workspace_id, label, diff_json, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        snapshot.snapshotId,
        snapshot.sessionId,
        snapshot.workspaceId ?? null,
        snapshot.label ?? null,
        JSON.stringify(snapshot.diff),
        JSON.stringify(snapshot.metadata),
        snapshot.createdAt,
      );
  }

  getSnapshot(snapshotId: string): Snapshot | undefined {
    this.ensureOpen();
    const row = this.database
      .prepare("SELECT * FROM snapshots WHERE snapshot_id = ?")
      .get(snapshotId);
    return row === undefined ? undefined : this.toSnapshot(row);
  }

  listSnapshots(sessionId: string): readonly Snapshot[] {
    this.ensureOpen();
    return this.database
      .prepare("SELECT * FROM snapshots WHERE session_id = ? ORDER BY created_at, snapshot_id")
      .all(sessionId)
      .map((row) => this.toSnapshot(row));
  }

  private migrate(): void {
    const currentVersion = this.schemaVersion;
    if (currentVersion > CURRENT_STATE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported state schema version: ${currentVersion}; expected ${CURRENT_STATE_SCHEMA_VERSION}`,
      );
    }

    for (let index = currentVersion; index < CURRENT_STATE_SCHEMA_VERSION; index += 1) {
      const migration = MIGRATIONS[index];
      if (migration === undefined) {
        throw new Error(`Missing state migration for version ${index + 1}`);
      }

      const version = index + 1;
      this.transaction(() => {
        this.database.exec(migration);
        this.database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(version, new Date().toISOString());
      });
    }
  }

  private toSession(row: SqlRow): RuntimeSession {
    return {
      sessionId: this.stringValue(row, "session_id"),
      principalId: this.optionalStringValue(row, "principal_id"),
      projectId: this.stringValue(row, "project_id"),
      status: this.stringValue(row, "status") as RuntimeSession["status"],
      createdAt: this.stringValue(row, "created_at"),
      updatedAt: this.stringValue(row, "updated_at"),
      closedAt: this.optionalStringValue(row, "closed_at"),
      currentSnapshotId: this.optionalStringValue(row, "current_snapshot_id"),
    };
  }

  private toWorkspaceSession(row: SqlRow): WorkspaceSession {
    return {
      workspaceId: this.stringValue(row, "workspace_id"),
      sessionId: this.stringValue(row, "session_id"),
      rootPath: this.stringValue(row, "root_path"),
      mode: this.stringValue(row, "mode") as WorkspaceSession["mode"],
      sourceRoot: this.optionalStringValue(row, "source_root"),
      baseSha: this.optionalStringValue(row, "base_sha"),
      status: this.stringValue(row, "status") as WorkspaceSession["status"],
      createdAt: this.stringValue(row, "created_at"),
      updatedAt: this.stringValue(row, "updated_at"),
      closedAt: this.optionalStringValue(row, "closed_at"),
    };
  }

  private toConversationBinding(row: SqlRow): ConversationBinding {
    return {
      conversationScopeId: this.stringValue(row, "conversation_scope_id"),
      sessionId: this.stringValue(row, "session_id"),
      workspaceId: this.optionalStringValue(row, "workspace_id"),
      target: this.stringValue(row, "target") as ConversationBinding["target"],
      createdAt: this.stringValue(row, "created_at"),
      updatedAt: this.stringValue(row, "updated_at"),
    };
  }

  private toSnapshot(row: SqlRow): Snapshot {
    return {
      snapshotId: this.stringValue(row, "snapshot_id"),
      sessionId: this.stringValue(row, "session_id"),
      workspaceId: this.optionalStringValue(row, "workspace_id"),
      label: this.optionalStringValue(row, "label"),
      diff: JSON.parse(this.stringValue(row, "diff_json")) as Snapshot["diff"],
      metadata: JSON.parse(this.stringValue(row, "metadata_json")) as Snapshot["metadata"],
      createdAt: this.stringValue(row, "created_at"),
    };
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("State store is closed");
    }
  }

  private stringValue(row: SqlRow | undefined, column: string): string {
    const value = row?.[column];
    if (typeof value !== "string") {
      throw new Error(`Expected string column: ${column}`);
    }
    return value;
  }

  private optionalStringValue(row: SqlRow, column: string): string | undefined {
    const value = row[column];
    if (value === null || value === undefined) {
      return undefined;
    }
    return this.stringValue(row, column);
  }

  private numberValue(row: SqlRow | undefined, column: string): number {
    const value = row?.[column];
    if (typeof value !== "number") {
      throw new Error(`Expected numeric column: ${column}`);
    }
    return value;
  }
}
