import { statSync } from "node:fs";
import type { StateRecoveryReport } from "./contracts.js";
import { ConversationBindingManager } from "./conversation-binding-manager.js";
import { SessionManager } from "./session-manager.js";
import { SnapshotManager } from "./snapshot-manager.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import type { StateManagerOptions } from "./options.js";
import { WorkspaceSessionManager } from "./workspace-session-manager.js";

export interface RuntimeStateOptions extends StateManagerOptions {
  readonly pathExists?: (rootPath: string) => boolean;
}

export class RuntimeState {
  readonly store: SqliteStateStore;
  readonly sessions: SessionManager;
  readonly workspaces: WorkspaceSessionManager;
  readonly bindings: ConversationBindingManager;
  readonly snapshots: SnapshotManager;

  private readonly pathExists: (rootPath: string) => boolean;

  constructor(filename: string, options: RuntimeStateOptions = {}) {
    this.store = new SqliteStateStore(filename);
    this.sessions = new SessionManager(this.store, options);
    this.workspaces = new WorkspaceSessionManager(this.store, this.sessions, options);
    this.bindings = new ConversationBindingManager(
      this.store,
      this.sessions,
      this.workspaces,
      options,
    );
    this.snapshots = new SnapshotManager(this.store, this.sessions, this.workspaces, options);
    this.pathExists = options.pathExists ?? this.defaultPathExists;
    this.recover();
  }

  static inMemory(options: RuntimeStateOptions = {}): RuntimeState {
    return new RuntimeState(":memory:", options);
  }

  recover(): StateRecoveryReport {
    const removedWorkspaceIds: string[] = [];
    const removedBindingIds: string[] = [];
    for (const workspace of this.workspaces.list()) {
      if (this.pathExists(workspace.rootPath)) {
        continue;
      }
      removedWorkspaceIds.push(workspace.workspaceId);
      removedBindingIds.push(...this.workspaces.remove(workspace.workspaceId));
    }

    return {
      activeSessionIds: this.sessions
        .list()
        .filter((session) => session.status === "active")
        .map((session) => session.sessionId),
      removedWorkspaceIds,
      removedBindingIds,
    };
  }

  rollbackSession(sessionId: string, snapshotId: string) {
    return this.sessions.rollback(sessionId, snapshotId);
  }

  close(): void {
    this.store.close();
  }

  private defaultPathExists(rootPath: string): boolean {
    try {
      return statSync(rootPath).isDirectory();
    } catch {
      return false;
    }
  }
}

export type { StateManagerOptions } from "./options.js";
