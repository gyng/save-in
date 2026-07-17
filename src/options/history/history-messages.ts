// The history panel's localizer seam. The options page swaps in a generated
// catalog's lookup at startup (setHistoryLocalizer), so every history string
// resolves through this owner-controlled live binding rather than importing
// getMessage directly. Each call carries an English fallback because a
// generated catalog may be missing the key.

import { getMessage } from "../../platform/localization.ts";
import { localizeHistoryColumns } from "./history-view.ts";
import type { HistoryDisplayColumn } from "./history-view.ts";

export type HistorySubstitutions = string | number | Array<string | number>;
export type HistoryLocalize = (key: string, substitutions?: HistorySubstitutions) => string;

let localize: HistoryLocalize = getMessage;

export const setHistoryLocalizer = (getLocalizedMessage: HistoryLocalize): void => {
  localize = getLocalizedMessage;
};

export const historyLocalize = (key: string, substitutions?: HistorySubstitutions): string =>
  localize(key, substitutions);

export const historyMessage = (
  key: string,
  fallback: string,
  substitutions?: HistorySubstitutions,
): string => localize(key, substitutions) || fallback;

export const historyColumns = (): HistoryDisplayColumn[] => localizeHistoryColumns(localize);

const TYPE_LABELS: Record<string, [string, string]> = {
  image: ["html_image", "Image"],
  link: ["html_link", "Link"],
  page: ["contextMenuContextPage", "Page"],
  selection: ["html_selection", "Selection"],
  click: ["html_click", "Click"],
  tab: ["html_tab", "Tab"],
  sidecar: ["html_link", "Link"],
};

export const historyTypeLabel = (type: string): string => {
  const label = TYPE_LABELS[type];
  return label ? historyMessage(label[0], label[1]) : type;
};
