type TabWithOptionalUrl = {
  url?: string | undefined;
};

const BLOCKED_TAB_PROTOCOLS = new Set(["about:", "chrome:", "edge:"]);

export const isDownloadableTab = <Tab extends TabWithOptionalUrl>(
  tab: Tab,
): tab is Tab & { url: string } => {
  if (typeof tab.url !== "string" || tab.url.length === 0) return false;

  try {
    return !BLOCKED_TAB_PROTOCOLS.has(new URL(tab.url).protocol);
  } catch {
    return false;
  }
};
