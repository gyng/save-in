import { applyConfigSerialized } from "../../src/background/config-apply.ts";
import { OptionsManagement, seedOptions } from "../../src/config/option.ts";

beforeAll(() => seedOptions());

test("rejects object-like values before writing configuration", async () => {
  const storage = { get: vi.fn(), set: vi.fn() };
  const reset = vi.fn();

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    storage,
    { paths: null },
    undefined,
    reset,
  );

  expect(OptionsManagement.OPTION_KEYS.some(({ name }) => name === "paths")).toBe(true);
  expect(result).toEqual({
    applied: {},
    rejected: [{ name: "paths", reason: "expected a string or number" }],
  });
  expect(storage.set).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

test("rejects values when schema normalization throws", async () => {
  const definition = OptionsManagement.OPTION_KEYS.find(({ name }) => name === "filenamePatterns");
  if (!definition || !("onSave" in definition)) throw new Error("test option is unavailable");
  vi.spyOn(definition, "onSave").mockImplementation(() => {
    throw new Error("bad normalization");
  });

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    { get: vi.fn(), set: vi.fn() },
    { filenamePatterns: "matcher" },
    undefined,
    vi.fn(),
  );

  expect(result).toEqual({
    applied: {},
    rejected: [{ name: "filenamePatterns", reason: "invalid value" }],
  });
});

test("rejects unsafe automatic rules before writing configuration", async () => {
  const storage = { get: vi.fn(), set: vi.fn() };
  const reset = vi.fn();

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    storage,
    {
      autoDownloadRules: "pageurl: .*\nsourceurl: .*\ninto: automatic/",
    },
    undefined,
    reset,
  );

  expect(result).toEqual({
    applied: {},
    rejected: [{ name: "autoDownloadRules", reason: "invalid value" }],
  });
  expect(storage.set).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

test("rejects CSS matcher configurations larger than the attestation boundary", async () => {
  const storage = { get: vi.fn(), set: vi.fn() };
  const reset = vi.fn();
  const filenamePatterns = Array.from(
    { length: 257 },
    (_value, index) => `css: .item-${index}\ninto: item-${index}/`,
  ).join("\n\n");

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    storage,
    { filenamePatterns },
    undefined,
    reset,
  );

  expect(result).toEqual({
    applied: {},
    rejected: [{ name: "filenamePatterns", reason: "invalid value" }],
  });
  expect(storage.set).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

test("continues serialized writes after an earlier write rejected", async () => {
  const storage = { get: vi.fn(), set: vi.fn(() => Promise.resolve()) };
  const reset = vi.fn(() => Promise.resolve());
  const state = { queue: Promise.reject(new Error("previous write failed")) as Promise<unknown> };

  await expect(
    applyConfigSerialized(state, storage, { paths: "images" }, undefined, reset),
  ).resolves.toEqual({ applied: { paths: "images" }, rejected: [] });
  expect(storage.set).toHaveBeenCalledWith({ paths: "images" });
  expect(reset).toHaveBeenCalledOnce();
});

test("expands the legacy combined routing mode at the configuration boundary", async () => {
  const storage = { get: vi.fn(), set: vi.fn(() => Promise.resolve()) };
  const reset = vi.fn(() => Promise.resolve());

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    storage,
    { routeExclusive: true },
    undefined,
    reset,
  );

  expect(result).toEqual({
    applied: {
      routeExclusive: false,
      routeHideFolderChoices: true,
      routeSkipUnmatched: true,
    },
    rejected: [],
  });
  expect(storage.set).toHaveBeenCalledWith(result.applied);
});

test("does not overwrite explicit split routing behavior", async () => {
  const storage = { get: vi.fn(), set: vi.fn(() => Promise.resolve()) };

  const result = await applyConfigSerialized(
    { queue: Promise.resolve() },
    storage,
    {
      routeExclusive: false,
      routeHideFolderChoices: true,
      routeSkipUnmatched: false,
    },
    undefined,
    vi.fn(() => Promise.resolve()),
  );

  expect(result.applied).toEqual({
    routeExclusive: false,
    routeHideFolderChoices: true,
    routeSkipUnmatched: false,
  });
});
