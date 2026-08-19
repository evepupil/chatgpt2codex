export type SessionStatus = "active" | "closed";

export interface RuntimeSession {
  readonly sessionId: string;
  readonly principalId: string | undefined;
  readonly projectId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | undefined;
  readonly currentSnapshotId: string | undefined;
}

export interface CreateSessionInput {
  readonly sessionId?: string;
  readonly principalId?: string;
  readonly projectId: string;
}

export type WorkspaceMode = "direct" | "worktree";
export type WorkspaceSessionStatus = "active" | "closed";

export interface WorkspaceSession {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly rootPath: string;
  readonly mode: WorkspaceMode;
  readonly sourceRoot: string | undefined;
  readonly baseSha: string | undefined;
  readonly status: WorkspaceSessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | undefined;
}

export interface CreateWorkspaceSessionInput {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly rootPath: string;
  readonly mode: WorkspaceMode;
  readonly sourceRoot?: string;
  readonly baseSha?: string;
}

export type ConversationBindingTarget = "session" | "workspace";

export interface ConversationBinding {
  readonly conversationScopeId: string;
  readonly sessionId: string;
  readonly workspaceId: string | undefined;
  readonly target: ConversationBindingTarget;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BindConversationInput {
  readonly conversationScopeId: string;
  readonly sessionId: string;
  readonly workspaceId?: string;
  readonly target: ConversationBindingTarget;
}

export type FileDiffChange = "added" | "modified" | "deleted";

export interface FileDiffMetadata {
  readonly path: string;
  readonly change: FileDiffChange;
  readonly size: number | undefined;
  readonly sha256: string | undefined;
}

export interface Snapshot {
  readonly snapshotId: string;
  readonly sessionId: string;
  readonly workspaceId: string | undefined;
  readonly label: string | undefined;
  readonly diff: readonly FileDiffMetadata[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CreateSnapshotInput {
  readonly snapshotId?: string;
  readonly sessionId: string;
  readonly workspaceId?: string;
  readonly label?: string;
  readonly diff: readonly FileDiffMetadata[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StateRecoveryReport {
  readonly activeSessionIds: readonly string[];
  readonly removedWorkspaceIds: readonly string[];
  readonly removedBindingIds: readonly string[];
}
