import type { RuntimeEvent } from "./contracts.js";

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private readonly listeners = new Set<RuntimeEventListener>();

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
