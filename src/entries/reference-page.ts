import { getMessage, initializeLocalization } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { localizeDocument } from "../options/l10n.ts";
import { setupReferencePage } from "../options/reference-page.ts";

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const stored = await webExtensionApi.storage.local.get("uiLocale").catch(() => ({}));
    await initializeLocalization(Reflect.get(stored, "uiLocale"));
    localizeDocument(getMessage);
    setupReferencePage();
  },
  { once: true },
);
