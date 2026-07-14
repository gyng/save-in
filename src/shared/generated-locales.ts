export const GENERATED_LOCALES = [
  { locale: "de", label: "Deutsch (AI)" },
  { locale: "es", label: "Español (AI)" },
  { locale: "fr", label: "Français (AI)" },
  { locale: "it", label: "Italiano (AI)" },
  { locale: "nl_AI", label: "Nederlands (AI)" },
  { locale: "pt_BR", label: "Português (Brasil) (AI)" },
  { locale: "sv_AI", label: "Svenska (AI)" },
  { locale: "ja", label: "日本語 (AI)" },
  { locale: "ko", label: "한국어 (AI)" },
  { locale: "zh_CN", label: "简体中文 (AI)" },
  { locale: "zh_TW", label: "繁體中文 (AI)" },
] as const;

export type GeneratedLocale = (typeof GENERATED_LOCALES)[number]["locale"];
export type SelectableLocale = "en" | GeneratedLocale;

export const isGeneratedLocale = (value: unknown): value is GeneratedLocale =>
  typeof value === "string" && GENERATED_LOCALES.some(({ locale }) => locale === value);

export const isSelectableLocale = (value: unknown): value is SelectableLocale =>
  value === "en" || isGeneratedLocale(value);

export const generatedCatalogPath = (locale: GeneratedLocale): string =>
  `src/i18n/generated/${locale}/messages.json`;
