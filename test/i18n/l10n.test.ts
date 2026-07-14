// @vitest-environment jsdom
import {
  documentLanguage,
  hardenLinks,
  initializeLocalizedDocument,
  localizeString,
  localizeDocument,
  setDocumentLanguage,
} from "../../src/options/l10n.ts";

describe("l10n", () => {
  beforeEach(() => {
    (global.chrome as any).i18n = {
      getMessage: vi.fn((key: string) => ({ greeting: "Hello", name: "save-in" })[key] || ""),
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("replaces placeholders in strings", () => {
    expect(localizeString("__MSG_greeting__, __MSG_name__!")).toBe("Hello, save-in!");
  });

  test("keeps unknown placeholders verbatim", () => {
    expect(localizeString("__MSG_missing__")).toBe("__MSG_missing__");
  });

  test("localizes document text nodes and attributes", () => {
    document.body.innerHTML =
      '<p id="t">__MSG_greeting__</p><input id="i" placeholder="__MSG_name__"><span id="plain">untouched</span>';

    localizeDocument();

    expect(document.getElementById("t")?.textContent).toBe("Hello");
    expect(document.getElementById("i")?.getAttribute("placeholder")).toBe("save-in");
    expect(document.getElementById("plain")?.textContent).toBe("untouched");
  });

  test("uses the selected locale or browser language for document semantics", () => {
    expect(documentLanguage("fr", "en-US")).toBe("fr");
    expect(documentLanguage("pt_BR", "en-US")).toBe("pt-BR");
    expect(documentLanguage("nl_AI", "en-US")).toBe("nl");
    expect(documentLanguage("", "zh-Hant-TW")).toBe("zh-Hant-TW");
    expect(documentLanguage("", null)).toBe("en");
    expect(documentLanguage("unknown", "not a locale")).toBe("en");

    setDocumentLanguage("sv_AI", "en-US");
    expect(document.documentElement.lang).toBe("sv");
  });

  test("selects the stored locale before revealing the localized document", async () => {
    document.body.innerHTML = `
      <select id="locale">
        <option value="">Browser default</option>
        <option value="fr">Français</option>
      </select>`;
    document.documentElement.classList.add("localization-pending");
    const select = document.querySelector<HTMLSelectElement>("#locale")!;
    let finishCatalogLoad!: () => void;
    const catalogLoaded = new Promise<void>((resolve) => {
      finishCatalogLoad = resolve;
    });
    const localize = vi.fn();

    const initialized = initializeLocalizedDocument("fr", "en-US", {
      root: document.documentElement,
      localeControl: select,
      initialize: () => catalogLoaded,
      localize,
    });

    expect(select.value).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.classList).toContain("localization-pending");
    expect(localize).not.toHaveBeenCalled();

    finishCatalogLoad();
    await initialized;
    expect(localize).toHaveBeenCalledOnce();
    expect(document.documentElement.classList).not.toContain("localization-pending");

    await initializeLocalizedDocument("invalid", "en-US", {
      root: document.documentElement,
      localeControl: select,
      initialize: () => Promise.resolve(),
      localize,
    });
    expect(select.value).toBe("");
  });

  test("reveals the document when localization initialization fails", async () => {
    document.documentElement.classList.add("localization-pending");

    await expect(
      initializeLocalizedDocument("invalid", "en-US", {
        root: document.documentElement,
        localeControl: null,
        initialize: () => Promise.reject(new Error("catalog unavailable")),
        localize: vi.fn(),
      }),
    ).rejects.toThrow("catalog unavailable");

    expect(document.documentElement.classList).not.toContain("localization-pending");
  });

  test("opens external links separately without exposing the options window", () => {
    document.body.innerHTML = `
      <a id="external" class="external" href="https://example.com">external</a>
      <a id="blank" href="help.html" target="_blank">help</a>
      <a id="same" href="help.html">same</a>`;

    hardenLinks();

    const external = document.getElementById("external") as HTMLAnchorElement;
    const blank = document.getElementById("blank") as HTMLAnchorElement;
    expect(external.target).toBe("_blank");
    expect(external.relList.contains("noreferrer")).toBe(true);
    expect(blank.relList.contains("noreferrer")).toBe(true);
    expect((document.getElementById("same") as HTMLAnchorElement).target).toBe("");
  });
});
