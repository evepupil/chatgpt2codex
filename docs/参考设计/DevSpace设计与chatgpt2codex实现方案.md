# DevSpace 设计与 chatgpt2codex 实现方案

- 文档定位：参考实现研究、架构映射和落地顺序
- 参考项目：[Waishnav/devspace](https://github.com/Waishnav/devspace)
- 参考快照：[9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed](https://github.com/Waishnav/devspace/tree/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed)
- 本项目路线图：[chatgpt2codex roadmap](../roadmap.md)
- 关联里程碑：[M0](../roadmap.md#m0)、M1、M2、M3
- 当前状态：参考设计已完成；实现状态以路线图和各模块文档为准
- 最近更新时间：2026-08-20

## 1. 结论

DevSpace 的核心产品模型很清晰：ChatGPT Web 负责理解需求、规划步骤和生成代码，本地 DevSpace 通过 MCP 提供受控的工作区、文件、命令、Git 和变更展示能力。它把“模型如何思考”和“本机如何执行”分开，模型可以继续使用 ChatGPT Web，本地文件也不需要上传到第三方服务。

chatgpt2codex 适合沿用这条主线，同时把 Runtime Kernel 做得更通用：

1. 以 `workspaceId` 作为一次编码工作的稳定句柄，后续工具调用都复用它。
2. 通过 MCP Gateway 接入 ChatGPT Web，Gateway 负责 Transport、OAuth 和请求身份，Kernel 负责能力、策略和编排。
3. 把文件、Shell、Git、MCP Server、Context Provider 和 UI 都做成插件或适配器，Kernel 只依赖版本化契约。
4. 把工具风险、审批、超时、输出预算和事件记录放在统一策略层，避免每个工具各自实现一套权限逻辑。
5. 把 CloudMind 作为可选的 Context Provider，负责长期上下文和项目记忆；工作区、文件和命令仍由 chatgpt2codex 管理。

DevSpace 的代码可以作为交互和模块边界的参考。它的 Shell 运行在本地用户权限下，Worktree 只提供开发流程隔离，二者都不能当作安全沙箱。chatgpt2codex 实现时必须保留这个安全事实。

## 2. 产品模型

| 用户问题                     | DevSpace 的处理方式                                 | chatgpt2codex 的落地方向                               |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| ChatGPT Web 看不到本地项目   | 本地 MCP Server 通过公网 HTTPS/Tunnel 提供 `/mcp`   | MCP Gateway + 单用户 OAuth + Tunnel 适配               |
| 多轮对话需要继续使用同一项目 | `open_workspace` 返回 `workspaceId`，后续工具复用   | Workspace Registry 和 Conversation Binding             |
| 模型需要读写代码并运行测试   | 暴露受控的 `read`、`write`、`edit`、`bash` 等工具   | Native Tool Provider，统一接入 Kernel Policy           |
| 并行任务不应互相覆盖         | Git Worktree 模式从某个 commit 创建独立目录         | Git Worktree Adapter + Snapshot/Review                 |
| 项目有自己的开发规范         | 打开工作区时发现 `AGENTS.md`、`CLAUDE.md` 和 Skills | Instruction Provider + Skill Provider                  |
| 用户需要检查模型改动         | `show_changes` 汇总当前回合的 diff 并提供 UI Card   | Diff/Review Provider + MCP Apps Resource               |
| 模型需要长期项目上下文       | DevSpace 只提供本地工作区上下文                     | 通过 Context Provider 可选接入 CloudMind、CodeGraph 等 |

## 3. DevSpace 实际架构

### 3.1 总体调用链

```text
ChatGPT Web
    |
    | HTTPS / Streamable HTTP MCP
    v
Tunnel or Reverse Proxy
    |
    v
DevSpace HTTP Server
    |- OAuth metadata, approval and token endpoints
    |- MCP session registry
    |- MCP server and tool registration
    v
Workspace Registry
    |- checkout workspace
    |- managed Git worktree
    |- AGENTS.md / CLAUDE.md
    |- Skills and local agent profiles
    v
Local Tools
    |- read / write / edit / bash
    |- grep / glob / ls
    |- apply_patch / exec_command / write_stdin
    |- show_changes / download_artifact
```

参考源码中，`src/server.ts` 的 `createServer` 负责 HTTP 生命周期，`createMcpServer` 负责创建 MCP Server、注册工具和 UI Resource；`src/workspaces.ts` 的 `WorkspaceRegistry` 负责工作区打开、复用、指令和 Skills；`src/workspace-store.ts` 的 `SqliteWorkspaceStore` 负责持久化会话和对话绑定。

### 3.2 MCP Transport 和 Session

DevSpace 使用 Streamable HTTP。客户端首次请求 `/mcp` 时没有 `mcp-session-id`，服务端创建 `StreamableHTTPServerTransport`，由 Transport 生成随机 Session ID。Transport 初始化后，Session 注册到 `McpSessionRegistry`；后续请求通过 `mcp-session-id` 找回同一 Transport。

关键行为如下：

- 请求带有未知 Session ID 时返回明确的 404 MCP 错误。
- 获取活跃 Session 时刷新最近使用时间。
- 后台定时清理长期闲置的 Session，避免客户端断线后 Transport 永远留在进程内。
- Transport 自己关闭时从 Registry 移除。
- HTTP Server 关闭时调用 Registry 的 `closeAll`，统一关闭剩余 Transport。
- 日志只记录截断后的 Session ID 前缀，避免把完整标识暴露到日志。

参考实现使用 24 小时空闲超时、5 分钟清理周期。这个具体数值属于配置项，chatgpt2codex 应保留同样的生命周期边界，数值放到配置中。

MCP Session 和 Runtime Session 要分开：前者是网络连接对象，生命周期短且可以重建；后者保存工作区、项目和任务状态，应该进入 SQLite 或其他持久化存储。

### 3.3 Workspace 模型

`open_workspace` 是 DevSpace 的工作入口。输入包含：

```text
path       项目目录的绝对路径或 ~/... 路径
mode       checkout 或 worktree，默认 checkout
baseRef    Worktree 的基准 Git ref，默认 HEAD
```

输出包含 `workspaceId`、实际 `root`、工作模式、指令文件、可用 Skills、可用 Agent Profile，以及 Worktree 的 `sourceRoot`、`baseSha`、`dirtySource` 等信息。

#### Checkout 模式

Checkout 模式直接操作用户指定的真实项目目录。路径必须位于配置的 `allowedRoots` 下，服务端会做规范化、真实路径和目录检查。模型拿到的是 `workspaceId`，后续工具根据它查找真实 root，模型不需要在每次调用中重复传绝对路径。

当请求带有 ChatGPT conversation metadata 时，DevSpace 会按 conversation scope 和项目 target 建立绑定。同一个对话再次打开同一个 checkout 时，可以复用已有 Workspace Session，避免重复加载初始上下文。

#### Worktree 模式

Worktree 模式要求源目录是 Git 仓库且至少有一个 commit。服务端默认从 `HEAD`，或用户指定的 `baseRef`，解析出具体 `baseSha`，然后在 `~/.devspace/worktrees` 下创建 detached worktree。

创建结果会记录：

- 源仓库 `sourceRoot`
- Worktree 实际路径
- `baseRef` 和解析后的 `baseSha`
- 源目录创建前是否有未提交改动 `dirtySource`
- 是否为 managed、detached worktree

源目录的未提交改动不会自动复制到新 Worktree。`dirtySource` 只用于提醒和后续决策。Worktree 提供并行工作流边界，仍然继承本地用户权限。

#### SQLite 状态

DevSpace 的 Workspace Store 至少包含两类记录：

```text
workspace_sessions
  id, root, status, mode, sourceRoot, baseRef, baseSha,
  managed, createdAt, lastUsedAt

workspace_conversation_bindings
  conversationScopeId, targetKey, workspaceSessionId,
  createdAt, lastUsedAt
```

进程重启后，服务端可以从 SQLite 取回 Session 和对话绑定，再检查路径、仓库和目录状态。绑定指向的目录已经删除或不再允许访问时，服务端会丢弃失效绑定并要求重新打开工作区。

### 3.4 文件、Shell 和进程工具

DevSpace 通过配置选择工具面。当前参考快照支持三种模式：

| 模式      | 工具                                                                   | 适用场景                              |
| --------- | ---------------------------------------------------------------------- | ------------------------------------- |
| `minimal` | `open_workspace`、`read`、`write`、`edit`、`bash`                      | 默认面，使用 Shell 完成搜索和目录检查 |
| `full`    | minimal 加 `grep`、`glob`、`ls`                                        | 需要更明确的只读搜索工具              |
| `codex`   | `open_workspace`、`read`、`apply_patch`、`exec_command`、`write_stdin` | 兼容 Codex 风格的工具名和长进程操作   |

实现原则：

- 文件工具的路径都相对已打开工作区解析，并经过允许根目录检查。
- 编辑优先采用精确替换或 Patch，减少模型把整文件重写造成的误改。
- `bash` 用于测试、构建、Git、搜索和包脚本，工作目录固定在 Workspace root。
- 长命令可以返回 `sessionId`，再由 `write_stdin` 发送输入、轮询输出或调整 PTY 尺寸。
- 工具结果同时提供文本、结构化结果和必要的 UI metadata，便于模型继续工作以及 ChatGPT 展示卡片。
- 文件内容、Shell 输出和 diff 都需要有输出预算，避免一次调用占满上下文。

Shell 工具具备当前操作系统用户的能力。允许根目录检查只约束文件工具和工作区入口，Shell 内部可以访问用户账号本来就能访问的资源。因此，远程 MCP Client 必须被视为受信调用方，Owner 授权和公网入口保护都属于强制条件。

### 3.5 指令文件和 Skills

打开工作区时，DevSpace 会加载项目上下文文件，并返回当前已加载文件和可继续发现的文件。重点文件包括：

- 根目录及嵌套目录中的 `AGENTS.md`、`CLAUDE.md`。
- 用户级和项目级的 Skills。
- 可选的本地 Agent Profile。

参考实现的 Skills 搜索路径包括：

```text
~/.agents/skills
<workspace>/.agents/skills
~/.devspace/skills
<agentDir>/skills，默认兼容 ~/.codex/skills
DEVSPACE_SKILL_PATHS 指定的额外目录
```

Skill 的发现和 Skill 文件内容读取分成两个阶段：

1. 先发现并向模型提供 `SKILL.md` 的名称、描述和路径。
2. 模型明确读取某个 Skill 后，才允许继续读取该 Skill 目录中的辅助文件。

这个边界可以减少启动时的上下文噪声，也降低未经请求读取大量本地文件的风险。chatgpt2codex 应将它做成 `InstructionProvider` 和 `SkillProvider`，不要把它写死在某一个 MCP Tool 中。

### 3.6 Diff UI 和 MCP Apps

DevSpace 使用 `@modelcontextprotocol/ext-apps` 的 Resource 和 Tool metadata 提供 Workspace/Diff Card：

- Resource 提供 `ui://devspace/workspace-app.html` 及 CSP 配置。
- 工具返回文本结果、`structuredContent` 和 `_meta` 中的卡片数据。
- `open_workspace` 返回工作区、指令和 Skills 摘要。
- 文件变更工具返回本次变更的文件、增删统计和 Patch。
- `show_changes` 聚合当前回合的变更，通常在最后一次文件改动后调用一次。

`show_changes` 的设计重点是把用户审阅放在一次完整变更之后，避免每写一个文件就弹出一张卡。chatgpt2codex 可以先实现结构化 Diff，再把 UI Card 作为 MCP Apps 插件接入，保持 Kernel 不依赖浏览器 UI。

### 3.7 Native Artifact Download

DevSpace 的 `download_artifact` 是可选能力，作用是把 MCP Host 提供的原生文件对象写入已经打开的 Workspace。它不接受任意 URL、绝对路径或本地源路径。

安全流程包括：

1. 校验输入对象字段、受信下载 Host 和重定向。
2. 校验目标是 Workspace 内未存在的相对路径。
3. 对父目录逐级检查，拒绝符号链接目录。
4. 写入临时文件，限制单文件大小，计算 SHA-256。
5. `fsync` 后以不覆盖的方式发布到目标路径。

参考实现目前只在 Linux 注册该工具，因为安全发布路径依赖 Linux 的目录句柄和 procfs 能力。chatgpt2codex 可以先把它列为可选 Provider，Windows 实现需要单独设计目录句柄、重解析点和原子发布策略。

## 4. 安全边界

| 边界       | 参考设计                                                              | chatgpt2codex 要求                                    |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| 文件根目录 | 配置 `allowedRoots`，所有 Workspace 入口和文件路径做 containment 检查 | `WorkspaceRegistry` 统一解析，工具不得自行绕过        |
| MCP Client | Owner password 批准单用户 OAuth Client                                | 采用现有 M2 OAuth 设计，长期授权放用户数据目录        |
| 公网入口   | `publicBaseUrl` 只写 origin，Host allowlist 单独校验                  | Tunnel 只转发，权限由 OAuth 和 Policy 共同承担        |
| 工具权限   | Tool annotations、工具模式和 Shell 风险说明                           | Kernel 的 `ToolRisk`、`ToolExposure`、Policy 统一裁决 |
| Shell      | 本地用户权限，可执行任意用户允许的命令                                | 明确提示高风险；不把 Shell 包装成沙箱                 |
| Worktree   | 减少工作目录相互覆盖                                                  | 只作为流程隔离，不能作为安全边界                      |
| 日志       | 默认不记录 Shell 命令正文，避免命令中的 Secret 泄露                   | 日志默认脱敏，工具输出和事件也要有预算                |
| Artifact   | 只接受受信原生文件对象，禁止任意 URL 和覆盖                           | 独立 Provider，平台能力不足时不暴露工具               |

### 4.1 OAuth 和 MCP 资源

DevSpace 通过以下 metadata 端点让 MCP Client 发现授权信息：

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

公网 origin 和 `/mcp` Resource 要分开表达：origin 用于 Discovery，Resource 用于授权请求和 Token audience 校验。chatgpt2codex 的现有 M2 设计已确定单用户 Owner、一次性配对码、Authorization Code + PKCE、持久化 grant 和 refresh token；本参考设计不重复发明第二套认证模型。

### 4.2 风险分层

OAuth scope 只说明调用方拥有哪一组能力。具体工具是否允许执行，还要经过 Kernel Policy：

```text
OAuth principal + scopes
    -> MCP Gateway 构造 PrincipalContext
    -> Kernel 校验 project/session/workspace 归属
    -> Policy 检查 ToolRisk、approvalToken、插件权限
    -> Orchestrator 执行并发布事件
```

这样可以避免把一个宽泛的 `runtime:write` scope 直接等同于所有写文件、删除文件或执行命令权限。

## 5. chatgpt2codex 架构映射

### 5.1 目标架构

```text
ChatGPT Web
    |
    v
MCP Gateway
    |- Streamable HTTP
    |- OAuth / Principal
    |- MCP Session Registry
    v
Runtime Kernel
    |- Tool Registry
    |- Execution Policy
    |- Plugin Host
    |- Workflow Orchestrator
    |- Event Bus
    |- Session / Snapshot API
    v
Workspace and State
    |- Workspace Registry
    |- SQLite State Store
    |- File / Command / Git Providers
    |- Instruction / Skill Providers
    |- Context Providers
    |- Diff / UI Providers
```

当前 Kernel 已经提供 Tool Registry、Plugin Host、基础 Orchestrator、Event Bus 和工具风险边界。现有实现位置如下：

- `src/kernel/contracts.ts`：工具、插件、策略、执行上下文和运行事件契约。
- `src/kernel/tool-registry.ts`：工具注册、插件归属、暴露面和能力筛选。
- `src/kernel/plugin-host.ts`：插件 API 版本检查和工具注册托管。
- `src/kernel/orchestrator.ts`：策略检查、超时、AbortSignal、结果截断和事件记录。
- `src/kernel/runtime-kernel.ts`：Kernel 的组合入口。
- `docs/模块设计/runtime-kernel.md`：Kernel 当前边界和待扩展项。
- `docs/模块设计/mcp-gateway-oauth.md`：M2 Gateway、OAuth 和 Principal 边界。

### 5.2 能力映射

| DevSpace 能力                            | chatgpt2codex 当前状态 | 目标模块和归属                                        |
| ---------------------------------------- | ---------------------- | ----------------------------------------------------- |
| HTTP MCP Server                          | 尚未实现               | `src/gateway/`，负责 Transport 和路由                 |
| OAuth、Owner、配对和 Token               | 已完成设计，尚未实现   | `src/auth/` + `src/gateway/`                          |
| MCP Session Registry                     | 尚未实现               | `src/gateway/mcp-session-registry.ts`，临时连接状态   |
| Workspace Registry                       | 尚未实现               | `src/workspace/`，负责根目录、句柄和生命周期          |
| SQLite Workspace Store                   | 尚未实现               | `src/state/`，负责恢复和绑定                          |
| Checkout / Worktree                      | 尚未实现               | `src/workspace/` + `src/providers/git/`               |
| read / write / edit / bash               | 尚未实现               | `src/providers/filesystem/`、`src/providers/command/` |
| grep / glob / ls                         | 尚未实现               | 文件 Provider 的可选工具组                            |
| apply_patch / exec_command / write_stdin | 尚未实现               | Codex compatibility profile                           |
| AGENTS.md / CLAUDE.md                    | 尚未实现               | `InstructionProvider`                                 |
| Skills 发现和按需读取                    | 尚未实现               | `SkillProvider`                                       |
| Diff / Review Card                       | 尚未实现               | `DiffProvider` + MCP Apps Adapter                     |
| Native Artifact                          | 尚未实现               | 可选 `ArtifactProvider`，按平台注册                   |
| CloudMind Context                        | 作为外部能力规划       | `ContextProvider` 插件，不进入 Kernel 核心            |

### 5.3 CloudMind 的关系

chatgpt2codex 和 CloudMind 是两个职责不同的组件：

- chatgpt2codex 拥有本地工程工作区、文件、命令、Git、任务 Session 和工具审批。
- CloudMind 拥有用户自持的长期上下文、项目记忆和跨 Agent 召回能力。
- chatgpt2codex 可以通过 `ContextProvider` 调用 CloudMind，获得项目背景、历史决策和相关上下文。
- CloudMind 不应直接取得本地文件系统或 Shell 权限；需要本地工程信息时，由 Runtime 按策略提取摘要后传递。
- 记忆写入只保存稳定的决策、进度、阻塞和下一步，禁止把完整会话、Secret、临时日志写进长期记忆。
- 项目级 CloudMind 调用使用规范化 Git remote 生成 `contextKey`，不能使用本地绝对路径。

推荐的数据流为：

```text
open_workspace
    -> Runtime 解析 canonical remote、projectId、workspaceId
    -> ContextProvider.load(project context)
    -> Kernel 将有限上下文加入本次任务上下文

task checkpoint / explicit durable decision
    -> Runtime 过滤 Secret、临时日志和完整会话
    -> ContextProvider.save(concise project memory)
```

CloudMind 作为插件接入时，应遵守 Kernel 的超时、输出预算、错误隔离和策略检查。CloudMind 不可用时，文件和命令工具仍应可用，任务不能因为长期上下文服务暂时不可达而整体失效。

## 6. 可扩展 Runtime Kernel 设计

DevSpace 主要解决本地工作区接入。chatgpt2codex 还需要解决多种工具、MCP Server、插件和编排方式共存的问题，因此 Kernel 要把“工具来源”和“工具执行”分层。

### 6.1 Provider 类型

建议把能力提供者抽象成以下几类：

| Provider             | 负责内容                                   | 示例                                |
| -------------------- | ------------------------------------------ | ----------------------------------- |
| Native Tool Provider | 本地文件、命令、Git、进程、Diff            | `read`、`edit`、`bash`              |
| MCP Tool Provider    | 连接外部 MCP Server，导入、命名和代理工具  | Cloudflare、数据库、浏览器 MCP      |
| Context Provider     | 读取和写入受控上下文                       | CloudMind、CodeGraph                |
| Instruction Provider | 加载项目规则和系统指令                     | `AGENTS.md`、`CLAUDE.md`            |
| Skill Provider       | 发现 Skill 并按需提供资源                  | `.agents/skills`、`~/.codex/skills` |
| UI Provider          | 生成结构化结果、Diff 和 MCP Apps Resource  | Workspace Card、Review Card         |
| Lifecycle Provider   | 响应 Session、Workspace、Task 和 Tool 事件 | 审计、指标、记忆 checkpoint         |

Provider 通过插件安装到 Plugin Host，由 Plugin Host 负责 API 版本、依赖、权限和失败隔离。Provider 不应直接修改另一个插件的内部状态。

### 6.2 MCP 工具编排

MCP 工具进入 Kernel 后，统一转换成带命名空间的 `ToolDefinition`。建议的执行流程如下：

```text
MCP Server / Native Provider
    -> Provider Adapter
    -> namespace + schema + risk + capabilities
    -> Tool Registry
    -> Exposure filter
    -> Policy evaluation
    -> Workflow Orchestrator
    -> normalized result + events
```

MCP 工具编排需要具备以下能力：

1. **命名空间**：例如 `cloudflare.deploy`、`filesystem.read`，避免不同 Server 的工具重名。
2. **暴露面筛选**：按项目、任务、用户 scope、插件能力和 `default/on-demand/internal` 选择暴露给 ChatGPT 的工具。
3. **风险元数据**：每个工具声明 read/write/execute/network 风险、是否可重试、是否幂等、是否需要审批。
4. **生命周期管理**：MCP Client 连接、初始化、工具发现、断线重连和关闭都由 Provider 管理。
5. **超时和取消**：MCP 调用必须接入 Kernel 的 `AbortSignal` 和统一超时预算。
6. **结果规范化**：文本、结构化数据、图片、资源链接和错误都转换为统一的 `ToolResult`。
7. **故障隔离**：单个 MCP Server 失效时，保留其他工具和已有 Session；断线重连不能阻塞 Kernel 启动。
8. **审计和预算**：记录工具名、Provider、调用结果和耗时；对输入、输出和日志做大小与敏感信息控制。

### 6.3 Workflow Orchestrator

当前 Kernel 的 Orchestrator 已支持单工具调用。后续可以在保留现有入口的基础上增加工作流层：

```text
Workflow
  nodes: tool calls or nested workflows
  edges: sequential / parallel / conditional
  limits: timeout / output budget / concurrency / retry
  recovery: compensation or checkpoint
```

第一阶段只需要顺序和并行两种节点，保证一个任务可以串联“读取配置 -> 调用 MCP -> 写入文件 -> 运行测试”。条件分支、重试和补偿放在状态与事件模型稳定后接入。每一步都要经过同一个 Policy，工作流不能绕过单工具审批。

### 6.4 插件版本和失败隔离

插件清单至少需要保留：

```text
id
version
apiVersion
capabilities
permissions
dependencies
```

安装和运行规则：

- API 版本不兼容时拒绝安装。
- 插件声明的权限只描述它可以申请的能力，最终调用仍由 Policy 决定。
- 工具注册必须带有 `pluginId`，卸载插件时可以批量移除工具。
- 插件初始化失败时回滚本次安装，保留 Kernel 和已有插件。
- 插件的状态迁移、升级和卸载要有明确生命周期事件。
- 插件不得把 OAuth token、Shell 原始命令或完整对话写入自己的日志或长期存储。

### 6.5 未来契约扩展

现有 `ToolDefinition`、`ToolRegistration` 和 `PluginContext` 已经形成 M0 的最小契约。后续扩展建议保持向后兼容，逐步增加：

- `providerId`、`namespace` 和 `schemaVersion`
- `sideEffects`、`idempotent`、`retryPolicy`
- `requiredScopes`、`requiredCapabilities` 和审批策略
- `inputBudget`、`outputBudget` 和敏感字段声明
- `resourceLinks`、UI descriptor 和流式结果能力

这些字段由适配器补充，不要求所有 Native Tool 一开始实现全部特性。

## 7. 核心数据模型

| 实体                 | 生命周期           | 主要字段                                          | 存储                               |
| -------------------- | ------------------ | ------------------------------------------------- | ---------------------------------- |
| MCP Session          | 网络连接期间       | `mcpSessionId`、Transport、`lastUsedAt`           | 内存，可恢复连接但不恢复 Transport |
| Runtime Session      | 一次长期任务       | `sessionId`、principal、project、状态、checkpoint | SQLite                             |
| Workspace Session    | 工作区打开到关闭   | `workspaceId`、root、mode、sourceRoot、baseSha    | SQLite + 内存索引                  |
| Conversation Binding | 对话与工作区的关系 | `conversationScopeId`、target、`workspaceId`      | SQLite                             |
| Tool Invocation      | 一次工具调用       | `callId`、tool、plugin、risk、状态、耗时          | 事件流，按策略持久化               |
| Snapshot             | 可回滚的任务状态   | `snapshotId`、workspace、diff、metadata           | SQLite + 文件/Git backend          |
| Plugin Installation  | 插件安装版本       | manifest、状态、配置版本                          | SQLite 或配置目录                  |
| Context Reference    | 外部上下文来源     | `providerId`、`contextKey`、摘要引用              | Provider 自己的存储                |

`workspaceId` 由 Runtime 生成并校验归属，不能把模型提交的任意 `workspaceId` 直接当作文件路径。工作区工具必须经过 Registry 得到真实 root，再进入文件或命令 Provider。

## 8. 关键调用流程

### 8.1 首次连接和打开工作区

```text
ChatGPT Web -> POST /mcp
    -> Gateway 校验 Bearer Token
    -> 创建或取得 MCP Session
    -> PrincipalResolver 生成 PrincipalContext

ChatGPT Web -> open_workspace(path, mode)
    -> WorkspaceRegistry 校验 allowedRoots
    -> checkout 或创建 managed worktree
    -> State Store 保存 Workspace Session
    -> Instruction/Skill Provider 加载目录摘要
    -> Context Provider 可选读取项目上下文
    -> 返回 workspaceId + bootstrap context
```

### 8.2 修改文件并运行测试

```text
read(workspaceId, path)
    -> Registry 解析 root
    -> File Provider 校验相对路径
    -> Kernel Policy 允许 read

edit(workspaceId, path, replacement)
    -> Policy 检查 write 和 approval
    -> File Provider 精确修改
    -> Event Bus 发布 tool.completed / file.changed

exec(workspaceId, command)
    -> Policy 检查 execute 和 approval
    -> Command Provider 在 workspace root 执行
    -> Process Session 返回结果或 sessionId

show_changes(workspaceId)
    -> Diff Provider 聚合当前 checkpoint
    -> 返回文本、structuredContent 和 UI Card
```

### 8.3 重启恢复

```text
Runtime 启动
    -> 读取持久化 Auth、Runtime、Workspace 和 Plugin 状态
    -> 恢复有效的 Workspace Session 元数据
    -> 检查目录、Git root 和 allowedRoots
    -> 丢弃失效绑定

ChatGPT Web -> 带 access token 请求 /mcp
    -> 创建新的 MCP Transport
    -> 通过 conversation binding 找回 Workspace Session
    -> 继续使用 workspaceId 对应的工作目录
```

MCP Transport 本身不需要跨进程恢复。恢复目标是工作区和任务状态，网络 Session 重新建立即可。

## 9. 落地顺序和退出标准

### M0：Runtime Kernel 扩展骨架

当前 M0 已有工具注册、插件 Host、基础编排、风险策略和事件边界，状态仍按路线图保持“进行中”。后续重点：

- 固化插件 API 版本、Provider 类型和命名空间规则。
- 补齐插件初始化失败回滚和权限元数据。
- 为 MCP Adapter、Workspace Provider 和 Context Provider 预留稳定接口。
- 保持严格 TypeScript，核心业务逻辑继续用单测覆盖。

退出标准：Kernel 契约、工具注册、插件加载、策略检查、基础编排和单测通过项目门禁。

### M1：Session、Snapshot 与 SQLite 状态

实现顺序：

1. SQLite Adapter 和 schema 版本管理。
2. Runtime Session、Workspace Session、Conversation Binding。
3. Snapshot/Checkpoint 抽象，先支持文件 diff metadata，再接 Git backend。
4. 重启恢复、失效路径清理和状态迁移。

退出标准：可以创建、恢复、触碰、关闭和回滚 Session；模拟进程重启后绑定仍可恢复；核心状态逻辑有单测。

### M2：MCP Gateway、本地工作区工具和 OAuth

建议按一个端到端竖切片推进：

1. Streamable HTTP `/mcp`、MCP Session Registry 和优雅关闭。
2. `open_workspace`、`read`、`write`、`edit`、`bash` 最小工具集。
3. allowed roots、workspaceId 归属、Shell 工作目录和输出预算。
4. 单用户 OAuth、一次性配对码、PKCE、Discovery、Token 刷新和撤销。
5. Checkout 复用和 Conversation Binding。
6. Worktree、`grep/glob/ls`、Codex compatibility profile。
7. Diff structured result 和可选 MCP Apps Card。

退出标准：固定 HTTPS/Tunnel 入口能完成首次配对；重启后授权仍有效；ChatGPT Web 或 MCP Inspector 可以完成打开工作区、读写文件和受控命令操作；路径穿越、越权 Workspace 和 OAuth 重放测试通过。

### M3：Context Provider 与插件生态基础

实现顺序：

1. Provider lifecycle、依赖和权限模型。
2. MCP Tool Provider：stdio、HTTP、Streamable HTTP 的统一适配。
3. Instruction/Skill Provider，加入 `AGENTS.md`、`CLAUDE.md` 和按需 Skill 读取。
4. CloudMind Context Provider，使用规范化 Git remote 作为 `contextKey`。
5. CodeGraph 等工程上下文 Provider。
6. 并行/条件 Workflow、UI Resource 和可选 Artifact Provider。

退出标准：CloudMind、CodeGraph 和外部 MCP 能以插件形式接入；任意一个 Provider 失效不会破坏 Kernel；工具能按 namespace、capability、scope 和 exposure 筛选；编排、状态和事件有集成测试。

## 10. 暂不实现和需要调整的部分

| DevSpace 能力或做法           | chatgpt2codex 当前处理                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| 把 Bash 作为唯一命令入口      | 抽象 `CommandExecutor`，为 Windows PowerShell/cmd、WSL 和 POSIX 提供适配器；项目配置决定默认执行器 |
| `codex` 工具名兼容模式        | 作为可选 Exposure Profile，Kernel 内部继续使用统一工具契约                                         |
| Linux 专属 Native Artifact    | 先不暴露；确认 Windows 安全发布方案后再做平台 Provider                                             |
| 进程内 Map 作为全部状态       | MCP Session 可以用内存，Workspace、Auth、Snapshot 和插件状态需要持久化                             |
| Shell 权限当作沙箱            | 明确标记为本地用户权限，必要时未来接入独立 Sandbox Provider                                        |
| DevSpace 单一应用里的工具注册 | 拆成 Native/MCP/Context/UI/Lifecycle Provider，统一由 Plugin Host 管理                             |
| CloudMind 直接嵌入 Kernel     | 使用 `ContextProvider`，CloudMind 不可用时核心编码流程仍可运行                                     |
| 立即实现完整多用户 SaaS       | 先做单用户 Owner；多用户、组织和外部身份属于后续产品线                                             |
| 建立独立 Artifact 服务        | 先做一次性下载 Provider；不引入持久 Artifact ID、配额和后台清理服务                                |

## 11. 验证策略

### 核心单测

- allowed root、路径规范化、符号链接和路径穿越。
- Workspace 创建、复用、Conversation Binding 和失效恢复。
- Worktree 的 Git root、无 commit、dirty source、baseRef 和清理。
- SQLite 状态创建、touch、关闭、恢复和 schema migration。
- MCP Session 注册、活跃时间、空闲清理、重复关闭和 Server shutdown。
- Tool Registry 的 namespace、重复注册、exposure 和 capability 筛选。
- Policy 对 read/write/execute/network、OAuth scope 和 approval token 的组合判断。
- Plugin API 版本、依赖、安装回滚和故障隔离。
- Orchestrator 的超时、取消、输出预算、顺序和并行执行。
- CloudMind Context Provider 的超时、降级、Secret 过滤和 contextKey。

### 集成和人工验收

- 使用 MCP Inspector 或等价测试客户端完成 Discovery、OAuth、Transport 和工具调用。
- 在固定 Tunnel hostname 下验证 ChatGPT Web 首次配对、刷新 Token、重启恢复和 revoke。
- 在 Windows 原生、WSL 和 Git Bash 环境分别验证命令 Provider。
- 验证一个工作区的修改能通过 structured diff 和 UI Card 被用户检查。
- 验证外部 MCP Server 断开后，Native Tools 和其他 Provider 仍可用。

当前阶段只新增设计文档，不启动 Dev Server，也不把上述未实现能力标记为已完成。

## 12. 参考资料

### DevSpace 文档

- [README](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/README.md)
- [Setup](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/setup.md)
- [Configuration](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/configuration.md)
- [Security Model](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/security.md)
- [ChatGPT Coding Workflow](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/chatgpt-coding-workflow.md)
- [Artifact Exchange](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/artifact-exchange.md)
- [Gotchas](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/docs/gotchas.md)

### DevSpace 源码

- [`src/server.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/server.ts)
- [`src/mcp-sessions.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/mcp-sessions.ts)
- [`src/workspaces.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/workspaces.ts)
- [`src/workspace-store.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/workspace-store.ts)
- [`src/git-worktrees.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/git-worktrees.ts)
- [`src/pi-tools.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/pi-tools.ts)
- [`src/artifact-tools.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/artifact-tools.ts)
- [`src/skills.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/skills.ts)
- [`src/local-agent-runtime.ts`](https://github.com/Waishnav/devspace/blob/9ffac21514d8c5d6bf09ea2fe844b41124b1c2ed/src/local-agent-runtime.ts)

### chatgpt2codex 文档

- [路线图](../roadmap.md)
- [Runtime Kernel](../模块设计/runtime-kernel.md)
- [MCP Gateway 与本地 OAuth](../模块设计/mcp-gateway-oauth.md)
