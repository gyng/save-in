type ApplyRejection = { name?: unknown; reason?: unknown };
type ApplyResponse = {
  type?: unknown;
  body?: { applied?: unknown; rejected?: unknown };
};

type OptionSchema = {
  keys: Array<{ name: string; type: string }>;
  types: { BOOL: string; VALUE: string };
};

export const collectOptionConfig = (schema: OptionSchema, scope?: string) =>
  schema.keys.reduce<Record<string, unknown>>((config, option) => {
    if (scope && option.name !== scope) return config;
    const element = document.getElementById(option.name);
    if (option.type === schema.types.BOOL && element instanceof HTMLInputElement) {
      config[option.name] = element.checked;
    } else if (
      option.type === schema.types.VALUE &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement)
    ) {
      config[option.name] = element.value;
    }
    return config;
  }, {});

export const assertApplySucceeded = <T extends ApplyResponse | null | undefined>(
  response: T,
): T => {
  if (!response || response.type !== "APPLY_CONFIG_RESULT" || !response.body) {
    throw new Error("No save acknowledgement was received");
  }
  if (
    !response.body.applied ||
    typeof response.body.applied !== "object" ||
    Array.isArray(response.body.applied) ||
    !Array.isArray(response.body.rejected)
  ) {
    throw new Error("Invalid save acknowledgement was received");
  }
  const rejected = response.body.rejected as ApplyRejection[];
  if (rejected.length) {
    throw new Error(
      rejected
        .map((item) => `${String(item.name || "option")}: ${String(item.reason || "rejected")}`)
        .join(", "),
    );
  }
  return response;
};

export const getAppliedValue = (response: ApplyResponse, name: string): unknown => {
  const applied = response.body?.applied;
  return applied && typeof applied === "object" && !Array.isArray(applied)
    ? Reflect.get(applied, name)
    : undefined;
};
