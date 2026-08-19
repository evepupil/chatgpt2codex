# Session、Snapshot 与 SQLite 状态

- 模块定位：持久化 Runtime Session、Workspace Session、Conversation Binding 和 Snapshot 元数据。
- 对应代码：`src/state/`
- 所属里程碑：[M1：Session、Snapshot 与 SQLite 状态](../roadmap.md#m1)
- 当前状态：已完成
- 最近更新时间：2026-08-20

## 职责与边界

本模块提供进程内状态服务和 SQLite 持久化适配器，负责 Session 生命周期、工作区会话元数据、对话绑定、Snapshot/Checkpoint 元数据和启动恢复清理。

本模块不打开工作区、不读写工作区文件、不执行 Git 命令，也不实现 MCP Transport、OAuth 或文件/命令工具。Snapshot 当前只保存相对路径的 diff metadata，真实文件恢复和 Git backend 留待后续扩展。

## 结构与数据流

```text
RuntimeKernel
    -> RuntimeState
        -> SessionManager
        -> WorkspaceSessionManager
        -> ConversationBindingManager
        -> SnapshotManager
        -> SqliteStateStore
            -> schema_migrations
            -> runtime_sessions
            -> workspace_sessions
            -> conversation_bindings
            -> snapshots
```

`RuntimeState` 负责组合管理器，并在打开数据库时执行 schema migration 和恢复清理。缺失的 workspace root 会移除对应 Workspace Session，并通过外键级联移除 Conversation Binding；Runtime Session 元数据保留，便于继续恢复任务。

## 关键决策

1. 使用 Node 24 内置的 `node:sqlite` `DatabaseSync`，避免 M1 引入额外原生数据库依赖；运行环境最低需要 Node 22.5。
2. Schema 通过 `schema_migrations` 记录版本，当前版本为 `1`。遇到更高版本时拒绝启动并关闭已打开的数据库句柄。
3. Session 使用 `active/closed` 生命周期。`touch` 和 `rollback` 只允许 active Session，重复关闭保持幂等。
4. Workspace Session 只保存 `workspaceId`、绝对 root、模式、source root 和 base SHA。实际路径安全检查和 `open_workspace` 属于后续 Workspace 模块。
5. Conversation Binding 必须绑定已恢复的 Session；workspace 目标还必须属于同一个 active Session。
6. Snapshot 记录 Session、可选 workspace、相对 diff metadata、label 和 JSON metadata。回滚更新 Session 的 `currentSnapshotId`，文件内容恢复由后续 backend 实现。
7. `RuntimeKernel` 默认使用内存 RuntimeState；调用方可以注入指定 SQLite 文件的 RuntimeState，并通过 `close()` 释放数据库。

## 当前实现

- `contracts.ts`：Session、Workspace Session、Conversation Binding、Snapshot 和恢复报告类型。
- `sqlite-state-store.ts`：SQLite schema、migration、事务、CRUD 和 JSON 序列化。
- `session-manager.ts`：Session 创建、恢复、touch、关闭和回滚。
- `workspace-session-manager.ts`：Workspace Session 元数据和归属校验。
- `conversation-binding-manager.ts`：对话绑定创建、更新、查询和解绑。
- `snapshot-manager.ts`：Snapshot 创建、查询、列表和 diff 路径校验。
- `runtime-state.ts`：状态服务组合、重启恢复、失效路径清理和资源关闭。

## 验证方式

- `tests/state/runtime-state.test.ts`：状态重启恢复、Session 生命周期、绑定归属、Snapshot 回滚和失效 workspace 清理。
- `tests/state/sqlite-state-store.test.ts`：schema 版本创建和新版本拒绝。
- `pnpm gate`：格式、严格 TypeScript 和全量单测。

2026-08-20 已通过 `pnpm gate`：Prettier、严格 TypeScript 检查和 22 个核心单测全部通过。

## 待扩展项

- SQLite schema 后续迁移和状态备份。
- WorkspaceRegistry、allowed roots、路径 containment 和 `open_workspace`。
- Snapshot 文件内容校验、结构化 diff 和 Git backend。
- MCP Session Registry、Transport、OAuth 和 Conversation Binding 的外部入口。
- Session 事件持久化、并发租约和空闲清理。

## 改动历史

- 2026-08-20：建立 SQLite schema v1、Session/Workspace/Binding/Snapshot 管理器和重启恢复边界。
- 2026-08-20：完成 M1 退出标准验证并标记里程碑为已完成。
