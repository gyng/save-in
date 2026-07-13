import {
  generatedCatalogPath,
  isGeneratedLocale,
  isSelectableLocale,
} from "../shared/generated-locales.ts";
import { isStringKeyedRecord } from "../shared/message-protocol.ts";
import { webExtensionApi } from "./web-extension-api.ts";

type Substitution = string | number;
type Substitutions = Substitution | Substitution[];
type Placeholder = { content: string; example?: string };
type MessageDefinition = {
  message: string;
  description?: string;
  placeholders?: Record<string, Placeholder>;
};
type MessageCatalog = Record<string, MessageDefinition>;

type LocalizationPorts = {
  nativeGetMessage(key: string, substitutions?: Substitutions): string;
  loadCatalog(path: string): Promise<unknown>;
};

const parseCatalog = (value: unknown): MessageCatalog => {
  if (!isStringKeyedRecord(value)) throw new Error("Invalid message catalog");
  for (const definition of Object.values(value)) {
    if (!isStringKeyedRecord(definition) || typeof definition.message !== "string") {
      throw new Error("Invalid message definition");
    }
  }
  return value as MessageCatalog;
};

const formatMessage = (definition: MessageDefinition, substitutions?: Substitutions): string => {
  const values = Array.isArray(substitutions)
    ? substitutions
    : typeof substitutions === "undefined"
      ? []
      : [substitutions];
  return definition.message.replace(/\$([A-Za-z0-9_]+)\$/g, (token, name: string) => {
    const placeholder = definition.placeholders?.[name.toLowerCase()];
    if (!placeholder) return token;
    return placeholder.content.replace(/\$(\d+)/g, (_match, index: string) => {
      return String(values[Number(index) - 1] ?? "");
    });
  });
};

export const createLocalization = (ports: LocalizationPorts) => {
  let selectedCatalog: MessageCatalog | undefined;
  let englishCatalog: MessageCatalog | undefined;

  return {
    async initialize(locale: unknown): Promise<void> {
      selectedCatalog = undefined;
      englishCatalog = undefined;
      if (!isSelectableLocale(locale)) return;
      try {
        englishCatalog = parseCatalog(await ports.loadCatalog("_locales/en/messages.json"));
      } catch {
        // A missing canonical catalog must never prevent startup.
        englishCatalog = undefined;
        return;
      }
      if (!isGeneratedLocale(locale)) {
        selectedCatalog = englishCatalog;
        return;
      }
      try {
        selectedCatalog = parseCatalog(await ports.loadCatalog(generatedCatalogPath(locale)));
      } catch {
        // Generated catalogs are optional; explicit selections fall back to English.
        selectedCatalog = undefined;
      }
    },
    getMessage(key: string, substitutions?: Substitutions): string {
      const definition = selectedCatalog?.[key] ?? englishCatalog?.[key];
      return definition
        ? formatMessage(definition, substitutions)
        : ports.nativeGetMessage(key, substitutions);
    },
  };
};

const localization = createLocalization({
  nativeGetMessage: (key, substitutions) =>
    typeof substitutions === "undefined"
      ? webExtensionApi.i18n.getMessage(key)
      : webExtensionApi.i18n.getMessage(key, substitutions as never),
  loadCatalog: async (path) => {
    const response = await fetch(webExtensionApi.runtime.getURL(path));
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  },
});

export const initializeLocalization = localization.initialize;
export const getMessage = localization.getMessage;
