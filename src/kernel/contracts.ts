export type JsonObject = Record<string, unknown>;

export type ToolRisk = "read" | "write" | "execute" | "network";

export type ToolExposure = "default" | "on-demand" | "internal";

export interface ToolExecutionContext {
  readonly projectId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly approvalToken?: string;
}

export interface ToolResult {
  readonly content: string;
  readonly structured?: unknown;
  readonly isError?: boolean;
}

export type ToolHandler = (input: JsonObject, context: ToolExecutionContext) => Promise<ToolResult>;

export interface ToolDefinition {
  readonly name: string;
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

export interface RuntimeEvent<TPayload = unknown> {
  readonly type: string;
  readonly timestamp: string;
  readonly payload: TPayload;
}

export interface RuntimePluginManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  readonly dependencies: readonly string[];
}

export interface PluginContext {
  readonly manifest: RuntimePluginManifest;
  registerTool(tool: ToolRegistration): void;
  publish<TPayload>(event: RuntimeEvent<TPayload>): void;
}

export interface RuntimePlugin {
  readonly manifest: RuntimePluginManifest;
  setup(context: PluginContext): void | Promise<void>;
}
