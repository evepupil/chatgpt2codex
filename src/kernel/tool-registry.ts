import type { ToolDefinition, ToolExposure, ToolRegistration } from "./contracts.js";

export interface ToolListOptions {
  readonly exposure?: ToolExposure | "all";
  readonly capability?: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(pluginId: string, registration: ToolRegistration): void {
    if (this.tools.has(registration.name)) {
      throw new Error(`Tool already registered: ${registration.name}`);
    }

    this.tools.set(registration.name, {
      ...registration,
      exposure: registration.exposure ?? "default",
      capabilities: registration.capabilities ?? [],
      pluginId,
    });
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(options: ToolListOptions = {}): readonly ToolDefinition[] {
    const exposure = options.exposure ?? "default";

    return [...this.tools.values()].filter((tool) => {
      if (exposure !== "all" && tool.exposure !== exposure) {
        return false;
      }

      return options.capability === undefined || tool.capabilities.includes(options.capability);
    });
  }
}
