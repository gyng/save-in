import type { RoutingContent, RuleError } from "./rule-types.ts";

export type RoutingTab = { title?: string } | null | undefined;

export type RoutingPorts = {
  getMessage(key: string): string;
  getCurrentTab(): RoutingTab;
  isDebug(): boolean;
  recordRuleErrors(errors: RuleError[]): void;
  logDebug(...values: unknown[]): void;
  nextCounter(): Promise<number>;
  peekCounter(): Promise<number>;
  resolveContent(url: string): Promise<RoutingContent | null>;
};

const ports: RoutingPorts = {
  // Domain validation remains useful before a browser adapter is installed
  // (for example in unit tests and command-line architecture checks).
  getMessage: (key) => key,
  getCurrentTab: () => undefined,
  isDebug: () => false,
  recordRuleErrors: () => undefined,
  logDebug: (...values) => console.log(...values), // eslint-disable-line no-console
  nextCounter: () => Promise.reject(new Error("Routing counter has not been configured")),
  peekCounter: () => Promise.reject(new Error("Routing counter has not been configured")),
  resolveContent: () => Promise.resolve(null),
};

export const configureRoutingPorts = (configured: Partial<RoutingPorts>) => {
  Object.assign(ports, configured);
};

export const routingPorts = ports;
