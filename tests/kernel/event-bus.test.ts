import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/kernel/event-bus.js";

describe("EventBus", () => {
  it("normalizes the runtime contract version and supports unsubscribe", () => {
    const bus = new EventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event.type);
      expect(event.contractVersion).toBe("1");
    });

    bus.publish({ type: "custom.event", timestamp: "2026-08-20T00:00:00.000Z", payload: {} });
    unsubscribe();
    bus.publish({ type: "custom.event", timestamp: "2026-08-20T00:00:01.000Z", payload: {} });

    expect(received).toEqual(["custom.event"]);
  });

  it("isolates listener failures", () => {
    const bus = new EventBus();
    let reached = false;
    bus.subscribe(() => {
      throw new Error("listener failed");
    });
    bus.subscribe(() => {
      reached = true;
    });

    expect(() =>
      bus.publish({ type: "custom.event", timestamp: new Date().toISOString(), payload: {} }),
    ).not.toThrow();
    expect(reached).toBe(true);
  });
});
