import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { isStringKeyedRecord, sendInternalMessage } from "../shared/message-protocol.ts";
import type { ApplyConfigResponse } from "../shared/message-protocol.ts";
import type { OptionSchema } from "./options-persistence.ts";

export type OptionsRuntimeApi = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  i18n: { getMessage(key: string): string };
  storage: {
    local: {
      get(keys: string): Promise<Record<string, unknown>>;
    };
  };
};

const isOptionSchemaKey = (value: unknown): value is OptionSchema["keys"][number] =>
  isStringKeyedRecord(value) &&
  typeof value.name === "string" &&
  typeof value.type === "string" &&
  (typeof value.default === "string" ||
    typeof value.default === "number" ||
    typeof value.default === "boolean");

const isOptionSchema = (value: unknown): value is OptionSchema =>
  isStringKeyedRecord(value) &&
  Array.isArray(value.keys) &&
  value.keys.every(isOptionSchemaKey) &&
  isStringKeyedRecord(value.types) &&
  typeof value.types.BOOL === "string" &&
  typeof value.types.VALUE === "string";

export const createOptionsRuntime = (api: OptionsRuntimeApi) => {
  let schema: Promise<OptionSchema> | undefined;

  const loadSchema = async (): Promise<OptionSchema> => {
    const response: unknown = await sendInternalMessage(api.runtime, {
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
    });
    const body = isStringKeyedRecord(response) ? response.body : undefined;
    if (!isOptionSchema(body)) {
      throw new Error("Invalid option schema response");
    }
    return body;
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
    apply(
      config: Record<string, unknown>,
      expected?: Record<string, unknown>,
    ): Promise<ApplyConfigResponse> {
      return sendInternalMessage(api.runtime, {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config, ...(expected ? { expected } : {}) },
      });
    },
  };
};

export const optionsRuntime = createOptionsRuntime(webExtensionApi);
