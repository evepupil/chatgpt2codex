# Runtime Kernel

- 模块定位：管理 Agent Runtime 的稳定生命周期、工具能力、插件扩展和执行策略。
- 对应代码：`src/kernel/`
- 所属里程碑：[M0：Runtime Kernel 扩展骨架](../roadmap.md#m0)
- 当前状态：已完成
- 最近更新时间：2026-08-20

## 职责与边界

M0 的 Kernel 负责版本化契约、工具注册与查询、插件生命周期、权限策略、单工具编排和运行事件。执行上下文保留 `projectId`、`sessionId`、principal、scope 与可选 `workspaceId` 字段，为后续 Gateway 和 Workspace 接入提供稳定边界。

Kernel 不绑定具体存储、模型、MCP Server 或第三方 Context 实现。文件系统、Shell、MCP Server、CloudMind、CodeGraph、Mem0、Browser 等能力通过适配器或插件接入。M0 不实现 Session、Project、Workspace、SQLite、Snapshot、Transport、OAuth、文件工具或命令工具。

## 结构与数据流

```text
validated request context
    -> RuntimeKernel
        -> PluginHost -> ToolRegistry
        -> ToolOrchestrator -> ExecutionPolicy
        -> EventBus
```

工具调用流程是：按 exposure、namespace、capability 和 pluginId 发现能力，检查策略，执行工具，应用输出预算，发布运行事件。工具名必须使用 `namespace.name` 形式，注册后的工具会记录 `pluginId` 和 Kernel 契约版本。

Gateway 负责 HTTP Transport、OAuth、用户身份和请求上下文解析；Kernel 只接收已经验证的执行上下文。单用户 OAuth 的连接设计见 [MCP Gateway 与本地 OAuth](./mcp-gateway-oauth.md)。

## 关键决策

1. `RUNTIME_KERNEL_API_VERSION` 和 `RUNTIME_PLUGIN_API_VERSION` 固定当前契约版本；工具定义和运行事件都带 Kernel 契约版本。
2. 工具使用 `namespace.name` 命名规则，注册表支持 exposure、namespace、capability 和 pluginId 查询。
3. 工具风险分为读取、写入、执行和网络；默认策略允许读取，其他风险需要非空 approval token。
4. 插件安装前检查 API 版本和依赖，setup 失败会回滚本次工具注册并发布失败事件。
5. 插件支持可选 teardown 和卸载；卸载失败仍清理插件工具与记录，避免失效插件继续暴露能力。
6. EventBus 隔离监听器异常，事件流不会改变 Kernel 操作结果。
7. OAuth、Transport、Tunnel 和 Workspace 属于后续边界，Kernel 通过执行上下文承接未来的 principal、scope、project、session 和 workspace handle。

## 当前实现

- `contracts.ts`：Kernel/plugin 版本、工具、执行上下文、策略、插件和事件契约。
- `event-bus.ts`：事件版本归一化、发布订阅和监听器故障隔离。
- `tool-registry.ts`：工具注册、namespace 解析、exposure/capability/plugin 查询和按插件清理。
- `plugin-host.ts`：API/依赖检查、安装回滚、生命周期事件、teardown 和卸载。
- `orchestrator.ts`：策略检查、未知工具处理、父级取消、超时、输出预算和执行事件。
- `runtime-kernel.ts`：插件安装/卸载、工具发现、事件订阅、工具执行和 RuntimeState 组合入口。

M0 的 Kernel 核心只实现单工具编排；M1 通过可注入的 `RuntimeState` 接入 Session、Snapshot 和 SQLite 状态。MCP Transport、OAuth Gateway 和 Workspace 工具在后续里程碑接入。

## 验证方式

- `pnpm gate`
- `tests/kernel/event-bus.test.ts`：事件版本、取消订阅和监听器隔离。
- `tests/kernel/tool-registry.test.ts`：重复注册、namespace、exposure、capability 和 plugin 查询。
- `tests/kernel/plugin-host.test.ts`：安装、失败回滚、依赖、生命周期事件和卸载。
- `tests/kernel/orchestrator.test.ts`：审批、空 approval token、输出预算、超时、取消、未知工具和执行失败。
- `tests/kernel/runtime-kernel.test.ts`：公开组合入口的插件、工具、事件和执行流程。

2026-08-20 已通过 `pnpm gate`：Prettier、严格 TypeScript 检查和 18 个核心单测全部通过。

## 待扩展项

- Session Manager、Project Manager 和 SQLite State Store。
- Snapshot Backend 和 checkpoint/rollback。
- stdio、HTTP、Streamable HTTP MCP Transport。
- 本地单用户 OAuth、一次性配对和重启后的授权恢复，设计见 [MCP Gateway 与本地 OAuth](./mcp-gateway-oauth.md)。
- Workflow 的顺序、并行、条件和补偿执行。
- Context Provider、Storage、Lifecycle Hook 和 UI 元数据扩展。
- 插件权限、依赖解析、沙箱和版本迁移。

## 改动历史

- 2026-08-19：建立 M0 Kernel 扩展边界和基础实现。
- 2026-08-19：补充 Gateway 与 Kernel 的 OAuth、Transport 和 principal 边界。
- 2026-08-20：完成 Kernel 版本化契约、工具查询、插件生命周期、取消/超时编排、运行事件和组合入口；M0 验收通过。
- 2026-08-20：Kernel 组合入口接入 M1 RuntimeState，状态实现归档至 [Session、Snapshot 与 SQLite 状态](./session-snapshot-state.md)。
