import type { JsonObject, ToolResult } from "../kernel/contracts.js";
import type {
  McpErrorResponse,
  McpRequest,
  McpRequestId,
  McpRuntimeTool,
  McpSuccessResponse,
  McpTextContent,
  McpTool,
  McpToolCallResult,
  McpToolsListResult,
} from "./contracts.js";

export const MCP_ERROR_CODES = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface ParsedToolCallParams {
  readonly name: string;
  readonly input: JsonObject;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMcpRequestId(value: unknown): value is McpRequestId {
  return (
    (typeof value === "string" || typeof value === "number") &&
    (typeof value !== "number" || Number.isFinite(value))
  );
}

export function isMcpRequest(value: unknown): value is McpRequest {
  return (
    isJsonObject(value) &&
    value.jsonrpc === "2.0" &&
    isMcpRequestId(value.id) &&
    typeof value.method === "string"
  );
}

export function isMcpNotification(value: unknown): value is {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
} {
  return (
    isJsonObject(value) &&
    value.jsonrpc === "2.0" &&
    !Object.prototype.hasOwnProperty.call(value, "id") &&
    typeof value.method === "string"
  );
}

export function isToolsListParams(value: unknown): boolean {
  return value === undefined || isJsonObject(value);
}

export function parseToolCallParams(value: unknown): ParsedToolCallParams | undefined {
  if (!isJsonObject(value) || typeof value.name !== "string" || value.name.length === 0) {
    return undefined;
  }

  if (value.arguments === undefined) {
    return { name: value.name, input: {} };
  }

  return isJsonObject(value.arguments) ? { name: value.name, input: value.arguments } : undefined;
}

export function toMcpTool(tool: McpRuntimeTool): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { ...tool.inputSchema },
  };
}

export function toMcpToolCallResult(toolResult: ToolResult): McpToolCallResult {
  const content: McpTextContent[] = [{ type: "text", text: toolResult.content }];

  return {
    content,
    ...(toolResult.isError === undefined ? {} : { isError: toolResult.isError }),
    ...(toolResult.structured === undefined ? {} : { structuredContent: toolResult.structured }),
  };
}

export function successResponse<TResult>(
  id: McpRequestId,
  result: TResult,
): McpSuccessResponse<TResult> {
  return { jsonrpc: "2.0", id, result };
}

export function errorResponse(
  id: McpRequestId | null,
  code: number,
  message: string,
): McpErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
