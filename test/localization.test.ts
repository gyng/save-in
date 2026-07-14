import {
  createLocalization,
  getMessage,
  initializeLocalization,
} from "../src/platform/localization.ts";

const english = {
  greeting: { message: "Hello" },
  failure: {
    message: "Failed to save $FILENAME$.",
    placeholders: { filename: { content: "$1" } },
  },
};

test("uses native browser messages until an AI locale is selected", () => {
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(),
  });

  expect(localization.getMessage("greeting")).toBe("native:greeting");
});

test("loads a selected AI catalog with canonical English fallback", async () => {
  const loadCatalog = vi.fn(async (path: string) =>
    path.includes("generated/fr") ? { greeting: { message: "Bonjour" } } : english,
  );
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog,
  });

  await localization.initialize("fr");

  expect(loadCatalog).toHaveBeenCalledWith("src/i18n/generated/fr/messages.json");
  expect(loadCatalog).toHaveBeenCalledWith("_locales/en/messages.json");
  expect(localization.getMessage("greeting")).toBe("Bonjour");
  expect(localization.getMessage("failure", ["photo.jpg"])).toBe("Failed to save photo.jpg.");
});

test("starts the selected and English catalog loads together", async () => {
  let finishEnglishLoad!: () => void;
  const englishLoad = new Promise<unknown>((resolve) => {
    finishEnglishLoad = () => resolve(english);
  });
  const loadCatalog = vi.fn((path: string) =>
    path.includes("generated/fr")
      ? Promise.resolve({ greeting: { message: "Bonjour" } })
      : englishLoad,
  );
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog,
  });

  const initializing = localization.initialize("fr");
  try {
    expect(loadCatalog).toHaveBeenCalledWith("_locales/en/messages.json");
    expect(loadCatalog).toHaveBeenCalledWith("src/i18n/generated/fr/messages.json");
  } finally {
    finishEnglishLoad();
  }
  await initializing;

  expect(localization.getMessage("greeting")).toBe("Bonjour");
});

test("matches placeholder identifiers independently of the host locale", async () => {
  const localeLowerCase = String.prototype.toLocaleLowerCase;
  vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (this: string) {
    return localeLowerCase.call(this, "tr");
  });
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(async () => english),
  });

  await localization.initialize("en");

  expect(localization.getMessage("failure", ["photo.jpg"])).toBe("Failed to save photo.jpg.");
});

test("allows an explicit English override without loading an AI catalog", async () => {
  const loadCatalog = vi.fn(async () => english);
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog,
  });

  await localization.initialize("en");

  expect(loadCatalog).toHaveBeenCalledTimes(1);
  expect(loadCatalog).toHaveBeenCalledWith("_locales/en/messages.json");
  expect(localization.getMessage("greeting")).toBe("Hello");
});

test("falls back to native messages when an AI catalog cannot be loaded", async () => {
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(async () => {
      throw new Error("missing catalog");
    }),
  });

  await expect(localization.initialize("de")).resolves.toBeUndefined();
  expect(localization.getMessage("greeting")).toBe("native:greeting");
});

test("ignores a selected catalog when canonical English is unavailable", async () => {
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(async (path: string) => {
      if (path.includes("generated/fr")) return { greeting: { message: "Bonjour" } };
      throw new Error("missing canonical catalog");
    }),
  });

  await localization.initialize("fr");

  expect(localization.getMessage("greeting")).toBe("native:greeting");
});

test("falls back to English when only the selected AI catalog is unavailable", async () => {
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(async (path: string) => {
      if (path.includes("generated")) throw new Error("missing generated catalog");
      return english;
    }),
  });

  await localization.initialize("fr");

  expect(localization.getMessage("greeting")).toBe("Hello");
});

test("ignores unsupported locale identifiers without loading extension resources", async () => {
  const loadCatalog = vi.fn();
  const localization = createLocalization({
    nativeGetMessage: (key) => key,
    loadCatalog,
  });

  await localization.initialize("../../remote");

  expect(loadCatalog).not.toHaveBeenCalled();
});

test.each([
  null,
  [],
  { greeting: null },
  { greeting: { message: 7 } },
  { greeting: { message: "Hello", description: 7 } },
  { greeting: { message: "Hello", placeholders: [] } },
  { greeting: { message: "Hello", placeholders: { name: { content: 7 } } } },
  { greeting: { message: "Hello", placeholders: { name: { content: "$1", example: 7 } } } },
])("rejects malformed canonical catalogs and keeps native messages for %j", async (catalog) => {
  const localization = createLocalization({
    nativeGetMessage: (key) => `native:${key}`,
    loadCatalog: vi.fn(async () => catalog),
  });

  await localization.initialize("en");

  expect(localization.getMessage("greeting")).toBe("native:greeting");
});

test("preserves unknown placeholders and normalizes missing and numeric replacements", async () => {
  const localization = createLocalization({
    nativeGetMessage: (key) => key,
    loadCatalog: vi.fn(async () => ({
      count: {
        message: "$COUNT$ / $MISSING$ / $SECOND$",
        placeholders: {
          count: { content: "$1" },
          second: { content: "$2" },
        },
      },
    })),
  });
  await localization.initialize("en");

  expect(localization.getMessage("count", 3)).toBe("3 / $MISSING$ / ");
  expect(localization.getMessage("count")).toBe(" / $MISSING$ / ");
});

test("loads the browser-owned catalog and falls back when its response fails", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({ ok: true, json: async () => english } as Response)
    .mockResolvedValueOnce({ ok: false } as Response);

  await initializeLocalization("en");
  expect(getMessage("greeting")).toBe("Hello");
  await initializeLocalization("en");
  expect(getMessage("greeting")).toBe("Translated<greeting>");
  expect(getMessage("count", 5)).toBe("Translated<count>");
  expect(browser.i18n.getMessage).toHaveBeenLastCalledWith("count", "5");
  expect(getMessage("items", ["one", "two"])).toBe("Translated<items>");
  expect(browser.i18n.getMessage).toHaveBeenLastCalledWith("items", ["one", "two"]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
