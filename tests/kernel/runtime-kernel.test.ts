import { describe, expect, it } from "vitest";
import { RuntimeKernel } from "../../src/kernel/runtime-kernel.js";

describe("RuntimeKernel", () => {
  it("combines plugin, tool, event, and execution APIs", async () => {
    const kernel = new RuntimeKernel();
    const eventTypes: string[] = [];
    const unsubscribe = kernel.subscribe((event) => eventTypes.push(event.type));

    await kernel.installPlugin({
      manifest: {
        id: "sample",
        version: "0.1.0",
        apiVersion: "1",
        capabilities: ["inspection"],
        permissions: [],
        dependencies: [],
      },
      setup(context) {
        context.registerTool({
          name: "sample.inspect",
          description: "Inspect runtime state",
          inputSchema: { type: "object" },
          risk: "read",
          handler: async () => ({ content: "ok" }),
        });
      },
    });

    const result = await kernel.execute(
      { id: "call-1", name: "sample.inspect", input: {} },
      {
        projectId: "project-1",
        sessionId: "session-1",
        signal: new AbortController().signal,
        principal: { id: "owner" },
        scopes: ["runtime:read"],
      },
    );

    expect(result).toEqual({ content: "ok" });
    expect(kernel.listPlugins().map((plugin) => plugin.id)).toEqual(["sample"]);
    expect(kernel.listTools().map((tool) => tool.name)).toEqual(["sample.inspect"]);
    expect(eventTypes).toEqual([
      "plugin.install.started",
      "plugin.installed",
      "tool.execution.started",
      "tool.execution.completed",
    ]);

    expect(await kernel.uninstallPlugin("sample")).toBe(true);
    expect(kernel.listTools()).toEqual([]);
    unsubscribe();
    kernel.close();
  });
});
