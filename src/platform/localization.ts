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

const isPlaceholder = (value: unknown): value is Placeholder =>
  isStringKeyedRecord(value) &&
  typeof value.content === "string" &&
  (typeof value.example === "undefined" || typeof value.example === "string");

const isMessageDefinition = (value: unknown): value is MessageDefinition =>
  isStringKeyedRecord(value) &&
  typeof value.message === "string" &&
  (typeof value.description === "undefined" || typeof value.description === "string") &&
  (typeof value.placeholders === "undefined" ||
    (isStringKeyedRecord(value.placeholders) &&
      Object.values(value.placeholders).every(isPlaceholder)));

const isMessageCatalog = (value: unknown): value is MessageCatalog =>
  isStringKeyedRecord(value) && Object.values(value).every(isMessageDefinition);

const parseCatalog = (value: unknown): MessageCatalog => {
  if (!isMessageCatalog(value)) throw new Error("Invalid message catalog");
  return value;
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
      const loadParsedCatalog = (path: string) => ports.loadCatalog(path).then(parseCatalog);
      const englishRequest = loadParsedCatalog("_locales/en/messages.json");
      if (!isGeneratedLocale(locale)) {
        try {
          englishCatalog = await englishRequest;
          selectedCatalog = englishCatalog;
        } catch {
          // A missing canonical catalog must never prevent startup.
          englishCatalog = undefined;
        }
        return;
      }
      const selectedRequest = loadParsedCatalog(generatedCatalogPath(locale));
      // Both extension resources are local, but neither request needs the result of the other.
      [englishCatalog, selectedCatalog] = await Promise.all([
        englishRequest.catch(() => undefined),
        selectedRequest.catch(() => undefined),
      ]);
      if (!englishCatalog) {
        // A missing canonical catalog must never prevent startup.
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
  nativeGetMessage: (key, substitutions) => {
    if (typeof substitutions === "undefined") return webExtensionApi.i18n.getMessage(key);
    const normalized = typeof substitutions === "number" ? String(substitutions) : substitutions;
    return webExtensionApi.i18n.getMessage(key, normalized);
  },
  loadCatalog: async (path) => {
    const response = await fetch(webExtensionApi.runtime.getURL(path));
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  },
});

export const initializeLocalization = localization.initialize;
export const getMessage = localization.getMessage;
