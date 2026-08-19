import { EventBus } from "./event-bus.js";
import type {
  PluginContext,
  RuntimePlugin,
  RuntimePluginManifest,
  RuntimeEvent,
} from "./contracts.js";
import { ToolRegistry } from "./tool-registry.js";

const KERNEL_PLUGIN_API_VERSION = "1";

export class PluginHost {
  private readonly plugins = new Map<string, RuntimePluginManifest>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly events: EventBus,
  ) {}

  async install(plugin: RuntimePlugin): Promise<void> {
    const { manifest } = plugin;
    this.validateManifest(manifest);

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin already installed: ${manifest.id}`);
    }

    const context: PluginContext = {
      manifest,
      registerTool: (tool) => this.registry.register(manifest.id, tool),
      publish: <TPayload>(event: RuntimeEvent<TPayload>) => this.events.publish(event),
    };

    try {
      await plugin.setup(context);
      this.plugins.set(manifest.id, manifest);
      this.events.publish({
        type: "plugin.installed",
        timestamp: new Date().toISOString(),
        payload: { pluginId: manifest.id, version: manifest.version },
      });
    } catch (error) {
      this.registry.unregisterByPlugin(manifest.id);
      throw error;
    }
  }

  list(): readonly RuntimePluginManifest[] {
    return [...this.plugins.values()];
  }

  private validateManifest(manifest: RuntimePluginManifest): void {
    if (manifest.apiVersion !== KERNEL_PLUGIN_API_VERSION) {
      throw new Error(
        `Unsupported plugin API version: ${manifest.apiVersion}; expected ${KERNEL_PLUGIN_API_VERSION}`,
      );
    }

    if (manifest.id.trim().length === 0) {
      throw new Error("Plugin id cannot be empty");
    }
  }
}
