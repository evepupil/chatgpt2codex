import type { CreateSessionInput, RuntimeSession } from "./contracts.js";
import {
  nextStateId,
  currentTimestamp,
  requireNonEmpty,
  type StateManagerOptions,
} from "./options.js";
import { SqliteStateStore } from "./sqlite-state-store.js";

export class SessionManager {
  constructor(
    private readonly store: SqliteStateStore,
    private readonly options: StateManagerOptions = {},
  ) {}

  create(input: CreateSessionInput): RuntimeSession {
    const sessionId = requireNonEmpty(input.sessionId ?? nextStateId(this.options), "sessionId");
    const projectId = requireNonEmpty(input.projectId, "projectId");
    const principalId =
      input.principalId === undefined
        ? undefined
        : requireNonEmpty(input.principalId, "principalId");
    const timestamp = currentTimestamp(this.options);
    const session: RuntimeSession = {
      sessionId,
      principalId,
      projectId,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: undefined,
      currentSnapshotId: undefined,
    };

    this.store.insertSession(session);
    return session;
  }

  get(sessionId: string): RuntimeSession | undefined {
    return this.store.getSession(requireNonEmpty(sessionId, "sessionId"));
  }

  list(): readonly RuntimeSession[] {
    return this.store.listSessions();
  }

  restore(sessionId: string): RuntimeSession {
    const session = this.requireSession(sessionId);
    if (session.status !== "active") {
      throw new Error(`Session is closed: ${session.sessionId}`);
    }
    return session;
  }

  touch(sessionId: string): RuntimeSession {
    const session = this.requireActiveSession(sessionId);
    const updated: RuntimeSession = {
      ...session,
      updatedAt: currentTimestamp(this.options),
    };
    this.store.updateSession(updated);
    return updated;
  }

  close(sessionId: string): RuntimeSession {
    const session = this.requireSession(sessionId);
    if (session.status === "closed") {
      return session;
    }

    const timestamp = currentTimestamp(this.options);
    const closed: RuntimeSession = {
      ...session,
      status: "closed",
      updatedAt: timestamp,
      closedAt: timestamp,
    };
    this.store.updateSession(closed);
    return closed;
  }

  rollback(sessionId: string, snapshotId: string): RuntimeSession {
    const session = this.requireActiveSession(sessionId);
    const snapshot = this.store.getSnapshot(requireNonEmpty(snapshotId, "snapshotId"));
    if (snapshot === undefined) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    if (snapshot.sessionId !== session.sessionId) {
      throw new Error(`Snapshot does not belong to session: ${snapshotId}`);
    }

    const rolledBack: RuntimeSession = {
      ...session,
      updatedAt: currentTimestamp(this.options),
      currentSnapshotId: snapshot.snapshotId,
    };
    this.store.updateSession(rolledBack);
    return rolledBack;
  }

  private requireSession(sessionId: string): RuntimeSession {
    const normalizedId = requireNonEmpty(sessionId, "sessionId");
    const session = this.store.getSession(normalizedId);
    if (session === undefined) {
      throw new Error(`Session not found: ${normalizedId}`);
    }
    return session;
  }

  private requireActiveSession(sessionId: string): RuntimeSession {
    const session = this.requireSession(sessionId);
    if (session.status !== "active") {
      throw new Error(`Session is closed: ${session.sessionId}`);
    }
    return session;
  }
}
