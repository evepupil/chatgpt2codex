import type {
  ExecutionPolicy,
  PolicyDecision,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  RuntimeEventType,
} from "./contracts.js";
import { EventBus } from "./event-bus.js";
import { ToolRegistry } from "./tool-registry.js";

export interface OrchestratorOptions {
  readonly timeoutMs?: number;
  readonly maxOutputCharacters?: number;
}

class ToolExecutionCancelledError extends Error {
  constructor() {
    super("Tool execution cancelled");
    this.name = "ToolExecutionCancelledError";
  }
}

class ToolExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Tool timed out after ${timeoutMs}ms`);
    this.name = "ToolExecutionTimeoutError";
  }
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
    this.validateOptions();
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (tool === undefined) {
      this.publish("tool.execution.unknown", { callId: call.id, toolName: call.name });
      return this.error(`Unknown tool: ${call.name}`);
    }

    if (context.signal.aborted) {
      return this.cancelled(call);
    }

    let decision: PolicyDecision;
    try {
      decision = await this.policy.evaluate(tool, context);
    } catch (error) {
      const message = this.errorMessage(error);
      this.publish("tool.execution.failed", {
        callId: call.id,
        toolName: call.name,
        phase: "policy",
        message,
      });
      return this.error(message);
    }

    if (!decision.allowed) {
      this.publish("tool.execution.denied", {
        callId: call.id,
        toolName: call.name,
        reason: decision.reason ?? "Policy denied execution",
      });
      return this.error(decision.reason ?? "Tool execution denied");
    }

    if (context.signal.aborted) {
      return this.cancelled(call);
    }

    this.publish("tool.execution.started", { callId: call.id, toolName: call.name });
    const controller = new AbortController();
    const cancellation = this.createCancellation(context.signal, controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const handler = Promise.resolve().then(() =>
        tool.handler(call.input, { ...context, signal: controller.signal }),
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new ToolExecutionTimeoutError(this.timeoutMs));
          reject(new ToolExecutionTimeoutError(this.timeoutMs));
        }, this.timeoutMs);
      });
      const result = await Promise.race([handler, timeoutPromise, cancellation.promise]);
      const normalized = this.limitOutput(result);
      this.publish("tool.execution.completed", {
        callId: call.id,
        toolName: call.name,
        isError: normalized.isError ?? false,
      });
      return normalized;
    } catch (error) {
      if (error instanceof ToolExecutionCancelledError) {
        this.publish("tool.execution.cancelled", {
          callId: call.id,
          toolName: call.name,
          message: error.message,
        });
        return this.error(error.message);
      }

      if (error instanceof ToolExecutionTimeoutError) {
        this.publish("tool.execution.timed_out", {
          callId: call.id,
          toolName: call.name,
          message: error.message,
        });
        return this.error(error.message);
      }

      const message = this.errorMessage(error);
      this.publish("tool.execution.failed", {
        callId: call.id,
        toolName: call.name,
        phase: "handler",
        message,
      });
      return this.error(message);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      cancellation.cleanup();
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

  private cancelled(call: ToolCall): ToolResult {
    this.publish("tool.execution.cancelled", {
      callId: call.id,
      toolName: call.name,
      message: "Tool execution cancelled",
    });
    return this.error("Tool execution cancelled");
  }

  private publish(type: RuntimeEventType, payload: Record<string, unknown>): void {
    this.events.publish({ type, timestamp: new Date().toISOString(), payload });
  }

  private createCancellation(
    signal: AbortSignal,
    controller: AbortController,
  ): { promise: Promise<never>; cleanup: () => void } {
    let listener: (() => void) | undefined;
    const promise = new Promise<never>((_, reject) => {
      const cancel = () => {
        controller.abort(signal.reason);
        reject(new ToolExecutionCancelledError());
      };

      if (signal.aborted) {
        cancel();
        return;
      }

      listener = cancel;
      signal.addEventListener("abort", cancel, { once: true });
    });

    return {
      promise,
      cleanup: () => {
        if (listener !== undefined) {
          signal.removeEventListener("abort", listener);
        }
      },
    };
  }

  private validateOptions(): void {
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 0) {
      throw new Error("timeoutMs must be a non-negative integer");
    }

    if (!Number.isInteger(this.maxOutputCharacters) || this.maxOutputCharacters < 0) {
      throw new Error("maxOutputCharacters must be a non-negative integer");
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Tool execution failed";
  }
}

export class DefaultExecutionPolicy implements ExecutionPolicy {
  async evaluate(tool: ToolDefinition, context: ToolExecutionContext): Promise<PolicyDecision> {
    if (
      tool.risk === "read" ||
      (context.approvalToken !== undefined && context.approvalToken.trim().length > 0)
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Approval required for ${tool.risk} tool: ${tool.name}`,
    };
  }
}
