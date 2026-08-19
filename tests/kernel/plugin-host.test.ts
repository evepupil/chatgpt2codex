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

  it("publishes lifecycle events and removes tools during uninstall", async () => {
    const registry = new ToolRegistry();
    const events = new EventBus();
    const eventTypes: string[] = [];
    events.subscribe((event) => eventTypes.push(event.type));
    const host = new PluginHost(registry, events);
    let tornDown = false;
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
      teardown(context) {
        tornDown = context.manifest.id === "sample";
      },
    };

    await host.install(plugin);
    expect(await host.uninstall("sample")).toBe(true);

    expect(tornDown).toBe(true);
    expect(registry.get("sample.inspect")).toBeUndefined();
    expect(host.list()).toEqual([]);
    expect(eventTypes).toEqual([
      "plugin.install.started",
      "plugin.installed",
      "plugin.uninstall.started",
      "plugin.uninstalled",
    ]);
  });

  it("isolates load failures and reports them as events", async () => {
    const registry = new ToolRegistry();
    const events = new EventBus();
    const eventTypes: string[] = [];
    events.subscribe((event) => eventTypes.push(event.type));
    const host = new PluginHost(registry, events);
    const plugin: RuntimePlugin = {
      manifest,
      setup() {
        throw new Error("setup failed");
      },
    };

    await expect(host.install(plugin)).rejects.toThrow("setup failed");

    expect(host.list()).toEqual([]);
    expect(eventTypes).toEqual(["plugin.install.started", "plugin.install.failed"]);
  });

  it("rejects plugins with missing dependencies without touching installed plugins", async () => {
    const registry = new ToolRegistry();
    const host = new PluginHost(registry, new EventBus());
    await host.install({ manifest, setup() {} });

    const dependent: RuntimePlugin = {
      manifest: { ...manifest, id: "dependent", dependencies: ["missing"] },
      setup() {},
    };

    await expect(host.install(dependent)).rejects.toThrow("Missing plugin dependencies: missing");
    expect(host.list().map((item) => item.id)).toEqual(["sample"]);
  });
});
