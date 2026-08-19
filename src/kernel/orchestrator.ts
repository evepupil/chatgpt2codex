import type {
  ExecutionPolicy,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./contracts.js";
import { EventBus } from "./event-bus.js";
import { ToolRegistry } from "./tool-registry.js";

export interface OrchestratorOptions {
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
}

export class ToolOrchestrator {
  private readonly timeoutMs: number;
  private readonly maxOutputCharacters: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: ExecutionPolicy,
    private readonly events: EventBus,
    options: OrchestratorOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxOutputCharacters = options.maxOutputCharacters ?? 50_000;
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (tool === undefined) {
      return this.error(`Unknown tool: ${call.name}`);
    }

    const decision = await this.policy.evaluate(tool, context);
    if (!decision.allowed) {
      this.publish("tool.execution.denied", {
        callId: call.id,
        toolName: call.name,
        reason: decision.reason ?? "Policy denied execution",
      });
      return this.error(decision.reason ?? "Tool execution denied");
    }

    this.publish("tool.execution.started", { callId: call.id, toolName: call.name });
    const controller = new AbortController();
    const stopParentSignal = this.forwardAbort(context.signal, controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        tool.handler(call.input, { ...context, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`Tool timed out after ${this.timeoutMs}ms`));
          }, this.timeoutMs);
        }),
      ]);
      const normalized = this.limitOutput(result);
      this.publish("tool.execution.completed", {
        callId: call.id,
        toolName: call.name,
        isError: normalized.isError ?? false,
      });
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      this.publish("tool.execution.failed", { callId: call.id, toolName: call.name, message });
      return this.error(message);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      stopParentSignal();
    }
  }

  private limitOutput(result: ToolResult): ToolResult {
    if (result.content.length <= this.maxOutputCharacters) {
      return result;
    }

    return {
      ...result,
      content: `${result.content.slice(0, this.maxOutputCharacters)}\n[output truncated]`,
    };
  }

  private error(content: string): ToolResult {
    return { content, isError: true };
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.events.publish({ type, timestamp: new Date().toISOString(), payload });
  }

  private forwardAbort(signal: AbortSignal, controller: AbortController): () => void {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return () => undefined;
    }

    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }
}

export class DefaultExecutionPolicy implements ExecutionPolicy {
  async evaluate(tool: ToolDefinition, context: ToolExecutionContext) {
    if (tool.risk === "read" || context.approvalToken !== undefined) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Approval required for ${tool.risk} tool: ${tool.name}`,
    };
  }
}
