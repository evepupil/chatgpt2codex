import { describe, expect, it } from "vitest";
import {
  isJsonObject,
  parseToolCallParams,
  toMcpTool,
  toMcpToolCallResult,
} from "../../src/mcp/protocol.js";

describe("MCP protocol mapping", () => {
  it("accepts object arguments and defaults missing arguments to an empty object", () => {
    expect(parseToolCallParams({ name: "fs.read_file", arguments: { path: "README.md" } })).toEqual(
      {
        name: "fs.read_file",
        input: { path: "README.md" },
      },
    );
    expect(parseToolCallParams({ name: "fs.read_file" })).toEqual({
      name: "fs.read_file",
      input: {},
    });
    expect(parseToolCallParams({ name: "fs.read_file", arguments: [] })).toBeUndefined();
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject([])).toBe(false);
  });

  it("maps only public tool metadata", () => {
    const tool = {
      name: "fs.read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      exposure: "default" as const,
      pluginId: "filesystem",
      handler: async () => ({ content: "secret" }),
    };

    expect(toMcpTool(tool)).toEqual({
      name: "fs.read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    });
    expect(toMcpTool(tool)).not.toHaveProperty("pluginId");
    expect(toMcpTool(tool)).not.toHaveProperty("handler");
  });

  it("maps text, structured data, and error state to MCP call results", () => {
    expect(
      toMcpToolCallResult({
        content: "failed",
        structured: { code: "E_FAIL", retryable: false },
        isError: true,
      }),
    ).toEqual({
      content: [{ type: "text", text: "failed" }],
      structuredContent: { code: "E_FAIL", retryable: false },
      isError: true,
    });

    expect(toMcpToolCallResult({ content: "ok" })).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });
});
