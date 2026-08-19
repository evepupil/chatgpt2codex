export const RUNTIME_KERNEL_API_VERSION = "1" as const;
export const RUNTIME_PLUGIN_API_VERSION = "1" as const;

export type RuntimeKernelApiVersion = typeof RUNTIME_KERNEL_API_VERSION;
export type RuntimePluginApiVersion = typeof RUNTIME_PLUGIN_API_VERSION;

export type JsonObject = Record<string, unknown>;

export type ToolRisk = "read" | "write" | "execute" | "network";

export type ToolExposure = "default" | "on-demand" | "internal";

export interface RuntimePrincipal {
  readonly id: string;
}

export interface ToolExecutionContext {
  readonly projectId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly approvalToken?: string;
  readonly principal?: RuntimePrincipal;
  readonly scopes?: readonly string[];
  readonly workspaceId?: string;
}

export interface ToolResult {
  readonly content: string;
  readonly structured?: unknown;
  readonly isError?: boolean;
}

export type ToolHandler = (input: JsonObject, context: ToolExecutionContext) => Promise<ToolResult>;

export interface ToolDefinition {
  readonly contractVersion: RuntimeKernelApiVersion;
  readonly name: string;
  readonly namespace: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: ToolRisk;
  readonly exposure: ToolExposure;
  readonly pluginId: string;
  readonly capabilities: readonly string[];
  readonly handler: ToolHandler;
}

export interface ToolRegistration {
  readonly name: string;
  readonly namespace?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: ToolRisk;
  readonly exposure?: ToolExposure;
  readonly capabilities?: readonly string[];
  readonly handler: ToolHandler;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: JsonObject;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface ExecutionPolicy {
  evaluate(tool: ToolDefinition, context: ToolExecutionContext): Promise<PolicyDecision>;
}

export type RuntimeEventType =
  | "plugin.install.started"
  | "plugin.install.failed"
  | "plugin.installed"
  | "plugin.uninstall.started"
  | "plugin.uninstall.failed"
  | "plugin.uninstalled"
  | "tool.execution.unknown"
  | "tool.execution.denied"
  | "tool.execution.started"
  | "tool.execution.cancelled"
  | "tool.execution.timed_out"
  | "tool.execution.completed"
  | "tool.execution.failed"
  | (string & {});

export interface RuntimeEvent<TPayload = unknown> {
  readonly contractVersion: RuntimeKernelApiVersion;
  readonly type: RuntimeEventType;
  readonly timestamp: string;
  readonly payload: TPayload;
}

export type RuntimeEventInput<TPayload = unknown> = Omit<
  RuntimeEvent<TPayload>,
  "contractVersion"
> & {
  readonly contractVersion?: RuntimeKernelApiVersion;
};

export interface RuntimePluginManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: RuntimePluginApiVersion;
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  readonly dependencies: readonly string[];
}

export interface PluginContext {
  readonly manifest: RuntimePluginManifest;
  registerTool(tool: ToolRegistration): void;
  publish<TPayload>(event: RuntimeEventInput<TPayload>): void;
}

export interface RuntimePlugin {
  readonly manifest: RuntimePluginManifest;
  setup(context: PluginContext): void | Promise<void>;
  teardown?(context: PluginContext): void | Promise<void>;
}
