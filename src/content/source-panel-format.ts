import { normalizeUiTheme, type UiTheme } from "../config/content-options.ts";
import type { SourcePanelOptions } from "./source-panel-model.ts";

export const resolvedPanelTheme = (theme: SourcePanelOptions["theme"]): UiTheme =>
  normalizeUiTheme(theme);

const panelLocale = (locale?: string): string | undefined => {
  if (!locale) return undefined;
  if (locale.endsWith("_AI")) return locale.slice(0, -3);
  return locale.replace("_", "-");
};

export const sourcePanelViewport = () => {
  const viewport = window.visualViewport;
  return viewport
    ? {
        left: viewport.offsetLeft,
        top: viewport.offsetTop,
        width: viewport.width,
        height: viewport.height,
      }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
};

const panelFormatters = new Map<string, { date: Intl.DateTimeFormat; number: Intl.NumberFormat }>();
export const getPanelFormatters = (locale?: string) => {
  const key = panelLocale(locale) || "default";
  const cached = panelFormatters.get(key);
  if (cached) return cached;
  let formatters: { date: Intl.DateTimeFormat; number: Intl.NumberFormat };
  try {
    formatters = {
      date: new Intl.DateTimeFormat(key === "default" ? undefined : key, { timeStyle: "short" }),
      number: new Intl.NumberFormat(key === "default" ? undefined : key, {
        maximumFractionDigits: 1,
      }),
    };
  } catch {
    formatters = {
      date: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }),
      number: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    };
  }
  panelFormatters.set(key, formatters);
  return formatters;
};
