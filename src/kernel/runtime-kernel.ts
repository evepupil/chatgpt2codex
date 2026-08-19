import type {
  ExecutionPolicy,
  RuntimePlugin,
  ToolCall,
  ToolExecutionContext,
  ToolResult,
} from "./contracts.js";
import { EventBus } from "./event-bus.js";
import { ToolOrchestrator, DefaultExecutionPolicy } from "./orchestrator.js";
import { PluginHost } from "./plugin-host.js";
import { ToolRegistry, type ToolListOptions } from "./tool-registry.js";

export interface RuntimeKernelOptions {
  readonly policy?: ExecutionPolicy;
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
}

export class RuntimeKernel {
  readonly events: EventBus;
  readonly tools: ToolRegistry;
  readonly plugins: PluginHost;
  readonly orchestrator: ToolOrchestrator;

  constructor(options: RuntimeKernelOptions = {}) {
    this.events = new EventBus();
    this.tools = new ToolRegistry();
    this.plugins = new PluginHost(this.tools, this.events);
    this.orchestrator = new ToolOrchestrator(
      this.tools,
      options.policy ?? new DefaultExecutionPolicy(),
      this.events,
      options,
    );
  }

  installPlugin(plugin: RuntimePlugin): Promise<void> {
    return this.plugins.install(plugin);
  }

  listTools(options?: ToolListOptions) {
    return this.tools.list(options);
  }

  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    return this.orchestrator.execute(call, context);
  }
}
