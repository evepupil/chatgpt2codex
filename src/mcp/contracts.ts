import type {
  JsonObject,
  RuntimePrincipal,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
  ToolExposure,
} from "../kernel/contracts.js";

export type McpRequestId = string | number;
export type McpResponseId = McpRequestId | null;

export interface McpRequest {
  readonly jsonrpc: "2.0";
  readonly id: McpRequestId;
  readonly method: string;
  readonly params?: unknown;
}

export interface McpNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface McpRequestOptions {
  readonly signal?: AbortSignal;
}

export interface McpRuntimeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly exposure?: ToolExposure;
}

export interface McpRuntimeKernel {
  listTools(): readonly McpRuntimeTool[];
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface McpExecutionContext {
  readonly projectId: string;
  readonly sessionId: string;
  readonly approvalToken?: string;
  readonly principal?: RuntimePrincipal;
  readonly scopes?: readonly string[];
  readonly workspaceId?: string;
}

export type McpExecutionContextFactory = (
  request: McpRequest,
  signal: AbortSignal,
) => McpExecutionContext;

export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface McpToolsListResult {
  readonly tools: McpTool[];
}

export interface McpToolCallResult {
  readonly content: McpTextContent[];
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

export interface McpSuccessResponse<TResult> {
  readonly jsonrpc: "2.0";
  readonly id: McpResponseId;
  readonly result: TResult;
}

export interface McpError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface McpErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: McpResponseId;
  readonly error: McpError;
}

export type McpResponse =
  McpSuccessResponse<McpToolsListResult> | McpSuccessResponse<McpToolCallResult> | McpErrorResponse;
