import { describe, expect, it, vi } from "vitest";
import type { McpRuntimeKernel } from "../../src/mcp/contracts.js";
import { McpServer } from "../../src/mcp/server.js";
import { RuntimeKernel } from "../../src/kernel/runtime-kernel.js";

const executionContext = {
  projectId: "project-1",
  sessionId: "session-1",
  principal: { id: "owner" },
  scopes: ["runtime:read"],
  workspaceId: "workspace-1",
};

describe("McpServer", () => {
  it("lists only default-exposure tools without leaking kernel metadata", async () => {
    const kernel = new RuntimeKernel();
    await kernel.installPlugin({
      manifest: {
        id: "sample",
        version: "0.1.0",
        apiVersion: "1",
        capabilities: [],
        permissions: [],
        dependencies: [],
      },
      setup(context) {
        context.registerTool({
          name: "sample.visible",
          description: "Visible tool",
          inputSchema: { type: "object" },
          risk: "read",
          handler: async () => ({ content: "ok" }),
        });
        context.registerTool({
          name: "sample.on_demand",
          description: "On-demand tool",
          inputSchema: { type: "object" },
          risk: "read",
          exposure: "on-demand",
          handler: async () => ({ content: "hidden" }),
        });
        context.registerTool({
          name: "sample.internal",
          description: "Internal tool",
          inputSchema: { type: "object" },
          risk: "read",
          exposure: "internal",
          handler: async () => ({ content: "hidden" }),
        });
      },
    });

    const server = new McpServer(kernel, { executionContext });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "sample.visible",
            description: "Visible tool",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
    expect(response).not.toHaveProperty("result.tools[0].pluginId");
    expect(response).not.toHaveProperty("result.tools[0].handler");
  });

  it("maps call arguments and the resolved execution context into Kernel execute", async () => {
    const execute = vi.fn(async () => ({
      content: "done",
      structured: { value: 42 },
      isError: false,
    }));
    const kernel: McpRuntimeKernel = {
      listTools: () => [],
      execute,
    };
    const createContext = vi.fn((_request, _signal) => executionContext);
    const server = new McpServer(kernel, { executionContext: createContext });
    const request = {
      jsonrpc: "2.0" as const,
      id: "call-1",
      method: "tools/call",
      params: { name: "sample.inspect", arguments: { query: "status" } },
    };

    const response = await server.handleRequest(request);

    expect(createContext).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(execute).toHaveBeenCalledWith(
      { id: "call-1", name: "sample.inspect", input: { query: "status" } },
      {
        ...executionContext,
        signal: expect.any(AbortSignal),
      },
    );
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        content: [{ type: "text", text: "done" }],
        structuredContent: { value: 42 },
        isError: false,
      },
    });
  });

  it("returns Kernel unknown-tool and handler failures as MCP isError results", async () => {
    const kernel = new RuntimeKernel();
    await kernel.installPlugin({
      manifest: {
        id: "sample",
        version: "0.1.0",
        apiVersion: "1",
        capabilities: [],
        permissions: [],
        dependencies: [],
      },
      setup(context) {
        context.registerTool({
          name: "sample.fails",
          description: "Failing tool",
          inputSchema: { type: "object" },
          risk: "read",
          handler: async () => {
            throw new Error("handler failed");
          },
        });
      },
    });
    const server = new McpServer(kernel, { executionContext });

    const unknown = await server.handleRequest({
      jsonrpc: "2.0",
      id: "unknown",
      method: "tools/call",
      params: { name: "sample.missing", arguments: {} },
    });
    const failed = await server.handleRequest({
      jsonrpc: "2.0",
      id: "failed",
      method: "tools/call",
      params: { name: "sample.fails", arguments: {} },
    });

    expect(unknown).toMatchObject({
      result: {
        content: [{ type: "text", text: "Unknown tool: sample.missing" }],
        isError: true,
      },
    });
    expect(failed).toMatchObject({
      result: {
        content: [{ type: "text", text: "handler failed" }],
        isError: true,
      },
    });
  });

  it("maps a cancelled MCP notification to the Kernel execution signal", async () => {
    const kernel = new RuntimeKernel();
    let started: () => void = () => undefined;
    const toolStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    await kernel.installPlugin({
      manifest: {
        id: "sample",
        version: "0.1.0",
        apiVersion: "1",
        capabilities: [],
        permissions: [],
        dependencies: [],
      },
      setup(context) {
        context.registerTool({
          name: "sample.wait",
          description: "Wait for cancellation",
          inputSchema: { type: "object" },
          risk: "execute",
          handler: async (_input, context) => {
            started();
            await new Promise<void>((resolve) => {
              context.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            return { content: "aborted" };
          },
        });
      },
    });
    const server = new McpServer(kernel, {
      executionContext: { ...executionContext, approvalToken: "approved" },
    });
    const execution = server.handleRequest({
      jsonrpc: "2.0",
      id: "cancel-me",
      method: "tools/call",
      params: { name: "sample.wait", arguments: {} },
    });

    await toolStarted;
    const cancellation = await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "cancel-me", reason: "client disconnected" },
    });
    const response = await execution;

    expect(cancellation).toBeUndefined();
    expect(response).toMatchObject({
      result: {
        content: [{ type: "text", text: "Tool execution cancelled" }],
        isError: true,
      },
    });
  });

  it("maps malformed requests and unsupported methods to JSON-RPC errors", async () => {
    const server = new McpServer({ listTools: () => [], execute: vi.fn() }, { executionContext });

    await expect(
      server.handleRequest({ jsonrpc: "2.0", id: 1, method: "unknown" }),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found: unknown" },
    });
    await expect(
      server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "sample.inspect", arguments: [] },
      }),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    await expect(server.handleRequest({ jsonrpc: "1.0" })).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("propagates a transport-provided AbortSignal to the Kernel", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async (_call, context) => {
      expect(context.signal.aborted).toBe(true);
      return { content: "cancelled", isError: true };
    });
    const server = new McpServer({ listTools: () => [], execute }, { executionContext });
    controller.abort();

    const response = await server.handleRequest(
      {
        jsonrpc: "2.0",
        id: "external-cancel",
        method: "tools/call",
        params: { name: "sample.inspect", arguments: {} },
      },
      { signal: controller.signal },
    );

    expect(response).toMatchObject({
      result: {
        content: [{ type: "text", text: "cancelled" }],
        isError: true,
      },
    });
  });
});
