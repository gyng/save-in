// @vitest-environment jsdom
import {
  assertApplyAcknowledged,
  assertApplySucceeded,
  collectOptionConfig,
  getAppliedValue,
} from "../src/options/options-save.ts";

describe("options apply response", () => {
  test("accepts a successful background acknowledgement", () => {
    const response = {
      type: "APPLY_CONFIG_RESULT",
      body: { version: 1, applied: { paths: "." }, rejected: [] },
    };
    expect(assertApplySucceeded(response)).toBe(response);
  });

  test("rejects missing acknowledgements and rejected fields", () => {
    expect(() => assertApplySucceeded(undefined)).toThrow("No save acknowledgement");
    expect(() =>
      assertApplySucceeded({
        type: "APPLY_CONFIG_RESULT",
        body: {
          version: 1,
          applied: {},
          rejected: [{ name: "paths", reason: "invalid value" }],
        },
      }),
    ).toThrow("paths: invalid value");
  });

  test("accepts a valid partial-apply acknowledgement", () => {
    const response = {
      type: "APPLY_CONFIG_RESULT",
      body: {
        version: 1,
        applied: { paths: "cats" },
        rejected: [{ name: "prompt", reason: "Expected a boolean" }],
      },
    };

    expect(assertApplyAcknowledged(response)).toBe(response);
  });

  test.each([
    { type: "APPLY_CONFIG_RESULT", body: {} },
    { type: "APPLY_CONFIG_RESULT", body: { version: 1, applied: [], rejected: [] } },
    { type: "APPLY_CONFIG_RESULT", body: { version: 1, applied: {}, rejected: "none" } },
    { type: "APPLY_CONFIG_RESULT", body: { version: 1, applied: {}, rejected: [null] } },
    {
      type: "APPLY_CONFIG_RESULT",
      body: { version: 1, applied: {}, rejected: [{ name: "paths" }] },
    },
  ])("rejects malformed acknowledgements %#", (response) => {
    expect(() => assertApplySucceeded(response)).toThrow("Invalid save acknowledgement");
  });
});

test("collects only the explicitly scoped editor", () => {
  document.body.innerHTML = '<textarea id="paths">cats</textarea><input id="other" value="x">';
  const schema = {
    keys: [
      { name: "paths", type: "VALUE" },
      { name: "other", type: "VALUE" },
    ],
    types: { BOOL: "BOOL", VALUE: "VALUE" },
  };
  expect(collectOptionConfig(schema, "paths")).toEqual({ paths: "cats" });
});

test("collects checkbox and value controls while ignoring incompatible elements", () => {
  document.body.innerHTML = `
    <input id="enabled" type="checkbox" checked>
    <select id="mode"><option value="fast" selected>Fast</option></select>
    <div id="ignored">not a control</div>`;
  const schema = {
    keys: [
      { name: "enabled", type: "BOOL" },
      { name: "mode", type: "VALUE" },
      { name: "ignored", type: "VALUE" },
      { name: "missing", type: "BOOL" },
    ],
    types: { BOOL: "BOOL", VALUE: "VALUE" },
  };

  expect(collectOptionConfig(schema)).toEqual({ enabled: true, mode: "fast" });
});

test("uses stable fallback labels for malformed rejection text", () => {
  expect(() =>
    assertApplySucceeded({
      type: "APPLY_CONFIG_RESULT",
      body: { version: 1, applied: {}, rejected: [{ name: "", reason: "" }] },
    }),
  ).toThrow("option: rejected");
});

test("returns the normalized applied value", () => {
  expect(
    getAppliedValue(
      {
        type: "APPLY_CONFIG_RESULT",
        body: { version: 1, applied: { paths: "cats" }, rejected: [] },
      },
      "paths",
    ),
  ).toBe("cats");
  expect(
    getAppliedValue(
      { type: "APPLY_CONFIG_RESULT", body: { version: 1, applied: [], rejected: [] } },
      "paths",
    ),
  ).toBeUndefined();
  expect(getAppliedValue(undefined, "paths")).toBeUndefined();
});
