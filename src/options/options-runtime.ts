import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import type { OptionSchema } from "./options-persistence.ts";

export const createOptionsRuntime = (api: typeof webExtensionApi) => {
  let schema: Promise<OptionSchema> | undefined;

  const loadSchema = async (): Promise<OptionSchema> => {
    const response: unknown = await api.runtime.sendMessage({ type: "OPTIONS_SCHEMA" });
    const body =
      response != null && typeof response === "object" ? Reflect.get(response, "body") : undefined;
    if (
      body == null ||
      typeof body !== "object" ||
      !Array.isArray(Reflect.get(body, "keys")) ||
      Reflect.get(body, "types") == null ||
      typeof Reflect.get(body, "types") !== "object"
    ) {
      throw new Error("Invalid option schema response");
    }
    const keys = Reflect.get(body, "keys") as unknown[];
    const types = Reflect.get(body, "types") as Record<string, unknown>;
    if (
      !keys.every(
        (key) =>
          key != null &&
          typeof key === "object" &&
          typeof Reflect.get(key, "name") === "string" &&
          typeof Reflect.get(key, "type") === "string",
      ) ||
      typeof types.BOOL !== "string" ||
      typeof types.VALUE !== "string"
    ) {
      throw new Error("Invalid option schema response");
    }
    return body as OptionSchema;
  };

  return {
    configure() {
      configureRoutingPorts({
        getMessage,
        peekCounter: async () => {
          const stored = await api.storage.local.get(COUNTER_KEY);
          const value = stored[COUNTER_KEY];
          return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
        },
      });
    },
    getSchema(): Promise<OptionSchema> {
      if (!schema) {
        schema = loadSchema().catch((error) => {
          schema = undefined;
          throw error;
        });
      }
      return schema;
    },
    apply(config: Record<string, unknown>, expected?: Record<string, unknown>): Promise<unknown> {
      return api.runtime.sendMessage({
        type: "APPLY_CONFIG",
        body: { config, ...(expected ? { expected } : {}) },
      });
    },
  };
};

export const optionsRuntime = createOptionsRuntime(webExtensionApi);
