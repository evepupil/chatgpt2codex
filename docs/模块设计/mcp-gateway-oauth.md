# MCP Gateway 与本地 OAuth

- 模块定位：为 npm 安装的本地 Runtime 提供 Streamable HTTP MCP 入口，并由本地进程完成单用户 OAuth、首次配对和长期授权恢复。
- 对应代码：待建 `src/gateway/`、`src/auth/`，以及本地启动入口。
- 所属里程碑：[M2：MCP Transport 与本地工作区工具](../roadmap.md#m2)
- 当前状态：设计完成，待实现
- 最近更新时间：2026-08-19

## 职责与边界

### 负责内容

- 在本地 Node 进程中提供 `/mcp` Streamable HTTP 入口。
- 提供 MCP Protected Resource Metadata 和 OAuth Authorization Server Metadata。
- 通过标准 OAuth Authorization Code + PKCE 流程连接 ChatGPT Web。
- 为每个 npm 安装实例维护一个 owner 用户和一个 `instanceId`。
- 首次连接使用一次性配对码，后续使用持久化的 OAuth grant、access token 和 refresh token。
- 将 OAuth 身份转换为 Kernel 能理解的 principal、scope、project 和 session 上下文。
- 让用户可以撤销全部授权、重新配对和轮换实例密钥。

### 不负责内容

- Cloudflare MCP Portal、Cloudflare Access 或 Cloudflare OAuth Provider。
- Cloudflare Tunnel 的身份认证。Tunnel 只负责把固定公网 HTTPS 域名转发到本地端口。
- 将 OAuth scope 直接当作高风险工具审批。写文件、执行命令和回滚仍由 Runtime Kernel 的策略层控制。
- 多用户 SaaS 账户体系、公开注册、邮件找回和组织管理。它们属于后续扩展。

## 结构与数据流

```text
ChatGPT Web
    -> https://mcp.example.com/mcp
    -> Cloudflare Tunnel
    -> 127.0.0.1:8787
        -> MCP Gateway
            -> OAuth Provider / Login / Consent
            -> MCP Transport
            -> Principal Resolver
                -> Runtime Kernel
                    -> Policy
                    -> Tool Orchestrator
                    -> Session / Workspace / Plugins
```

正式连接使用固定 Tunnel hostname。临时 `trycloudflare.com` 地址会改变 issuer、resource 和 Discovery 地址，只用于开发调试。

### 端点

```text
POST /mcp
GET  /oauth/authorize
POST /oauth/token
POST /oauth/register
GET  /.well-known/oauth-authorization-server
GET  /.well-known/oauth-protected-resource/mcp
GET  /login
POST /login
GET  /consent
POST /consent
```

`/oauth/register` 为 MCP Inspector 和旧客户端保留 DCR 兼容能力。CIMD 是面向 ChatGPT 的优先注册方式，DCR 作为兼容回退。

### 首次配对流程

```text
chatgpt2codex pair
    -> 生成高强度 pairing code，有效期 10 分钟
    -> 只保存 code hash，终端只显示一次

ChatGPT Web -> POST /mcp
    <- 401 + protected resource metadata
ChatGPT Web -> /oauth/authorize
    -> 用户输入 pairing code
    -> 校验 state、redirect_uri、resource、PKCE
    -> 校验 pairing code 并建立 owner 会话
    -> 用户确认授权
    -> 签发一次性 authorization code
ChatGPT Web -> /oauth/token
    -> code + code_verifier
    <- access token + refresh token
    -> pairing code 标记为 used
```

配对码只用于建立第一次授权。它不作为长期密码，也不会出现在 access token、日志或 MCP 工具输出中。

### 重启恢复流程

```text
Runtime 启动
    -> 从稳定数据目录读取 auth.sqlite
    -> 读取持久化 OAuth signing/cookie keys
    -> 初始化 SQLite Adapter 和 OAuth Provider

ChatGPT Web -> /mcp + access token
    -> 验证 token
    -> 继续调用 Kernel

access token 过期
    -> ChatGPT Web 使用 refresh token
    -> 服务端原子轮换 refresh token
    -> 返回新 access token
```

进程重启、电脑重启和 npm 升级都不应触发重新配对。删除认证数据库、删除密钥、修改 issuer、主动撤销或丢失 refresh token 时，才需要重新授权。

## 关键决策

1. **OAuth Provider 使用成熟开源实现**：采用 `oidc-provider`，由库处理 OAuth 核心协议、PKCE、Discovery、DCR、Resource Indicators、刷新和撤销。项目实现 Adapter、登录交互和 MCP 资源层，不手写密码学和 token 核心。
2. **OAuth 与 Runtime 同进程、模块分层**：初期不拆独立认证服务，减少本地安装、Tunnel 路由和内部信任链。`src/auth/` 只处理认证，`src/gateway/` 负责协议接入，Kernel 不依赖 OAuth 包。
3. **单用户 owner 模型**：`init` 创建唯一 owner；关闭公开注册。owner 由 `instanceId` 绑定，默认一次只保留一个活动 grant，重新配对时撤销旧 token。
4. **配对码一次性使用**：配对码使用至少 128 位随机值，保存哈希，设置过期时间、失败次数和 `usedAt`。比较过程需要防止时序泄露，并对授权端点限流。
5. **认证状态放在用户数据目录**：认证数据库和密钥放在 npm 包目录之外，例如 Windows 的 `%LOCALAPPDATA%\\gpt-web-codex`。项目、npm 包和 CLI 使用 `chatgpt2codex`，既定的用户数据目录标识继续保留，包升级不能覆盖其中的数据。
6. **密钥禁止启动时随机生成**：OAuth signing keys、cookie keys 和加密主密钥必须从持久存储恢复。密钥文件使用操作系统 ACL 或系统凭据存储保护。
7. **OAuth scope 与 Kernel 风险分层**：初始 scope 为 `runtime:read`、`runtime:write`、`runtime:execute`、`runtime:admin`。scope 只决定能力范围，Kernel policy 决定具体调用是否需要审批。
8. **MCP resource 严格绑定**：固定 `resource=https://mcp.example.com/mcp`，授权请求和 token 请求都校验 `resource`，MCP 请求验证 issuer、audience、expiry 和 scope。
9. **公开地址不承担保密职责**：Tunnel URL 泄露不会直接获得工具权限。所有工具调用都必须经过 Bearer Token、owner 绑定和 Kernel 策略。

## 持久化数据

认证数据至少包含以下逻辑实体：

```text
instance
  instanceId, issuer, createdAt, keyVersion

users
  id, role, status, createdAt

pairing_challenges
  id, codeHash, instanceId, expiresAt, usedAt, failedAttempts

oauth_clients
  clientId, redirectUris, clientMetadata, createdAt, expiresAt

oauth_grants
  id, userId, clientId, resource, scopes, status, createdAt, revokedAt

oauth_tokens
  grantId, tokenHash, tokenType, expiresAt, replacedBy, revokedAt

auth_sessions
  id, userId, expiresAt, revokedAt
```

原始配对码、access token、refresh token 和客户端密钥不能明文写入日志。数据库备份也属于敏感数据，应由本地文件权限和备份策略保护。

## 与 Kernel 的接口

Gateway 在完成 token 校验后构造认证上下文，再调用 Kernel：

```text
PrincipalContext
  principalId
  instanceId
  scopes
  projectId
  sessionId
  authMethod
```

`projectId` 和 `sessionId` 必须由本地 Runtime 校验或创建，不能直接信任 HTTP header。OAuth Bearer Token 不继续透传给 Workspace、插件或外部服务。

## 当前实现

当前仓库只实现 M0 Runtime Kernel：

- 没有 MCP HTTP Transport。
- 没有 Gateway、OAuth、SQLite State Store 或 Workspace 工具。
- Kernel 已具备工具风险、审批 token、事件和编排边界，可承接 Gateway 传入的权限上下文。
- 本文档记录 M2 的目标设计，不代表功能已经可运行。

## 验证方式

实现阶段至少需要覆盖：

- 配对码生成、过期、错误次数、单次消费和重放。
- OAuth state、PKCE S256、redirect URI、resource 和 issuer 校验。
- access token 过期、refresh token 原子轮换、撤销和重复刷新。
- 进程重启、电脑重启和 npm 升级后的授权恢复。
- 删除数据库、密钥轮换和主动 revoke 后必须重新配对。
- 401 Protected Resource Metadata、OAuth Discovery、DCR/CIMD。
- scope 与 Kernel 工具风险的组合策略。
- MCP Inspector 端到端授权。
- 固定 Tunnel hostname 下的 ChatGPT Web 真实连接。

项目门禁仍使用 `pnpm format`、`pnpm check` 和 `pnpm test`。OAuth 端到端验证需要在本地启动服务和固定 Tunnel 后单独执行，不能只用单元测试代替。

## 待扩展项

- Passkey/WebAuthn 登录，替换初始密码或配对码交互。
- 多用户和多 grant 管理。
- 外部 OIDC 身份提供商接入。
- 设备撤销、审计日志和会话管理界面。
- 断网恢复、备份恢复和密钥轮换工具。
- 除 Cloudflare Tunnel 外的反向代理和内网穿透方式。

## 改动历史

- 2026-08-19：确定本地单用户 OAuth、一次性配对码、持久化授权和固定 Tunnel hostname 设计。
- 2026-08-19：公开项目、npm 包和 CLI 统一命名为 `chatgpt2codex`，用户数据目录标识继续使用 `gpt-web-codex`。
