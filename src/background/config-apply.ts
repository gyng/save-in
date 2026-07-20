import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import { parseAutoDownloadRules } from "../automation/auto-download-rules.ts";
import { parseWebhookEndpoints } from "../shared/webhook.ts";

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

// Only a combined mode that is on carries behavior to split. This config is
// partial and its result is written straight to storage, so expanding the
// already-default `false` would clear whichever split option the user had set
// without the caller ever naming it. The stored-profile migration in option.ts
// draws the same line on `=== true`.
const expandLegacyRouteExclusive = (config: Record<string, unknown>): Record<string, unknown> => {
  if (
    config.routeExclusive !== true ||
    Object.hasOwn(config, "routeHideFolderChoices") ||
    Object.hasOwn(config, "routeSkipUnmatched")
  ) {
    return config;
  }
  return {
    ...config,
    routeExclusive: false,
    routeHideFolderChoices: true,
    routeSkipUnmatched: true,
  };
};

// Whether an http:// endpoint is one Save In will send to is the answer to a
// different option, so option-schema.ts cannot decide it: its validate hook sees
// one value at a time. This config is partial, so the flag is whichever the
// write leaves in place -- the one it names, or the stored one it does not
// touch. Reading it from the same config that carries the endpoints is what
// makes importing a profile atomic: allowing plaintext and naming a plaintext
// endpoint in one write is accepted, and naming one without allowing it is not.
const webhookPolicyFor = (config: Record<string, unknown>) => ({
  allowInsecure:
    typeof config.webhookAllowInsecure === "boolean"
      ? config.webhookAllowInsecure
      : options.webhookAllowInsecure,
});

const validateConfig = (rawConfig: Record<string, unknown>): ConfigApplyResult => {
  const config = expandLegacyRouteExclusive(rawConfig);
  const applied: Record<string, unknown> = {};
  const rejected: ConfigApplyResult["rejected"] = [];
  const webhookPolicy = webhookPolicyFor(config);

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
      // The schema accepted the widest endpoint shape; this is where the policy
      // is known, so refuse a list naming an endpoint this write would not send
      // to. Turning the flag off is not refused in turn: a stored list keeps its
      // now-plaintext lines, the editor marks them, and they stop being sent --
      // tightening the setting must never be the thing that fails.
      if (
        name === "webhookUrl" &&
        typeof value === "string" &&
        value.trim() !== "" &&
        parseWebhookEndpoints(value, webhookPolicy).issues.length > 0
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
  reset: (applied: Record<string, unknown>) => Promise<unknown>,
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
        await reset(applied);
      }
      return { applied, rejected };
    });
  state.queue = task;
  return task;
};
