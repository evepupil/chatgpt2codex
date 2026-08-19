# chatgpt2codex

一个面向 ChatGPT Web 编程工作流的本地 Agent Runtime。

ChatGPT Web 负责推理，Runtime 负责本地工作区、MCP 工具编排、Session 状态和插件增强。项目保持独立品牌，CloudMind 未来通过可选 Context Provider 接入。

## 当前状态

M0 正在进行：Runtime Kernel 的扩展契约、工具注册、插件宿主和基础执行编排已建立。

## 开发

```bash
pnpm install
pnpm gate
```

路线图见 [`docs/roadmap.md`](docs/roadmap.md)，Kernel 设计见 [`docs/模块设计/runtime-kernel.md`](docs/模块设计/runtime-kernel.md)。
