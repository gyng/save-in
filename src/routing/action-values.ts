export const ROUTING_ACTION_VALUES = {
  exclude: "true",
  tab: "close",
} as const;

export type RoutingActionName = keyof typeof ROUTING_ACTION_VALUES;
export type RoutingActionValue = (typeof ROUTING_ACTION_VALUES)[RoutingActionName];

export const isRoutingActionName = (name: string): name is RoutingActionName =>
  name === "exclude" || name === "tab";

export const routingActionValue = (name: string): RoutingActionValue | undefined =>
  isRoutingActionName(name) ? ROUTING_ACTION_VALUES[name] : undefined;
