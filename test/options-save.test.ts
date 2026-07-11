import { assertApplySucceeded } from "../src/options/options-save.ts";

describe("options apply response", () => {
  test("accepts a successful background acknowledgement", () => {
    const response = {
      type: "APPLY_CONFIG_RESULT",
      body: { applied: { paths: "." }, rejected: [] },
    };
    expect(assertApplySucceeded(response)).toBe(response);
  });

  test("rejects missing acknowledgements and rejected fields", () => {
    expect(() => assertApplySucceeded(undefined)).toThrow("No save acknowledgement");
    expect(() =>
      assertApplySucceeded({
        type: "APPLY_CONFIG_RESULT",
        body: { applied: {}, rejected: [{ name: "paths", reason: "invalid value" }] },
      }),
    ).toThrow("paths: invalid value");
  });
});
