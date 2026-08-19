import { EventBus } from "./event-bus.js";
import type {
  PluginContext,
  RuntimePlugin,
  RuntimePluginManifest,
  RuntimeEventInput,
  RuntimeEventType,
} from "./contracts.js";
import { ToolRegistry } from "./tool-registry.js";

import { RUNTIME_PLUGIN_API_VERSION } from "./contracts.js";

interface InstalledPlugin {
  readonly plugin: RuntimePlugin;
  readonly context: PluginContext;
  readonly manifest: RuntimePluginManifest;
}

export class PluginHost {
  private readonly plugins = new Map<string, InstalledPlugin>();
  private readonly loading = new Set<string>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly events: EventBus,
  ) {}

  async install(plugin: RuntimePlugin): Promise<void> {
    const { manifest } = plugin;
    this.publish("plugin.install.started", {
      pluginId: manifest.id,
      version: manifest.version,
    });

    let ownsRegistration = false;
    try {
      this.validateManifest(manifest);
      if (this.plugins.has(manifest.id) || this.loading.has(manifest.id)) {
        throw new Error(`Plugin already installed: ${manifest.id}`);
      }
      this.validateDependencies(manifest);

      this.loading.add(manifest.id);
      ownsRegistration = true;
      const context = this.createContext(manifest);
      await plugin.setup(context);
      this.plugins.set(manifest.id, { plugin, context, manifest });
      this.publish("plugin.installed", {
        pluginId: manifest.id,
        version: manifest.version,
      });
    } catch (error) {
      if (ownsRegistration) {
        this.registry.unregisterByPlugin(manifest.id);
      }
      this.publish("plugin.install.failed", {
        pluginId: manifest.id,
        version: manifest.version,
        message: this.errorMessage(error),
      });
      throw error;
    } finally {
      this.loading.delete(manifest.id);
    }
  }

  async uninstall(pluginId: string): Promise<boolean> {
    const installed = this.plugins.get(pluginId);
    if (installed === undefined) {
      return false;
    }

    this.publish("plugin.uninstall.started", { pluginId });
    try {
      await installed.plugin.teardown?.(installed.context);
      this.registry.unregisterByPlugin(pluginId);
      this.plugins.delete(pluginId);
      this.publish("plugin.uninstalled", {
        pluginId,
        version: installed.manifest.version,
      });
      return true;
    } catch (error) {
      this.registry.unregisterByPlugin(pluginId);
      this.plugins.delete(pluginId);
      this.publish("plugin.uninstall.failed", {
        pluginId,
        version: installed.manifest.version,
        message: this.errorMessage(error),
      });
      throw error;
    }
  }

  list(): readonly RuntimePluginManifest[] {
    return [...this.plugins.values()].map((installed) => installed.manifest);
  }

  private validateManifest(manifest: RuntimePluginManifest): void {
    if (manifest.apiVersion !== RUNTIME_PLUGIN_API_VERSION) {
      throw new Error(
        `Unsupported plugin API version: ${manifest.apiVersion}; expected ${RUNTIME_PLUGIN_API_VERSION}`,
      );
    }

    if (manifest.id.trim().length === 0 || manifest.id !== manifest.id.trim()) {
      throw new Error("Plugin id must be a non-empty trimmed string");
    }

    if (manifest.version.trim().length === 0) {
      throw new Error("Plugin version cannot be empty");
    }
  }

  private validateDependencies(manifest: RuntimePluginManifest): void {
    const missing = manifest.dependencies.filter((dependency) => !this.plugins.has(dependency));
    if (missing.length > 0) {
      throw new Error(`Missing plugin dependencies: ${missing.join(", ")}`);
    }
  }

  private createContext(manifest: RuntimePluginManifest): PluginContext {
    return {
      manifest,
      registerTool: (tool) => this.registry.register(manifest.id, tool),
      publish: <TPayload>(event: RuntimeEventInput<TPayload>) => this.events.publish(event),
    };
  }

  private publish(type: RuntimeEventType, payload: Record<string, unknown>): void {
    this.events.publish({ type, timestamp: new Date().toISOString(), payload });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Plugin operation failed";
  }
}
