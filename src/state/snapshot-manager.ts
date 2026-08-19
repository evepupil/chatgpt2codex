import { isAbsolute } from "node:path";
import type { CreateSnapshotInput, Snapshot } from "./contracts.js";
import {
  nextStateId,
  currentTimestamp,
  requireNonEmpty,
  type StateManagerOptions,
} from "./options.js";
import { SessionManager } from "./session-manager.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import { WorkspaceSessionManager } from "./workspace-session-manager.js";

export class SnapshotManager {
  constructor(
    private readonly store: SqliteStateStore,
    private readonly sessions: SessionManager,
    private readonly workspaces: WorkspaceSessionManager,
    private readonly options: StateManagerOptions = {},
  ) {}

  create(input: CreateSnapshotInput): Snapshot {
    const session = this.sessions.restore(input.sessionId);
    const workspaceId =
      input.workspaceId === undefined
        ? undefined
        : this.workspaces.requireForSession(input.workspaceId, session).workspaceId;
    const diff = input.diff.map((entry) => this.validateDiffEntry(entry));
    const metadata = input.metadata ?? {};
    try {
      JSON.stringify(metadata);
    } catch (error) {
      throw new Error(`Snapshot metadata is not serializable: ${this.errorMessage(error)}`);
    }

    const snapshot: Snapshot = {
      snapshotId: requireNonEmpty(input.snapshotId ?? nextStateId(this.options), "snapshotId"),
      sessionId: session.sessionId,
      workspaceId,
      label: input.label === undefined ? undefined : requireNonEmpty(input.label, "label"),
      diff,
      metadata,
      createdAt: currentTimestamp(this.options),
    };
    this.store.insertSnapshot(snapshot);
    return snapshot;
  }

  get(snapshotId: string): Snapshot | undefined {
    return this.store.getSnapshot(requireNonEmpty(snapshotId, "snapshotId"));
  }

  list(sessionId: string): readonly Snapshot[] {
    this.sessions.restore(sessionId);
    return this.store.listSnapshots(sessionId);
  }

  private validateDiffEntry(entry: Snapshot["diff"][number]): Snapshot["diff"][number] {
    const path = requireNonEmpty(entry.path, "diff.path");
    if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) {
      throw new Error(`Snapshot diff path must be relative: ${path}`);
    }
    if (entry.size !== undefined && (!Number.isInteger(entry.size) || entry.size < 0)) {
      throw new Error(`Snapshot diff size must be a non-negative integer: ${path}`);
    }
    return {
      path,
      change: entry.change,
      size: entry.size,
      sha256: entry.sha256,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
  }
}
