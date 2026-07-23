export const ROUTING_ACTION_VALUES = {
  exclude: "true",
  after: "closetab",
} as const;

export type RoutingActionName = keyof typeof ROUTING_ACTION_VALUES;
export type RoutingActionValue = (typeof ROUTING_ACTION_VALUES)[RoutingActionName];

export const isRoutingActionName = (name: string): name is RoutingActionName =>
  name === "exclude" || name === "after";

export const routingActionValue = (name: string): RoutingActionValue | undefined =>
  isRoutingActionName(name) ? ROUTING_ACTION_VALUES[name] : undefined;
