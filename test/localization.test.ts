import { createLocalization } from "../src/platform/localization.ts";

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
