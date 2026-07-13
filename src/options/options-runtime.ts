import { webExtensionApi } from "../platform/web-extension-api.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import type { OptionSchema } from "./options-persistence.ts";

export const createOptionsRuntime = (api: typeof webExtensionApi) => {
  let schema: Promise<OptionSchema> | undefined;

  return {
    configure() {
      configureRoutingPorts({
        getMessage: (key) => api.i18n.getMessage(key),
        peekCounter: async () => {
          const stored = await api.storage.local.get(COUNTER_KEY);
          const value = stored[COUNTER_KEY];
          return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
        },
      });
    },
    getSchema(): Promise<OptionSchema> {
      return (schema ??= api.runtime
        .sendMessage({ type: "OPTIONS_SCHEMA" })
        .then((response) => response.body));
    },
    apply(config: Record<string, unknown>, expected?: Record<string, unknown>): Promise<any> {
      return api.runtime.sendMessage({
        type: "APPLY_CONFIG",
        body: { config, ...(expected ? { expected } : {}) },
      });
    },
  };
};

export const optionsRuntime = createOptionsRuntime(webExtensionApi);
