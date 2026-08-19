import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { RuntimeState } from "../../src/state/runtime-state.js";

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "chatgpt2codex-state-"));
}

describe("RuntimeState", () => {
  it("persists sessions, bindings, and snapshots across state store reopen", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "runtime.sqlite");
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 7, 20, 0, 0, tick++));

    try {
      const first = new RuntimeState(databasePath, { now });
      const session = first.sessions.create({
        sessionId: "session-1",
        principalId: "owner",
        projectId: "project-1",
      });
      const workspace = first.workspaces.create({
        workspaceId: "workspace-1",
        sessionId: session.sessionId,
        rootPath: directory,
        mode: "direct",
      });
      first.bindings.bind({
        conversationScopeId: "conversation-1",
        sessionId: session.sessionId,
        workspaceId: workspace.workspaceId,
        target: "workspace",
      });
      const snapshot = first.snapshots.create({
        snapshotId: "snapshot-1",
        sessionId: session.sessionId,
        workspaceId: workspace.workspaceId,
        label: "before change",
        diff: [
          {
            path: "src/index.ts",
            change: "modified",
            size: 42,
            sha256: "abc123",
          },
        ],
        metadata: { source: "test" },
      });
      const touched = first.sessions.touch(session.sessionId);
      const rolledBack = first.rollbackSession(session.sessionId, snapshot.snapshotId);

      expect(touched.updatedAt).not.toBe(session.updatedAt);
      expect(rolledBack.currentSnapshotId).toBe("snapshot-1");
      first.close();

      const second = new RuntimeState(databasePath, { now });
      expect(second.store.schemaVersion).toBe(1);
      expect(second.sessions.restore("session-1")).toMatchObject({
        principalId: "owner",
        projectId: "project-1",
        currentSnapshotId: "snapshot-1",
        status: "active",
      });
      expect(second.bindings.get("conversation-1")).toMatchObject({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        target: "workspace",
      });
      expect(second.snapshots.get("snapshot-1")).toMatchObject({
        sessionId: "session-1",
        diff: [{ path: "src/index.ts", change: "modified", size: 42 }],
        metadata: { source: "test" },
      });

      const closed = second.sessions.close("session-1");
      expect(closed.status).toBe("closed");
      expect(() => second.sessions.restore("session-1")).toThrow("Session is closed");
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("removes bindings for workspace sessions whose roots disappeared", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "runtime.sqlite");
    const missingRoot = join(directory, "deleted-workspace");

    try {
      const first = new RuntimeState(databasePath);
      const session = first.sessions.create({ sessionId: "session-1", projectId: "project-1" });
      first.workspaces.create({
        workspaceId: "workspace-1",
        sessionId: session.sessionId,
        rootPath: missingRoot,
        mode: "direct",
      });
      first.bindings.bind({
        conversationScopeId: "conversation-1",
        sessionId: session.sessionId,
        workspaceId: "workspace-1",
        target: "workspace",
      });
      first.close();

      const second = new RuntimeState(databasePath);
      expect(second.workspaces.get("workspace-1")).toBeUndefined();
      expect(second.bindings.get("conversation-1")).toBeUndefined();
      expect(second.sessions.restore("session-1").sessionId).toBe("session-1");
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates binding and snapshot ownership at the state boundary", () => {
    const state = RuntimeState.inMemory();
    const session = state.sessions.create({ sessionId: "session-1", projectId: "project-1" });
    const otherSession = state.sessions.create({
      sessionId: "session-2",
      projectId: "project-2",
    });
    const workspace = state.workspaces.create({
      workspaceId: "workspace-1",
      sessionId: session.sessionId,
      rootPath: process.cwd(),
      mode: "direct",
    });

    expect(() =>
      state.bindings.bind({
        conversationScopeId: "conversation-1",
        sessionId: otherSession.sessionId,
        workspaceId: workspace.workspaceId,
        target: "workspace",
      }),
    ).toThrow("Workspace does not belong to session");
    expect(() =>
      state.snapshots.create({
        sessionId: session.sessionId,
        diff: [{ path: "..\\outside.txt", change: "modified", size: undefined, sha256: undefined }],
        metadata: {},
      }),
    ).toThrow("Snapshot diff path must be relative");
    state.close();
  });
});
