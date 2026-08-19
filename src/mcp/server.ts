import type {
  McpExecutionContext,
  McpExecutionContextFactory,
  McpRequest,
  McpRequestOptions,
  McpResponse,
  McpRuntimeKernel,
} from "./contracts.js";
import {
  errorResponse,
  isJsonObject,
  isMcpNotification,
  isMcpRequest,
  isMcpRequestId,
  isToolsListParams,
  MCP_ERROR_CODES,
  parseToolCallParams,
  successResponse,
  toMcpTool,
  toMcpToolCallResult,
} from "./protocol.js";

export interface McpServerOptions {
  readonly executionContext: McpExecutionContext | McpExecutionContextFactory;
}

export class McpServer {
  private readonly executionContext: McpExecutionContext | McpExecutionContextFactory;
  private readonly pendingRequests = new Map<string | number, AbortController>();

  constructor(
    private readonly kernel: McpRuntimeKernel,
    options: McpServerOptions,
  ) {
    this.executionContext = options.executionContext;
  }

  async handleRequest(
    message: unknown,
    options: McpRequestOptions = {},
  ): Promise<McpResponse | undefined> {
    if (isMcpNotification(message)) {
      if (message.method === "notifications/cancelled") {
        this.cancelRequest(message.params);
      }
      return undefined;
    }

    if (!isMcpRequest(message)) {
      return errorResponse(null, MCP_ERROR_CODES.invalidRequest, "Invalid Request");
    }

    switch (message.method) {
      case "tools/list":
        return this.handleToolsList(message);
      case "tools/call":
        return this.handleToolsCall(message, options.signal);
      default:
        return errorResponse(
          message.id,
          MCP_ERROR_CODES.methodNotFound,
          `Method not found: ${message.method}`,
        );
    }
  }

  private handleToolsList(request: McpRequest): McpResponse {
    if (!isToolsListParams(request.params)) {
      return errorResponse(
        request.id,
        MCP_ERROR_CODES.invalidParams,
        "Invalid params for tools/list",
      );
    }

    try {
      const tools = this.kernel
        .listTools()
        .filter((tool) => tool.exposure === undefined || tool.exposure === "default")
        .map(toMcpTool);
      return successResponse(request.id, { tools });
    } catch (error) {
      return errorResponse(request.id, MCP_ERROR_CODES.internalError, errorMessage(error));
    }
  }

  private async handleToolsCall(
    request: McpRequest,
    parentSignal: AbortSignal | undefined,
  ): Promise<McpResponse> {
    const params = parseToolCallParams(request.params);
    if (params === undefined) {
      return errorResponse(
        request.id,
        MCP_ERROR_CODES.invalidParams,
        "Invalid params for tools/call",
      );
    }

    if (this.pendingRequests.has(request.id)) {
      return errorResponse(
        request.id,
        MCP_ERROR_CODES.invalidRequest,
        `Request id is already active: ${String(request.id)}`,
      );
    }

    const controller = new AbortController();
    const unlinkParent = linkAbortSignal(parentSignal, controller);
    this.pendingRequests.set(request.id, controller);

    try {
      const context = this.resolveExecutionContext(request, controller.signal);
      const result = await this.kernel.execute(
        { id: String(request.id), name: params.name, input: params.input },
        { ...context, signal: controller.signal },
      );
      return successResponse(request.id, toMcpToolCallResult(result));
    } catch (error) {
      return successResponse(
        request.id,
        toMcpToolCallResult({ content: errorMessage(error), isError: true }),
      );
    } finally {
      if (this.pendingRequests.get(request.id) === controller) {
        this.pendingRequests.delete(request.id);
      }
      unlinkParent();
    }
  }

  private resolveExecutionContext(request: McpRequest, signal: AbortSignal): McpExecutionContext {
    return typeof this.executionContext === "function"
      ? this.executionContext(request, signal)
      : this.executionContext;
  }

  private cancelRequest(params: unknown): void {
    if (!isJsonObject(params) || !isMcpRequestId(params.requestId)) {
      return;
    }

    const controller = this.pendingRequests.get(params.requestId);
    if (controller === undefined) {
      return;
    }

    if (typeof params.reason === "string") {
      controller.abort(params.reason);
    } else {
      controller.abort();
    }
  }
}

export { McpServer as McpServerAdapter };

function linkAbortSignal(
  parentSignal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (parentSignal === undefined) {
    return () => undefined;
  }

  const abort = () => {
    if (parentSignal.reason === undefined) {
      controller.abort();
    } else {
      controller.abort(parentSignal.reason);
    }
  };

  if (parentSignal.aborted) {
    abort();
    return () => undefined;
  }

  parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Tool execution failed";
}
