import { getMessage, initializeLocalization } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { localizeDocument, setDocumentLanguage } from "../options/l10n.ts";
import { setupReferencePage } from "../options/reference-page.ts";
import { applyUiTheme } from "../options/theme.ts";

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const stored = await webExtensionApi.storage.local
      .get(["uiLocale", "uiTheme"])
      .catch(() => ({}));
    applyUiTheme(Reflect.get(stored, "uiTheme"));
    const uiLocale = Reflect.get(stored, "uiLocale");
    await initializeLocalization(uiLocale);
    setDocumentLanguage(
      uiLocale,
      typeof webExtensionApi.i18n.getUILanguage === "function"
        ? webExtensionApi.i18n.getUILanguage()
        : "",
    );
    localizeDocument(getMessage);
    setupReferencePage();
  },
  { once: true },
);
