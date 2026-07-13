import { applyConfigSerialized } from "../src/background/config-apply.ts";
import { OptionsManagement, seedOptions } from "../src/config/option.ts";

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
