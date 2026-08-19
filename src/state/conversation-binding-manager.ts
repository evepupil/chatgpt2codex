import type { BindConversationInput, ConversationBinding } from "./contracts.js";
import { currentTimestamp, requireNonEmpty, type StateManagerOptions } from "./options.js";
import { SessionManager } from "./session-manager.js";
import { SqliteStateStore } from "./sqlite-state-store.js";
import { WorkspaceSessionManager } from "./workspace-session-manager.js";

export class ConversationBindingManager {
  constructor(
    private readonly store: SqliteStateStore,
    private readonly sessions: SessionManager,
    private readonly workspaces: WorkspaceSessionManager,
    private readonly options: StateManagerOptions = {},
  ) {}

  bind(input: BindConversationInput): ConversationBinding {
    const conversationScopeId = requireNonEmpty(input.conversationScopeId, "conversationScopeId");
    const session = this.sessions.restore(input.sessionId);
    let workspaceId: string | undefined;

    if (input.target === "workspace") {
      if (input.workspaceId === undefined) {
        throw new Error("workspaceId is required for workspace bindings");
      }
      workspaceId = this.workspaces.requireForSession(input.workspaceId, session).workspaceId;
    } else if (input.workspaceId !== undefined) {
      throw new Error("workspaceId is not allowed for session bindings");
    }

    const existing = this.store.getConversationBinding(conversationScopeId);
    const timestamp = currentTimestamp(this.options);
    const binding: ConversationBinding = {
      conversationScopeId,
      sessionId: session.sessionId,
      workspaceId,
      target: input.target,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.store.upsertConversationBinding(binding);
    return binding;
  }

  get(conversationScopeId: string): ConversationBinding | undefined {
    return this.store.getConversationBinding(
      requireNonEmpty(conversationScopeId, "conversationScopeId"),
    );
  }

  list(): readonly ConversationBinding[] {
    return this.store.listConversationBindings();
  }

  unbind(conversationScopeId: string): void {
    this.store.deleteConversationBinding(
      requireNonEmpty(conversationScopeId, "conversationScopeId"),
    );
  }
}
