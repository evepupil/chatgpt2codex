import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/kernel/event-bus.js";
import type { RuntimePlugin } from "../../src/kernel/contracts.js";
import { PluginHost } from "../../src/kernel/plugin-host.js";
import { ToolRegistry } from "../../src/kernel/tool-registry.js";

const manifest = {
  id: "sample",
  version: "0.1.0",
  apiVersion: "1",
  capabilities: ["filesystem"],
  permissions: ["filesystem.read"],
  dependencies: [],
} as const;

describe("PluginHost", () => {
  it("registers tools under the plugin namespace", async () => {
    const registry = new ToolRegistry();
    const events = new EventBus();
    const host = new PluginHost(registry, events);
    const plugin: RuntimePlugin = {
      manifest,
      setup(context) {
        context.registerTool({
          name: "sample.inspect",
          description: "Inspect the workspace",
          inputSchema: { type: "object" },
          risk: "read",
          handler: async () => ({ content: "workspace" }),
        });
      },
    };

    await host.install(plugin);

    expect(registry.get("sample.inspect")?.pluginId).toBe("sample");
    expect(host.list().map((item) => item.id)).toEqual(["sample"]);
  });

  it("rolls back tools when plugin setup fails", async () => {
    const registry = new ToolRegistry();
    const host = new PluginHost(registry, new EventBus());
    const plugin: RuntimePlugin = {
      manifest,
      setup(context) {
        context.registerTool({
          name: "sample.before_failure",
          description: "Temporary tool",
          inputSchema: { type: "object" },
          risk: "read",
          handler: async () => ({ content: "never" }),
        });
        throw new Error("setup failed");
      },
    };

    await expect(host.install(plugin)).rejects.toThrow("setup failed");
    expect(registry.get("sample.before_failure")).toBeUndefined();
  });
});
