# MCP Server 基础协议入口

- 模块定位：提供与 Transport 无关的 MCP `tools/list`、`tools/call` 和请求取消适配层。
- 对应代码：`src/mcp/`、`tests/mcp/`
- 所属里程碑：[M2：MCP Transport 与本地工作区工具](../roadmap.md#m2)
- 当前状态：已完成（M2 的协议核心前置层）
- 最近更新时间：2026-08-20

## 职责与边界

MCP Server 只处理 JSON-RPC 请求的校验、工具发现结果转换、工具调用参数转换、执行上下文注入和取消通知。它通过 `McpRuntimeKernel` 窄接口调用 `listTools()` 与 `execute()`，不访问 `ToolRegistry`、工具 handler、SQLite、Workspace 或未来的 Workspace 服务。

调用方必须为 Server 提供已经验证的 `projectId`、`sessionId`，并可以提供 principal、scope、workspaceId 和 approval token。当前实现不自行识别身份，也不从 MCP 参数推断权限。

当前只实现协议核心，不包含 Streamable HTTP、stdio、Session、OAuth、CLI/config.toml、初始化握手或工具分页。Transport 负责把消息交给 `handleRequest()`，随后把返回的 JSON-RPC 响应写回客户端。

## 结构与数据流

```text
MCP Transport
    -> McpServer.handleRequest(message)
        -> protocol validation and mapping
        -> McpRuntimeKernel.listTools() / execute()
            -> RuntimeKernel
                -> Policy / Orchestrator / Tool Registry / plugin tool
        -> JSON-RPC response
```

### 工具发现

`tools/list` 每次调用 Kernel 的无参数 `listTools()`，再保留 `exposure` 为 `default` 或由 Kernel 默认列表省略 exposure 的工具。响应只包含 `name`、`description` 和 `inputSchema`，不会把 `pluginId`、`handler`、risk 或 capabilities 传给 MCP Client。

### 工具调用

`tools/call` 要求 `params.name` 是非空字符串，`params.arguments` 必须是对象；缺少 arguments 时使用空对象。MCP 请求 id 会转换为 Kernel `ToolCall.id` 的字符串，工具名和对象参数原样交给 `RuntimeKernel.execute()`。

执行上下文由 `executionContext` 值或工厂提供，Server 只覆盖其中的 `signal`。Kernel 返回的文本结果转换为 MCP text content，`structured` 转换为 `structuredContent`，`isError` 原样保留。未知工具、策略拒绝、超时、取消和 handler 错误沿用 Kernel 的失败结果，作为 MCP `CallToolResult.isError=true` 返回。

### 请求取消

Server 为每个活跃 `tools/call` 建立 `AbortController`。收到 `notifications/cancelled` 后按 `requestId` 调用 controller，外层 Transport 也可以通过 `handleRequest(message, { signal })` 提供父级 `AbortSignal`。两条路径都会进入 Kernel 的 `ToolExecutionContext.signal`，由 Kernel 统一处理取消、超时和运行事件。

## 关键决策

1. 当前依赖中没有官方 TypeScript MCP SDK，本批不修改 `package.json` 或 lockfile，采用小型、可测试的协议核心；后续 Transport 可以把它包在官方 SDK 或自己的消息边界中。
2. Server 使用 JSON-RPC 错误响应处理无效请求、无效参数和未知方法；工具执行失败保持 MCP 工具结果并设置 `isError`，这样不会绕过 Kernel 的失败语义。
3. MCP 层只依赖 `McpRuntimeKernel`，该接口不包含 `handler`、`pluginId` 或 Registry 方法，避免适配器形成越权调用路径。
4. execution context 必须由调用方注入。Gateway 在未来完成 OAuth、Session 和项目解析后，可以用工厂按请求创建上下文，而不需要改变 MCP 核心。

## 当前实现

- `contracts.ts`：MCP JSON-RPC、工具结果、窄 Kernel 接口和执行上下文契约。
- `protocol.ts`：输入校验、错误码、工具元数据映射和 ToolResult 映射。
- `server.ts`：`McpServer` / `McpServerAdapter` 请求调度、活跃请求表和 AbortController 取消桥接。
- `index.ts`：MCP 模块入口导出。

## 验证方式

- `tests/mcp/protocol.test.ts`：arguments 校验、公开工具字段过滤、文本/结构化/错误结果映射。
- `tests/mcp/server.test.ts`：默认工具发现过滤、Kernel 调用参数与 context 映射、未知工具、handler 错误、JSON-RPC 错误和两种取消路径。
- 项目门禁：`pnpm format`、`pnpm check`、`pnpm test`。

## 待扩展项

- 使用官方 `@modelcontextprotocol/sdk` 接入 Streamable HTTP 或 stdio，并保留当前核心适配边界。
- 在 M2 接入初始化握手、Transport、MCP Session 和 OAuth Gateway。
- 按 MCP 版本需要补充 tools/list 分页、更多 ContentBlock 类型、资源和 prompts。
- 将 Gateway 生成的已验证 Session/Project/Principal 上下文接入 `McpExecutionContextFactory`。

## 改动历史

- 2026-08-20：建立 transport-neutral MCP 基础协议核心，接通 RuntimeKernel 工具发现、调用、结构化结果和取消映射，并补充单测。
