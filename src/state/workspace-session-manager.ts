import { isAbsolute } from "node:path";
import type { CreateWorkspaceSessionInput, RuntimeSession, WorkspaceSession } from "./contracts.js";
import { currentTimestamp, requireNonEmpty, type StateManagerOptions } from "./options.js";
import { SessionManager } from "./session-manager.js";
import { SqliteStateStore } from "./sqlite-state-store.js";

export class WorkspaceSessionManager {
  constructor(
    private readonly store: SqliteStateStore,
    private readonly sessions: SessionManager,
    private readonly options: StateManagerOptions = {},
  ) {}

  create(input: CreateWorkspaceSessionInput): WorkspaceSession {
    const session = this.sessions.restore(input.sessionId);
    const workspaceId = requireNonEmpty(input.workspaceId, "workspaceId");
    const rootPath = requireNonEmpty(input.rootPath, "rootPath");
    if (!isAbsolute(rootPath)) {
      throw new Error("rootPath must be absolute");
    }

    const sourceRoot =
      input.sourceRoot === undefined ? undefined : requireNonEmpty(input.sourceRoot, "sourceRoot");
    if (sourceRoot !== undefined && !isAbsolute(sourceRoot)) {
      throw new Error("sourceRoot must be absolute");
    }

    const timestamp = currentTimestamp(this.options);
    const workspace: WorkspaceSession = {
      workspaceId,
      sessionId: session.sessionId,
      rootPath,
      mode: input.mode,
      sourceRoot,
      baseSha: input.baseSha,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: undefined,
    };
    this.store.insertWorkspaceSession(workspace);
    return workspace;
  }

  get(workspaceId: string): WorkspaceSession | undefined {
    return this.store.getWorkspaceSession(requireNonEmpty(workspaceId, "workspaceId"));
  }

  list(): readonly WorkspaceSession[] {
    return this.store.listWorkspaceSessions();
  }

  close(workspaceId: string): WorkspaceSession {
    const workspace = this.requireWorkspace(workspaceId);
    if (workspace.status === "closed") {
      return workspace;
    }

    const timestamp = currentTimestamp(this.options);
    const closed: WorkspaceSession = {
      ...workspace,
      status: "closed",
      updatedAt: timestamp,
      closedAt: timestamp,
    };
    this.store.updateWorkspaceSession(closed);
    return closed;
  }

  requireForSession(workspaceId: string, session: RuntimeSession): WorkspaceSession {
    const workspace = this.requireWorkspace(workspaceId);
    if (workspace.sessionId !== session.sessionId) {
      throw new Error(`Workspace does not belong to session: ${workspace.workspaceId}`);
    }
    if (workspace.status !== "active") {
      throw new Error(`Workspace session is closed: ${workspace.workspaceId}`);
    }
    return workspace;
  }

  remove(workspaceId: string): readonly string[] {
    return this.store.deleteWorkspaceSession(requireNonEmpty(workspaceId, "workspaceId"));
  }

  private requireWorkspace(workspaceId: string): WorkspaceSession {
    const normalizedId = requireNonEmpty(workspaceId, "workspaceId");
    const workspace = this.store.getWorkspaceSession(normalizedId);
    if (workspace === undefined) {
      throw new Error(`Workspace session not found: ${normalizedId}`);
    }
    return workspace;
  }
}
