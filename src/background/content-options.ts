import {
  CONTENT_OPTIONS_CHANGED_MESSAGE,
  normalizeContentOptionsPatch,
} from "../config/content-options.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";

// Push only the content-owned option delta. Keeping content scripts off
// storage.onChanged is important on Firefox: history updates carry the whole
// old/new array through that event, once for every open tab.
//
// Since 4.0.1 removed the content script's storage.onChanged listener, this
// is the ONLY way a live tab learns of a change to a CONTENT_OPTION_KEYS key
// (see config/content-options.ts). Every background site that writes one of
// those keys to storage.local must also call this (or a helper that does),
// or an open tab silently keeps a stale value until its next page load.
export const broadcastContentOptions = async (values: unknown): Promise<void> => {
  const options = normalizeContentOptionsPatch(values);
  if (Object.keys(options).length === 0) return;

  const tabs = await webExtensionApi.tabs.query({}).catch(() => null);
  if (!tabs) return;
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return;
      try {
        await webExtensionApi.tabs.sendMessage(tab.id, {
          type: CONTENT_OPTIONS_CHANGED_MESSAGE,
          body: { options },
        });
      } catch {
        // Restricted pages and tabs from an older extension instance have no
        // compatible content receiver. A later page load reads the same values.
      }
    }),
  );
};
