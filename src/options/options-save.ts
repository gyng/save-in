type ApplyRejection = { name?: unknown; reason?: unknown };
type ApplyResponse = {
  type?: unknown;
  body?: { applied?: unknown; rejected?: unknown };
};

type SuccessfulApplyResponse = ApplyResponse & {
  type: "APPLY_CONFIG_RESULT";
  body: { applied: Record<string, unknown>; rejected: ApplyRejection[] };
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

export const assertApplySucceeded = (response: unknown): SuccessfulApplyResponse => {
  if (
    !isStringKeyedRecord(response) ||
    response.type !== "APPLY_CONFIG_RESULT" ||
    !isStringKeyedRecord(response.body)
  ) {
    throw new Error("No save acknowledgement was received");
  }
  const body = response.body;
  if (!isStringKeyedRecord(body.applied) || !Array.isArray(body.rejected)) {
    throw new Error("Invalid save acknowledgement was received");
  }
  const rejected = body.rejected as ApplyRejection[];
  if (rejected.length) {
    throw new Error(
      rejected
        .map((item) => `${String(item.name || "option")}: ${String(item.reason || "rejected")}`)
        .join(", "),
    );
  }
  return response as SuccessfulApplyResponse;
};

export const getAppliedValue = (response: unknown, name: string): unknown => {
  const applied =
    isStringKeyedRecord(response) && isStringKeyedRecord(response.body)
      ? response.body.applied
      : undefined;
  return applied && typeof applied === "object" && !Array.isArray(applied)
    ? Reflect.get(applied, name)
    : undefined;
};
import { isStringKeyedRecord } from "../shared/message-protocol.ts";
