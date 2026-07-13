import { OptionsManagement } from "../config/option.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import { parseAutoDownloadRules } from "../automation/auto-download-rules.ts";

export type ConfigWriteState = { queue: Promise<unknown> };
export type ConfigApplyResult = {
  applied: Record<string, unknown>;
  rejected: Array<{ name: string; reason: string }>;
};

type ConfigStorage = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

const equalStoredValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const validateConfig = (config: Record<string, unknown>): ConfigApplyResult => {
  const applied: Record<string, unknown> = {};
  const rejected: ConfigApplyResult["rejected"] = [];

  Object.keys(config).forEach((name) => {
    const key = OptionsManagement.OPTION_KEYS.find((definition) => definition.name === name);
    if (!key) {
      rejected.push({ name, reason: "unknown option" });
      return;
    }
    let value = config[name];
    if (key.type === OptionsManagement.OPTION_TYPES.BOOL && typeof value !== "boolean") {
      rejected.push({ name, reason: "expected a boolean" });
      return;
    }
    if (
      key.type === OptionsManagement.OPTION_TYPES.VALUE &&
      (value == null || typeof value === "object")
    ) {
      rejected.push({ name, reason: "expected a string or number" });
      return;
    }
    const validate = "validate" in key ? (key.validate as (stored: unknown) => boolean) : undefined;
    if (validate && !validate(value)) {
      rejected.push({ name, reason: "invalid value" });
      return;
    }
    try {
      if ("onSave" in key && typeof key.onSave === "function") {
        value = (key.onSave as (stored: unknown) => unknown)(value);
      }
      if (
        name === "filenamePatterns" &&
        typeof value === "string" &&
        parseRulesCollecting(value).errors.some((error) => !error.warning)
      ) {
        rejected.push({ name, reason: "invalid value" });
        return;
      }
      if (
        name === "autoDownloadRules" &&
        typeof value === "string" &&
        parseAutoDownloadRules(value).errors.length > 0
      ) {
        rejected.push({ name, reason: "invalid value" });
        return;
      }
    } catch {
      rejected.push({ name, reason: "invalid value" });
      return;
    }
    applied[name] = value;
  });

  return { applied, rejected };
};

export const applyConfigSerialized = (
  state: ConfigWriteState,
  storage: ConfigStorage,
  config: Record<string, unknown>,
  expected: Record<string, unknown> | undefined,
  reset: () => Promise<unknown>,
): Promise<ConfigApplyResult> => {
  const task = state.queue
    .catch(() => {})
    .then(async () => {
      const { applied, rejected } = validateConfig(config);
      const names = Object.keys(applied);
      if (expected && names.length) {
        const current = await storage.get(Object.keys(expected));
        const conflicts = Object.keys(expected).filter(
          (name) => !equalStoredValue(current[name], expected[name]),
        );
        if (conflicts.length) {
          conflicts.forEach((name) => rejected.push({ name, reason: "changed since save" }));
          return { applied: {}, rejected };
        }
      }
      if (names.length) {
        await storage.set(applied);
        await reset();
      }
      return { applied, rejected };
    });
  state.queue = task;
  return task;
};
