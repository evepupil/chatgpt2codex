import { randomUUID } from "node:crypto";

export interface StateManagerOptions {
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export function nextStateId(options: StateManagerOptions): string {
  return options.idGenerator?.() ?? randomUUID();
}

export function currentTimestamp(options: StateManagerOptions): string {
  return (options.now ?? (() => new Date()))().toISOString();
}

export function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
}
