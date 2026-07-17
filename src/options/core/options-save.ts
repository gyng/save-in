import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { isStringKeyedRecord } from "../../shared/message-protocol.ts";
import type { SuccessfulApplyConfigResponse } from "../../shared/message-protocol.ts";

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

const isApplyRejection = (value: unknown): value is { name: string; reason: string } =>
  isStringKeyedRecord(value) && typeof value.name === "string" && typeof value.reason === "string";

const isSuccessfulApplyResponse = (response: unknown): response is SuccessfulApplyConfigResponse =>
  isStringKeyedRecord(response) &&
  response.type === MESSAGE_TYPES.APPLY_CONFIG_RESULT &&
  isStringKeyedRecord(response.body) &&
  typeof response.body.version === "number" &&
  Number.isSafeInteger(response.body.version) &&
  isStringKeyedRecord(response.body.applied) &&
  Array.isArray(response.body.rejected) &&
  response.body.rejected.every(isApplyRejection);

export const assertApplyAcknowledged = (response: unknown): SuccessfulApplyConfigResponse => {
  if (
    !isStringKeyedRecord(response) ||
    response.type !== MESSAGE_TYPES.APPLY_CONFIG_RESULT ||
    !isStringKeyedRecord(response.body)
  ) {
    throw new Error("No save acknowledgement was received");
  }
  if (!isSuccessfulApplyResponse(response)) {
    throw new Error("Invalid save acknowledgement was received");
  }
  return response;
};

export const assertApplySucceeded = (response: unknown): SuccessfulApplyConfigResponse => {
  const acknowledged = assertApplyAcknowledged(response);
  if (acknowledged.body.rejected.length) {
    throw new Error(
      acknowledged.body.rejected
        .map((item) => `${item.name || "option"}: ${item.reason || "rejected"}`)
        .join(", "),
    );
  }
  return acknowledged;
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
