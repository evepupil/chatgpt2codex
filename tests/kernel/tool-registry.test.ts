import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/kernel/tool-registry.js";

const registration = {
  name: "fs.read_file",
  description: "Read a file",
  inputSchema: { type: "object" },
  risk: "read" as const,
  handler: async () => ({ content: "ok" }),
};

describe("ToolRegistry", () => {
  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register("core", registration);

    expect(() => registry.register("other", registration)).toThrow(
      "Tool already registered: fs.read_file",
    );
  });

  it("keeps internal tools out of the default exposure list", () => {
    const registry = new ToolRegistry();
    registry.register("core", registration);
    registry.register("core", {
      ...registration,
      name: "kernel.internal",
      exposure: "internal",
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(["fs.read_file"]);
    expect(registry.list({ exposure: "internal" }).map((tool) => tool.name)).toEqual([
      "kernel.internal",
    ]);
  });
});
