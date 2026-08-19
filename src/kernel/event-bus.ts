import {
  RUNTIME_KERNEL_API_VERSION,
  type RuntimeEvent,
  type RuntimeEventInput,
} from "./contracts.js";

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private readonly listeners = new Set<RuntimeEventListener>();

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish<TPayload>(event: RuntimeEventInput<TPayload>): RuntimeEvent<TPayload> {
    const normalized: RuntimeEvent<TPayload> = {
      ...event,
      contractVersion: event.contractVersion ?? RUNTIME_KERNEL_API_VERSION,
    };

    for (const listener of [...this.listeners]) {
      try {
        listener(normalized);
      } catch {
        // A telemetry listener must not change the result of a kernel operation.
      }
    }

    return normalized;
  }
}
