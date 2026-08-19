# chatgpt2codex 路线图

项目目标：构建一个本地优先、可扩展的 Agent Runtime，让 ChatGPT Web 可以安全使用本地工作区，并通过 MCP 编排与插件系统持续扩展能力。参考 DevSpace 的设计与本项目落地映射见 [DevSpace 设计与 chatgpt2codex 实现方案](./参考设计/DevSpace设计与chatgpt2codex实现方案.md)。

| 里程碑    | 目标                                        | 状态   | 依赖   | 模块文档                                                                                                    | 退出标准                                                                       |
| --------- | ------------------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [M0](#m0) | Runtime Kernel 扩展骨架                     | 已完成 | 无     | [Runtime Kernel](./模块设计/runtime-kernel.md)                                                              | 核心契约、工具注册、插件加载、基础编排和单测通过                               |
| M1        | Session、Snapshot 与 SQLite 状态            | 已完成 | M0     | [Session、Snapshot 与 SQLite 状态](./模块设计/session-snapshot-state.md)                                    | 可创建、恢复、回滚 Session，并通过测试验证                                     |
| M2        | MCP Transport、本地工作区工具与单用户 OAuth | 未开始 | M0     | [Runtime Kernel](./模块设计/runtime-kernel.md)；[MCP Gateway 与本地 OAuth](./模块设计/mcp-gateway-oauth.md) | 固定 HTTPS/Tunnel 入口可完成首次配对，重启后保持授权，并完成受控文件和命令操作 |
| M3        | Context Provider 与插件生态基础             | 未开始 | M1、M2 | [Runtime Kernel](./模块设计/runtime-kernel.md)                                                              | CodeGraph、CloudMind 等能力可作为插件接入                                      |

## M0

M0 建立长期可扩展的 Kernel 边界，核心只依赖契约，不绑定 CloudMind、Mem0、CodeGraph 或具体 MCP Server。完成依据包括可运行代码、核心逻辑单测和项目门禁通过。

## M2

M2 的 Transport、本地工作区工具和单用户 OAuth 设计与实现入口见 [MCP Gateway 与本地 OAuth](./模块设计/mcp-gateway-oauth.md)。
