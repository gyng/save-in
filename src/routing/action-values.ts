// The single spelling table for routing action clauses. The parser and
// grammar own validation; editor surfaces read this module so an inserted or
// repaired clause can never drift from the spelling the parser accepts.
export const ROUTING_ACTION_VALUES = {
  exclude: "true",
  after: "close-tab",
} as const;

type RoutingActionName = keyof typeof ROUTING_ACTION_VALUES;

const isRoutingActionName = (name: string): name is RoutingActionName =>
  name === "exclude" || name === "after";

export const routingActionValue = (
  name: string,
): (typeof ROUTING_ACTION_VALUES)[RoutingActionName] | undefined =>
  isRoutingActionName(name) ? ROUTING_ACTION_VALUES[name] : undefined;
