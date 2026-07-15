import type { RefererProtection } from "../shared/protected-fetch.ts";
import type { RoutingContent, RuleError } from "./rule-types.ts";

export type RoutingTab = { title?: string | undefined } | null | undefined;
export type ProtectedRequestMethod = "get" | "head";

export type RoutingPorts = {
  getMessage(key: string): string;
  getCurrentTab(): RoutingTab;
  isDebug(): boolean;
  recordRuleErrors(errors: RuleError[]): void;
  logDebug(...values: unknown[]): void;
  nextCounter(): Promise<number>;
  nextPrivateCounter(): Promise<number>;
  peekCounter(): Promise<number>;
  resolveContent(
    url: string,
    privateContext?: boolean,
    signal?: AbortSignal,
    requestId?: string,
    referer?: string,
  ): Promise<RoutingContent | null>;
  withRequestReferer<T>(
    url: string,
    referer: string,
    operation: (protection?: RefererProtection) => Promise<T>,
    requestMethods?: ProtectedRequestMethod[],
  ): Promise<T>;
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
  nextPrivateCounter: () =>
    Promise.reject(new Error("Private routing counter has not been configured")),
  peekCounter: () => Promise.reject(new Error("Routing counter has not been configured")),
  resolveContent: () => Promise.resolve(null),
  withRequestReferer: async <T>(
    _url: string,
    _referer: string,
    operation: (protection?: RefererProtection) => Promise<T>,
  ): Promise<T> => operation(),
};

export const configureRoutingPorts = (configured: Partial<RoutingPorts>) => {
  Object.assign(ports, configured);
};

export const routingPorts = ports;
