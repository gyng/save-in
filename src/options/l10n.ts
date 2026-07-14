// Substitutes __MSG_key__ placeholders in the options document with i18n
// messages. First-party replacement for webextensions-lib-l10n.

import { isSelectableLocale } from "../shared/generated-locales.ts";

type GetMessage = (key: string) => string;

type InitializeLocalizedDocumentPorts = {
  root: HTMLElement;
  localeControl: HTMLSelectElement | null;
  reveal?: boolean;
  initialize(locale: unknown): Promise<void>;
  localize(): void;
};

const nativeGetMessage: GetMessage = (key) => chrome.i18n.getMessage(key);

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const RTL_SCRIPTS = new Set([
  "Adlm",
  "Arab",
  "Hebr",
  "Mand",
  "Mend",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

export const documentLanguage = (selectedLocale: unknown, browserLocale: unknown): string => {
  const source = isSelectableLocale(selectedLocale) ? selectedLocale : browserLocale;
  const normalized =
    typeof source === "string" ? source.trim().replace(/_AI$/, "").replaceAll("_", "-") : "";
  return LANGUAGE_TAG.test(normalized) ? normalized : "en";
};

export const documentDirection = (language: string): "ltr" | "rtl" => {
  try {
    return RTL_SCRIPTS.has(new Intl.Locale(language).maximize().script ?? "") ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
};

export const setDocumentLanguage = (
  selectedLocale: unknown,
  browserLocale: unknown,
  root: HTMLElement = document.documentElement,
): void => {
  const language = documentLanguage(selectedLocale, browserLocale);
  root.lang = language;
  root.dir = documentDirection(language);
};

export const initializeLocalizedDocument = async (
  selectedLocale: unknown,
  browserLocale: unknown,
  ports: InitializeLocalizedDocumentPorts,
): Promise<void> => {
  try {
    if (ports.localeControl) {
      ports.localeControl.value = isSelectableLocale(selectedLocale) ? selectedLocale : "";
    }
    setDocumentLanguage(selectedLocale, browserLocale, ports.root);
    await ports.initialize(selectedLocale);
    ports.localize();
  } finally {
    if (ports.reveal !== false) ports.root.classList.remove("localization-pending");
  }
};

export const localizeString = (str: string, getMessage: GetMessage = nativeGetMessage): string =>
  str.replace(/__MSG_(.+?)__/g, (match, key) => getMessage(key) || match);

export const hardenLinks = () => {
  document.querySelectorAll<HTMLAnchorElement>("a.external").forEach((link) => {
    link.target = "_blank";
  });
  document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]').forEach((link) => {
    link.relList.add("noreferrer");
  });
};

export const localizeDocument = (getMessage: GetMessage = nativeGetMessage) => {
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const texts: Node[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue?.includes("__MSG_")) {
      texts.push(walker.currentNode);
    }
  }
  texts.forEach((node) => {
    const value = node.nodeValue;
    /* v8 ignore next -- Only text nodes with a matching non-null nodeValue enter this list. */
    if (value !== null) node.nodeValue = localizeString(value, getMessage);
  });

  document.querySelectorAll("*").forEach((el) => {
    for (const attr of el.attributes) {
      if (attr.value.includes("__MSG_")) {
        attr.value = localizeString(attr.value, getMessage);
      }
    }
  });
  hardenLinks();
};
