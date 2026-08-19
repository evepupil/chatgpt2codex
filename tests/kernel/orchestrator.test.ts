import { describe, expect, it } from "vitest";
import { DefaultExecutionPolicy, ToolOrchestrator } from "../../src/kernel/orchestrator.js";
import { EventBus } from "../../src/kernel/event-bus.js";
import { ToolRegistry } from "../../src/kernel/tool-registry.js";

const context = {
  projectId: "project-1",
  sessionId: "session-1",
  signal: new AbortController().signal,
};

describe("ToolOrchestrator", () => {
  it("requires approval for write tools", async () => {
    const registry = new ToolRegistry();
    registry.register("core", {
      name: "fs.write_file",
      description: "Write a file",
      inputSchema: { type: "object" },
      risk: "write",
      handler: async () => ({ content: "written" }),
    });
    const orchestrator = new ToolOrchestrator(
      registry,
      new DefaultExecutionPolicy(),
      new EventBus(),
    );

    const result = await orchestrator.execute(
      { id: "call-1", name: "fs.write_file", input: {} },
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Approval required");
  });

  it("truncates oversized tool output", async () => {
    const registry = new ToolRegistry();
    registry.register("core", {
      name: "fs.read_file",
      description: "Read a file",
      inputSchema: { type: "object" },
      risk: "read",
      handler: async () => ({ content: "1234567890" }),
    });
    const orchestrator = new ToolOrchestrator(
      registry,
      new DefaultExecutionPolicy(),
      new EventBus(),
      { maxOutputCharacters: 5 },
    );

    const result = await orchestrator.execute(
      { id: "call-2", name: "fs.read_file", input: {} },
      context,
    );

    expect(result.content).toBe("12345\n[output truncated]");
  });

  it("returns a timeout error and aborts the tool", async () => {
    const registry = new ToolRegistry();
    let aborted = false;
    registry.register("core", {
      name: "shell.long_running",
      description: "Run a long command",
      inputSchema: { type: "object" },
      risk: "execute",
      handler: async (_input, toolContext) => {
        await new Promise<void>((resolve) => {
          toolContext.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return { content: "aborted" };
      },
    });
    const orchestrator = new ToolOrchestrator(
      registry,
      new DefaultExecutionPolicy(),
      new EventBus(),
      { timeoutMs: 10 },
    );

    const result = await orchestrator.execute(
      { id: "call-3", name: "shell.long_running", input: {} },
      { ...context, approvalToken: "approved" },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("timed out");
    expect(aborted).toBe(true);
  });

  it("returns promptly when the parent call is cancelled", async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    let handlerStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    registry.register("core", {
      name: "shell.ignores_abort",
      description: "Never-ending tool",
      inputSchema: { type: "object" },
      risk: "execute",
      handler: async () => {
        handlerStarted();
        return new Promise(() => undefined);
      },
    });
    const eventTypes: string[] = [];
    const events = new EventBus();
    events.subscribe((event) => eventTypes.push(event.type));
    const orchestrator = new ToolOrchestrator(registry, new DefaultExecutionPolicy(), events, {
      timeoutMs: 5_000,
    });

    const execution = orchestrator.execute(
      { id: "call-4", name: "shell.ignores_abort", input: {} },
      { ...context, signal: controller.signal, approvalToken: "approved" },
    );
    await started;
    controller.abort();
    const result = await execution;

    expect(result).toMatchObject({ content: "Tool execution cancelled", isError: true });
    expect(eventTypes).toEqual(["tool.execution.started", "tool.execution.cancelled"]);
  });

  it("reports unknown tools and handler failures through the event stream", async () => {
    const registry = new ToolRegistry();
    registry.register("core", {
      name: "core.fails",
      description: "Failing tool",
      inputSchema: { type: "object" },
      risk: "read",
      handler: async () => {
        throw new Error("handler failed");
      },
    });
    const eventTypes: string[] = [];
    const events = new EventBus();
    events.subscribe((event) => eventTypes.push(event.type));
    const orchestrator = new ToolOrchestrator(registry, new DefaultExecutionPolicy(), events);

    const unknown = await orchestrator.execute(
      { id: "call-5", name: "core.missing", input: {} },
      context,
    );
    const failed = await orchestrator.execute(
      { id: "call-6", name: "core.fails", input: {} },
      context,
    );

    expect(unknown.isError).toBe(true);
    expect(failed).toMatchObject({ content: "handler failed", isError: true });
    expect(eventTypes).toEqual([
      "tool.execution.unknown",
      "tool.execution.started",
      "tool.execution.failed",
    ]);
  });

  it("does not treat an empty approval token as approval", async () => {
    const registry = new ToolRegistry();
    registry.register("core", {
      name: "core.write",
      description: "Write data",
      inputSchema: { type: "object" },
      risk: "write",
      handler: async () => ({ content: "written" }),
    });
    const orchestrator = new ToolOrchestrator(
      registry,
      new DefaultExecutionPolicy(),
      new EventBus(),
    );

    const result = await orchestrator.execute(
      { id: "call-7", name: "core.write", input: {} },
      { ...context, approvalToken: " " },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Approval required");
  });
});
