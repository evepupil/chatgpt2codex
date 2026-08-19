# Runtime Kernel

- 模块定位：管理 Agent Runtime 的稳定生命周期、工具能力、插件扩展和执行策略。
- 对应代码：`src/kernel/`
- 所属里程碑：[M0：Runtime Kernel 扩展骨架](../roadmap.md#m0)
- 当前状态：进行中
- 最近更新时间：2026-08-19

## 职责与边界

Kernel 负责 Session、Project、工具注册、MCP 编排、插件生命周期、权限策略、执行事件和 Context/Snapshot 扩展契约。文件系统、Shell、MCP Server、CloudMind、CodeGraph、Mem0、Browser 等具体能力通过适配器或插件接入。

Kernel 不直接绑定具体存储、模型、MCP Server 或第三方 Context 实现。所有工具调用都经过注册表、策略检查、执行器和事件流。

## 结构与数据流

```text
MCP Gateway
    -> Runtime Kernel
        -> Tool Registry
        -> Plugin Host
        -> MCP / Workflow Orchestrator
        -> Policy
        -> Event Bus
    -> Workspace / State Store / Plugins
```

工具调用流程是：发现能力、检查策略、执行工具、规范化结果、应用输出预算、发布事件。

## 关键决策

1. 核心只依赖版本化契约，插件通过 `PluginContext` 扩展能力。
2. 工具使用命名空间，GPT Web 只看到经过筛选的工具集合，避免一次暴露所有 MCP 工具。
3. 工具风险分为读取、写入、执行和网络，策略层统一控制高风险操作。
4. 插件故障应被隔离，不能破坏 Kernel 或已有 Session。
5. Session 和 Snapshot 由 Kernel 提供抽象，Git 只是可选的后端实现。

## 当前实现

- `contracts.ts`：工具、插件、策略和运行事件契约。
- `event-bus.ts`：轻量运行事件发布订阅。
- `tool-registry.ts`：工具注册、命名空间查询和插件隔离。
- `plugin-host.ts`：插件 API 版本检查和工具注册托管。
- `orchestrator.ts`：策略检查、超时、结果截断和事件记录。
- `runtime-kernel.ts`：组合 Kernel 的公开入口。

当前只实现 M0 基础能力，Session、Snapshot、MCP Transport 和持久化状态将在后续里程碑接入。

## 验证方式

- `pnpm check`
- `pnpm test`
- `pnpm format`
- 核心单测覆盖重复工具、插件注册、工具筛选、审批策略、超时和执行结果。

## 待扩展项

- Session Manager、Project Manager 和 SQLite State Store。
- Snapshot Backend 和 checkpoint/rollback。
- stdio、HTTP、Streamable HTTP MCP Transport。
- Workflow 的顺序、并行、条件和补偿执行。
- Context Provider、Storage、Lifecycle Hook 和 UI 元数据扩展。
- 插件权限、依赖解析、沙箱和版本迁移。

## 改动历史

- 2026-08-19：建立 M0 Kernel 扩展边界和基础实现。
