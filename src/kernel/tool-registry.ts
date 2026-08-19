import {
  RUNTIME_KERNEL_API_VERSION,
  type ToolDefinition,
  type ToolExposure,
  type ToolRegistration,
} from "./contracts.js";

export interface ToolListOptions {
  readonly exposure?: ToolExposure | "all";
  readonly capability?: string;
  readonly namespace?: string;
  readonly pluginId?: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(pluginId: string, registration: ToolRegistration): void {
    if (this.tools.has(registration.name)) {
      throw new Error(`Tool already registered: ${registration.name}`);
    }

    const namespace = this.resolveNamespace(registration);
    this.tools.set(registration.name, {
      ...registration,
      contractVersion: RUNTIME_KERNEL_API_VERSION,
      namespace,
      exposure: registration.exposure ?? "default",
      capabilities: [...(registration.capabilities ?? [])],
      pluginId,
    });
  }

  unregisterByPlugin(pluginId: string): number {
    let removed = 0;
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) {
        this.tools.delete(name);
        removed += 1;
      }
    }

    return removed;
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

      if (options.capability !== undefined && !tool.capabilities.includes(options.capability)) {
        return false;
      }

      if (options.namespace !== undefined && tool.namespace !== options.namespace) {
        return false;
      }

      return options.pluginId === undefined || tool.pluginId === options.pluginId;
    });
  }

  private resolveNamespace(registration: ToolRegistration): string {
    const separator = registration.name.indexOf(".");
    if (separator <= 0 || separator === registration.name.length - 1) {
      throw new Error(`Tool name must use namespace.name: ${registration.name}`);
    }

    const inferredNamespace = registration.name.slice(0, separator);
    if (registration.namespace !== undefined && registration.namespace !== inferredNamespace) {
      throw new Error(
        `Tool namespace does not match its name: ${registration.namespace} != ${inferredNamespace}`,
      );
    }

    return registration.namespace ?? inferredNamespace;
  }
}
